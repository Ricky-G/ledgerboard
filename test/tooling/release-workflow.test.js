const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { REPOSITORY_ROOT } = require('../helpers/repository.js');

const releaseWorkflow = fs.readFileSync(
  path.join(REPOSITORY_ROOT, '.github', 'workflows', 'release.yml'),
  'utf8',
).replace(/\r\n/g, '\n');

const prepareReleasePath = path.join(
  REPOSITORY_ROOT,
  '.github',
  'workflows',
  'prepare-release.yml',
);
const prepareReleaseWorkflow = fs.existsSync(prepareReleasePath)
  ? fs.readFileSync(prepareReleasePath, 'utf8').replace(/\r\n/g, '\n')
  : '';

const publishWorkflow = fs.readFileSync(
  path.join(REPOSITORY_ROOT, '.github', 'workflows', 'publish.yml'),
  'utf8',
).replace(/\r\n/g, '\n');

const AsyncFunction = Object.getPrototypeOf(async function workflowScript() {}).constructor;

function compileGithubScript(jobSource) {
  const scriptBlock = jobSource.match(/\n {10}script: \|\n([\s\S]*)$/)[1];
  const script = scriptBlock
    .split('\n')
    .map((line) => line.startsWith('            ') ? line.slice(12) : line)
    .join('\n');
  return new AsyncFunction('github', 'context', 'process', script);
}

function createReportHarness(waitResult) {
  const created = [];
  const context = {
    serverUrl: 'https://github.com',
    repo: { owner: 'Ricky-G', repo: 'ledgerboard' },
    runId: 123,
    sha: 'main-sha',
  };
  const github = {
    rest: {
      checks: {
        listForRef: async ({ ref }) => ({
          data: {
            check_runs: ref === context.sha
              ? [
                {
                  name: 'quality',
                  status: 'completed',
                  conclusion: 'failure',
                  details_url: 'https://github.com/Ricky-G/ledgerboard/actions/runs/1',
                  started_at: '2026-07-30T22:00:00Z',
                },
                {
                  name: 'webview-tests',
                  status: 'completed',
                  conclusion: 'failure',
                  details_url: 'https://github.com/Ricky-G/ledgerboard/actions/runs/2',
                  started_at: '2026-07-30T21:59:00Z',
                },
                {
                  name: 'Wait for required merge gates',
                  status: 'completed',
                  conclusion: 'failure',
                  details_url: 'https://github.com/Ricky-G/ledgerboard/actions/runs/3',
                  started_at: '2026-07-30T22:01:00Z',
                },
              ]
              : [{
                name: 'quality',
                status: 'completed',
                conclusion: 'failure',
                details_url: 'https://github.com/Ricky-G/ledgerboard/actions/runs/4',
                started_at: '2026-07-30T21:58:00Z',
              }],
          },
        }),
      },
      repos: {
        listPullRequestsAssociatedWithCommit: async () => ({
          data: [{ number: 56, merged_at: '2026-07-30T22:10:00Z' }],
        }),
      },
      pulls: {
        get: async () => ({
          data: {
            number: 56,
            html_url: 'https://github.com/Ricky-G/ledgerboard/pull/56',
            merged_by: { login: 'maintainer' },
            head: { sha: 'pull-head-sha' },
          },
        }),
      },
      issues: {
        listForRepo: async () => ({ data: [] }),
        create: async (payload) => {
          created.push(payload);
        },
        createComment: async () => {
          throw new Error('A new issue should be created when no matching issue exists.');
        },
      },
    },
  };
  const processMock = {
    env: {
      WAIT_RESULT: waitResult,
      RELEASE_RESULT: waitResult === 'failure' ? 'skipped' : 'failure',
      RESOLVE_RESULT: 'skipped',
      PUBLISH_RESULT: 'skipped',
    },
  };
  return { context, created, github, processMock };
}

test('release preparation leaves the sole-maintainer merge decision manual', () => {
  assert.match(prepareReleaseWorkflow, /^name: Prepare release$/m);
  assert.match(prepareReleaseWorkflow, /^on:\n  workflow_dispatch:$/m);
  assert.doesNotMatch(prepareReleaseWorkflow, /^ {2}push:/m);
  assert.match(
    prepareReleaseWorkflow,
    /^ {4}concurrency:\n {6}group: release-please\n {6}cancel-in-progress: false$/m,
  );
  assert.match(prepareReleaseWorkflow, /^ {10}skip-github-release: true$/m);
  assert.match(prepareReleaseWorkflow, /steps\.release-please\.outputs\.prs_created/);
  assert.match(prepareReleaseWorkflow, /steps\.release-please\.outputs\.pr/);
  assert.doesNotMatch(prepareReleaseWorkflow, /gh pr merge/);
  assert.match(prepareReleaseWorkflow, /Bypass rules and merge/);
  assert.match(prepareReleaseWorkflow, /required checks pass/);
  assert.match(prepareReleaseWorkflow, /squash method/);
});

test('ordinary main merges cannot create or update a release pull request', () => {
  const release = releaseWorkflow.match(
    /  release:[\s\S]*?(?=\n  resolve-publication:)/,
  )[0];

  assert.match(releaseWorkflow, /^ {2}identify-release-merge:$/m);
  assert.match(releaseWorkflow, /commits\/\$GITHUB_SHA\/pulls/);
  assert.match(releaseWorkflow, /autorelease: pending/);
  assert.match(releaseWorkflow, /release-please--branches--main--components--ledgerboard/);
  assert.match(
    release,
    /if: github\.event_name == 'push' && needs\.identify-release-merge\.outputs\.release_merge == 'true'/,
  );
  assert.match(release, /^ {10}skip-github-pull-request: true$/m);
});

test('release waits for required push check runs on the merge commit', () => {
  const requiredChecks = releaseWorkflow
    .match(/REQUIRED_CHECKS=\(\s*([\s\S]*?)\)/)[1]
    .match(/"([^"]+)"/g)
    .map((check) => check.slice(1, -1));

  assert.deepEqual(requiredChecks, [
    'quality',
    'dependency-security',
    'secret-scan',
    'analyze',
  ]);
  assert.match(releaseWorkflow, /commits\/\$GITHUB_SHA\/check-runs/);
  assert.doesNotMatch(releaseWorkflow, /dependency-review/);
});

test('release gates on recorded check results rather than repeating CI', () => {
  // Re-running the suites here would double the time to publish while proving
  // nothing new: `quality` already covered this exact commit.
  assert.doesNotMatch(
    releaseWorkflow,
    /^ {2}validate:$/m,
    'The release path must not duplicate the CI suites.',
  );
  assert.match(releaseWorkflow, /needs: \[identify-release-merge, wait-for-required-checks\]/);
});

test('release recovery can repair and publish an existing release tag', () => {
  const resolvePublication = releaseWorkflow.match(
    /  resolve-publication:[\s\S]*?(?=\n  publish:)/,
  )[0];
  const publish = releaseWorkflow.match(/  publish:[\s\S]*$/)[0];

  assert.match(releaseWorkflow, /workflow_dispatch:\s+inputs:\s+tag:/);
  assert.match(
    releaseWorkflow,
    /  release:\s+name: Create tagged release\s+needs: \[identify-release-merge, wait-for-required-checks\]/,
  );
  assert.match(resolvePublication, /if: always\(\) && \(github\.event_name == 'workflow_dispatch'/);
  assert.match(resolvePublication, /permissions:\s+contents: write/);
  assert.match(resolvePublication, /RECOVERY_TAG: \$\{\{ inputs\.tag \}\}/);
  assert.match(resolvePublication, /\[\[ "\$RELEASE_TAG" =~ \^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$ \]\]/);
  assert.match(resolvePublication, /Recovery tag \$RELEASE_TAG must have an existing GitHub Release/);
  assert.match(resolvePublication, /git checkout --detach "\$TAG_COMMIT"/);
  assert.match(resolvePublication, /Release tag \$RELEASE_TAG does not match package version \$PACKAGE_VERSION/);
  assert.match(resolvePublication, /git push --force origin "refs\/tags\/\$RELEASE_TAG"/);
  assert.match(resolvePublication, /echo "publish=true" >> "\$GITHUB_OUTPUT"/);
  assert.match(publish, /if: always\(\) && needs\.resolve-publication\.outputs\.publish == 'true'/);
  assert.match(publish, /uses: \.\/\.github\/workflows\/publish\.yml/);
});

test('the called publish workflow receives the marketplace credential', () => {
  // A called workflow starts with an empty `secrets` context. Without
  // `secrets: inherit` the publish job still stops at the marketplace approval
  // gate, but `secrets.VSCE_PAT` resolves to an empty string, so publication
  // fails after a reviewer has already approved it.
  const publish = releaseWorkflow.match(/^ {2}publish:\n[\s\S]*?(?=\n {2}report-failure:)/m)[0];

  assert.match(
    publish,
    /^ {4}secrets: inherit$/m,
    'The publish job must inherit secrets or the marketplace credential is empty.',
  );
});

test('publication is never held behind the Release Please mutation lock', () => {
  // GitHub cancels an already-pending run when a newer one joins the same
  // concurrency group. A workflow-level lock therefore puts publication at risk
  // of being cancelled while a tag already exists, which leaves the Marketplace
  // behind this repository with no way to notice.
  assert.doesNotMatch(
    releaseWorkflow,
    /^concurrency:$/m,
    'A workflow-level lock also covers publication. Lock release preparation only.',
  );

  const release = releaseWorkflow.match(/^ {2}release:\n[\s\S]*?(?=\n {2}resolve-publication:)/m)[0];
  assert.match(release, /^ {4}concurrency:\n {6}group: release-please\n {6}cancel-in-progress: false$/m);

  for (const job of ['wait-for-required-checks', 'resolve-publication', 'publish']) {
    const source = releaseWorkflow.match(
      new RegExp(`^ {2}${job}:\\n[\\s\\S]*?(?=\\n {2}[a-z-]+:\\n)`, 'm'),
    )[0];
    assert.doesNotMatch(
      source,
      /^ {4}concurrency:$/m,
      `${job} must not share the release preparation lock.`,
    );
  }
});

test('a failed release reports itself instead of waiting to be noticed', () => {
  const report = releaseWorkflow.match(/^ {2}report-failure:\n[\s\S]*$/m)[0];

  assert.match(report, /^ {4}if: always\(\) && contains\(needs\.\*\.result, 'failure'\)$/m);
  assert.match(report, /^ {6}checks: read$/m);
  assert.match(report, /^ {6}contents: read$/m);
  assert.match(report, /^ {6}issues: write$/m);
  assert.match(report, /^ {6}pull-requests: read$/m);
  for (const dependency of [
    'wait-for-required-checks',
    'release',
    'resolve-publication',
    'publish',
  ]) {
    assert.ok(
      report.includes(dependency),
      `report-failure must depend on ${dependency} to observe its result.`,
    );
  }
  assert.match(report, /issues\.create/);
});

test('main validation failures report the broken layers and the bypass recovery record', () => {
  const report = releaseWorkflow.match(/^ {2}report-failure:\n[\s\S]*$/m)[0];

  assert.match(report, /const validationFailed = process\.env\.WAIT_RESULT === 'failure';/);
  assert.match(
    report,
    /validationFailed\s+\? '\[Automation\] Main validation failed'\s+: '\[Automation\] Release automation failed'/,
  );
  assert.match(report, /checks\.listForRef/);
  assert.match(report, /listPullRequestsAssociatedWithCommit/);
  assert.match(report, /CI \/ quality.*concluded/);
  assert.match(report, /Failed check.*Conclusion/);
  assert.match(report, /Document why the emergency bypass or post-merge failure occurred/);
  assert.match(report, /Tagged release creation did not start, so there is no release tag to publish/);
});

test('main validation reporting creates an actionable recovery issue', async () => {
  const report = releaseWorkflow.match(/^ {2}report-failure:\n[\s\S]*$/m)[0];
  const harness = createReportHarness('failure');

  await compileGithubScript(report)(harness.github, harness.context, harness.processMock);

  assert.equal(harness.created.length, 1);
  assert.equal(harness.created[0].title, '[Automation] Main validation failed');
  assert.match(harness.created[0].body, /\[#56\].*merged by @maintainer/);
  assert.match(harness.created[0].body, /\[webview-tests\].*\| failure \|/);
  assert.doesNotMatch(harness.created[0].body, /\[Wait for required merge gates\]/);
  assert.match(harness.created[0].body, /CI \/ quality.*concluded `failure`/);
  assert.doesNotMatch(harness.created[0].body, /publish the existing tag/);
});

test('existing-tag recovery is reserved for failures after main validation', async () => {
  const report = releaseWorkflow.match(/^ {2}report-failure:\n[\s\S]*$/m)[0];
  const harness = createReportHarness('success');

  await compileGithubScript(report)(harness.github, harness.context, harness.processMock);

  assert.equal(harness.created.length, 1);
  assert.equal(harness.created[0].title, '[Automation] Release automation failed');
  assert.match(harness.created[0].body, /publish the existing tag/);
  assert.doesNotMatch(harness.created[0].body, /Main validation failed/);
});

test('publishing verifies the artifact instead of repeating CI', () => {
  // The tag points at the commit `quality` already validated, which the
  // resolve-publication job asserts. Re-running the suites here would add
  // minutes to every publication while proving nothing new, and it would
  // contradict the same decision already made for the release path.
  for (const script of ['test:coverage', 'test:performance', 'test:integration']) {
    assert.doesNotMatch(
      publishWorkflow,
      new RegExp(`npm run ${script}`),
      `publish.yml must not rerun ${script}: quality already ran it on this commit.`,
    );
  }
  assert.doesNotMatch(publishWorkflow, /xvfb-run/);
  assert.match(
    publishWorkflow,
    /npm run test:packaging/,
    'Publication must still build and verify the artifact customers install.',
  );
});
