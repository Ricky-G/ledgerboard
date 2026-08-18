const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { REPOSITORY_ROOT } = require('../helpers/repository.js');

const WORKFLOW_DIRECTORY = path.join(REPOSITORY_ROOT, '.github', 'workflows');

function readWorkflow(name) {
  // Tolerate a clone made before .gitattributes pinned the working tree to LF.
  return fs.readFileSync(path.join(WORKFLOW_DIRECTORY, name), 'utf8').replace(/\r\n/g, '\n');
}

const workflowNames = fs.readdirSync(WORKFLOW_DIRECTORY).filter((name) => name.endsWith('.yml'));
const ciWorkflow = readWorkflow('ci.yml');

test('every workflow action is pinned to an immutable commit SHA', () => {
  const floating = [];
  for (const name of workflowNames) {
    const source = readWorkflow(name);
    for (const line of source.split('\n')) {
      const match = line.match(/uses:\s*([^\s]+)/);
      if (!match || match[1].startsWith('./')) {
        continue;
      }
      const reference = match[1].split('@')[1];
      if (!/^[0-9a-f]{40}$/.test(reference ?? '')) {
        floating.push(`${name}: ${match[1]}`);
      }
    }
  }

  assert.deepEqual(
    floating,
    [],
    'A mutable tag lets an upstream owner change what runs in CI. Pin to a SHA '
    + `and keep the version in a trailing comment: ${floating.join(', ')}`,
  );
});

test('every workflow declares least-privilege permissions', () => {
  const missing = workflowNames.filter((name) => !/^permissions:/m.test(readWorkflow(name)));
  assert.deepEqual(missing, [], `Workflows without an explicit permissions block: ${missing}`);
});

test('no workflow uses the pull_request_target trigger', () => {
  // pull_request_target runs untrusted code with write-scoped secrets.
  const unsafe = workflowNames.filter((name) => /pull_request_target/.test(readWorkflow(name)));
  assert.deepEqual(unsafe, [], `Workflows using pull_request_target: ${unsafe}`);
});

test('only the publish workflow can reach the marketplace credential', () => {
  const leaking = workflowNames.filter(
    (name) => name !== 'publish.yml'
      && name !== 'marketplace-credential-health.yml'
      && /VSCE_PAT/.test(readWorkflow(name)),
  );
  assert.deepEqual(leaking, [], `Workflows referencing VSCE_PAT outside publishing: ${leaking}`);
  assert.match(readWorkflow('publish.yml'), /environment: marketplace/);
});

test('a push to a protected branch is never cancelled by a newer run', () => {
  // The release gate reads the check results for one specific merge commit, so
  // cancelling a push run would strand the release.
  const offenders = [];
  for (const name of workflowNames) {
    const source = readWorkflow(name);
    if (!/^on:\n(?:.*\n)*?\s{2}push:/m.test(source)) {
      continue;
    }
    if (/cancel-in-progress:\s*true/.test(source)) {
      offenders.push(name);
    }
  }
  assert.deepEqual(offenders, [], `Workflows that cancel push runs: ${offenders}`);
});

test('CI runs each test layer as an independent job', () => {
  for (const job of [
    'static-checks',
    'unit-tests',
    'webview-tests',
    'integration-tests',
    'performance',
    'packaging',
  ]) {
    assert.match(
      ciWorkflow,
      new RegExp(`^  ${job}:$`, 'm'),
      `CI must expose ${job} as its own job so a failure names the layer that broke.`,
    );
  }
});

test('the aggregate quality gate depends on every test layer', () => {
  const quality = ciWorkflow.match(/^ {2}quality:\n([\s\S]*)$/m)[1];
  const needs = quality.match(/needs:\n((?: {6}- [a-z-]+\n)+)/)[1]
    .split('\n')
    .map((line) => line.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean);

  assert.deepEqual(needs.sort(), [
    'integration-tests',
    'packaging',
    'performance',
    'static-checks',
    'unit-tests',
    'webview-tests',
  ]);
  // `if: always()` makes the job run even when a layer failed, so the gate must
  // inspect each result explicitly rather than relying on job dependencies.
  assert.match(quality, /if: \$\{\{ always\(\) \}\}/);
  assert.match(quality, /The quality gate failed because these layers did not succeed/);
});

test('the pull request body reaches the release notes check without shell interpolation', () => {
  const staticChecks = ciWorkflow.match(/^ {2}static-checks:\n([\s\S]*?)(?=\n {2}unit-tests:)/m)[1];

  assert.match(staticChecks, /run: npm run check:release-notes/);
  assert.match(staticChecks, /PULL_REQUEST_BODY: \$\{\{ github\.event\.pull_request\.body \}\}/);
  assert.doesNotMatch(
    staticChecks,
    /run:[^\n]*github\.event\.pull_request\.body/,
    'Interpolating a pull request body into a run block executes author supplied text as shell.',
  );
});

test('the required check name the release gate waits for still exists in CI', () => {
  const releaseWorkflow = readWorkflow('release.yml');
  const requiredChecks = releaseWorkflow
    .match(/REQUIRED_CHECKS=\(\s*([\s\S]*?)\)/)[1]
    .match(/"([^"]+)"/g)
    .map((check) => check.slice(1, -1));

  assert.ok(
    requiredChecks.includes('quality'),
    'Renaming the aggregate job without updating the release gate would stall every release.',
  );
  assert.match(ciWorkflow, /^ {4}name: quality$/m);
});

test('CI validates the exact commit that landed on the protected branch', () => {
  assert.match(
    ciWorkflow,
    /VALIDATED_REF: \$\{\{ github\.event_name == 'push' && github\.sha \|\| '' \}\}/,
  );
  const checkouts = ciWorkflow.match(/uses: actions\/checkout@[^\n]*\n\s*with:\n\s*ref: \$\{\{ env\.VALIDATED_REF \}\}/g);
  assert.equal(
    checkouts?.length,
    6,
    'Every CI job must check out the validated ref so the layers agree on one tree.',
  );
});

test('the webview job installs only the browser binary on the hosted runner', () => {
  const webview = ciWorkflow.match(/^ {2}webview-tests:\n([\s\S]*?)(?=\n {2}integration-tests:)/m)[1];

  assert.match(webview, /run: npx playwright install chromium/);
  assert.doesNotMatch(
    webview,
    /playwright install(?: --with-deps|-deps)/,
    'The hosted runner provides Chromium system libraries, so apt-based dependency '
      + 'installation can hang on an unavailable mirror.',
  );
});

test('every CI checkout refuses to persist the workflow credential', () => {
  const checkouts = ciWorkflow.match(/uses: actions\/checkout@[0-9a-f]{40}/g) ?? [];
  const persistFlags = ciWorkflow.match(/persist-credentials: false/g) ?? [];
  assert.equal(
    checkouts.length,
    persistFlags.length,
    'A checkout that persists credentials leaves a push-capable token on disk for later steps.',
  );
});

test('every CI job declares a timeout so a hung run cannot block the queue', () => {
  const jobsSection = ciWorkflow.match(/^jobs:\n([\s\S]*)$/m)[1];
  const jobs = jobsSection.match(/^ {2}[a-z][a-z-]*:$/gm) ?? [];
  const timeouts = jobsSection.match(/^ {4}timeout-minutes: \d+$/gm) ?? [];
  assert.equal(jobs.length, timeouts.length, 'Each CI job needs a timeout-minutes value.');
});

test('every npm script CI runs is reachable from preflight', () => {
  // A check that only exists in the workflow cannot be reproduced locally, so it
  // fails for the first time in CI. `npm run preflight` must be the whole gate.
  const { scripts } = JSON.parse(
    fs.readFileSync(path.join(REPOSITORY_ROOT, 'package.json'), 'utf8'),
  );

  const referenced = (command) => {
    const names = new Set();
    for (const [, name] of command.matchAll(/npm run ([\w:@./-]+)/g)) {
      names.add(name);
    }
    for (const [, list] of command.matchAll(/npm-run-all2\s+-[sp]\s+([^&|\n]+)/g)) {
      for (const token of list.trim().split(/\s+/)) {
        if (token.startsWith('-')) {
          continue;
        }
        if (token.includes('*')) {
          const prefix = token.slice(0, token.indexOf('*'));
          Object.keys(scripts)
            .filter((candidate) => candidate.startsWith(prefix))
            .forEach((candidate) => names.add(candidate));
        } else {
          names.add(token);
        }
      }
    }
    return names;
  };

  const reachable = new Set();
  const pending = ['preflight'];
  while (pending.length > 0) {
    const name = pending.pop();
    if (reachable.has(name) || !(name in scripts)) {
      continue;
    }
    reachable.add(name);
    pending.push(`pre${name}`, `post${name}`, ...referenced(scripts[name]));
  }

  const missing = [...ciWorkflow.matchAll(/npm run ([\w:@./-]+)/g)]
    .map(([, name]) => name)
    .filter((name) => !reachable.has(name));

  assert.deepEqual(
    [...new Set(missing)],
    [],
    'CI runs scripts that `npm run preflight` never reaches, so a contributor '
    + `cannot reproduce the failure before pushing: ${missing.join(', ')}`,
  );
});
