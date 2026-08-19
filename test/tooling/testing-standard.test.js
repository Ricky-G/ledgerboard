const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { REPOSITORY_ROOT } = require('../helpers/repository.js');

function read(...segments) {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, ...segments), 'utf8');
}

const packageJson = JSON.parse(read('package.json'));

test('every test layer has a documented, runnable npm script', () => {
  const layers = {
    'test:unit': 'test/unit',
    'test:tooling': 'test/tooling',
    'test:webview': 'test/webview/specs',
    'test:integration': 'src/test',
    'test:packaging': 'test/packaging',
    'test:performance': 'test/performance',
  };

  const standard = read('docs', 'testing.md');
  for (const [script, directory] of Object.entries(layers)) {
    assert.ok(packageJson.scripts[script], `package.json is missing the ${script} script.`);
    assert.ok(
      fs.existsSync(path.join(REPOSITORY_ROOT, directory)),
      `The ${script} layer has no ${directory} directory.`,
    );
    assert.ok(
      standard.includes(script),
      `docs/testing.md must document how to run ${script}.`,
    );
    assert.ok(
      standard.includes(directory),
      `docs/testing.md must say that the ${script} layer lives in ${directory}.`,
    );
  }
});

test('preflight runs every layer so one command matches CI', () => {
  assert.equal(packageJson.scripts.preflight, 'npm-run-all2 -s static test:all');
  for (const layer of [
    'test:coverage',
    'test:performance',
    'test:webview',
    'test:integration',
    'test:packaging',
  ]) {
    assert.ok(
      packageJson.scripts['test:all'].includes(layer),
      `test:all must include ${layer} so preflight matches what CI enforces.`,
    );
  }
});

test('the coverage ratchet is configured and enforced', () => {
  const policy = JSON.parse(read('scripts', 'coverage-policy.json'));
  assert.equal(policy.thresholds.lines, 97.20, 'Line coverage must retain the board-repair baseline.');
  assert.ok(policy.thresholds.lines > 0);
  assert.ok(policy.thresholds.branches > 0);
  assert.ok(policy.thresholds.functions > 0);
  assert.ok(policy.suites.length > 0);
  assert.ok(policy.include.length > 0);
  assert.ok(
    policy.include.includes('src/webview/context-menu-position.js'),
    'Coverage must include the ticket action menu positioning helper.',
  );
  assert.equal(packageJson.scripts['test:coverage'], 'node scripts/run-coverage.mjs');
});

test('the mandatory testing rule is stated where contributors and agents will read it', () => {
  // The user-facing promise of this repository is that no change lands without a
  // test at the right layer. That rule has to survive in writing, not just in
  // review habits, so these files are asserted rather than assumed.
  const sources = {
    '.github/copilot-instructions.md': read('.github', 'copilot-instructions.md'),
    'CONTRIBUTING.md': read('CONTRIBUTING.md'),
    '.github/PULL_REQUEST_TEMPLATE.md': read('.github', 'PULL_REQUEST_TEMPLATE.md'),
  };

  for (const [name, source] of Object.entries(sources)) {
    assert.match(
      source,
      /docs\/testing\.md/,
      `${name} must point at the testing standard.`,
    );
    assert.match(
      source,
      /adds or updates a test at the layer that owns the behavior|added or updated a test at the layer/,
      `${name} must state the mandatory testing rule.`,
    );
  }

  assert.match(
    sources['.github/copilot-instructions.md'],
    /Never weaken a test to make a build green/,
    'Agent instructions must forbid weakening a test to pass CI.',
  );
  assert.match(
    sources['.github/PULL_REQUEST_TEMPLATE.md'],
    /fails without my change/,
    'The pull request template must ask whether the new test actually covers the change.',
  );
});

test('the public-writing rule is stated where contributors and agents will read it', () => {
  // The repository is public, so prose that points at a conversation a reader
  // cannot open leaks context they have no way to verify.
  for (const [name, source] of Object.entries({
    '.github/copilot-instructions.md': read('.github', 'copilot-instructions.md'),
    'CONTRIBUTING.md': read('CONTRIBUTING.md'),
  })) {
    assert.match(
      source,
      /private conversation/,
      `${name} must forbid referencing a conversation a reader cannot open.`,
    );
    assert.match(
      source,
      /privacy:scan/,
      `${name} must name the check that enforces this mechanically.`,
    );
  }

  assert.match(
    read('.github', 'PULL_REQUEST_TEMPLATE.md'),
    /stand on their own/,
    'The pull request template must ask the author to confirm the description needs no hidden context.',
  );
});
