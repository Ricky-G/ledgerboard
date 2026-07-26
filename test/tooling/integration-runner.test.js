const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { REPOSITORY_ROOT } = require('../helpers/repository.js');

const packageJson = JSON.parse(fs.readFileSync(
  path.join(REPOSITORY_ROOT, 'package.json'),
  'utf8',
));
const integrationRunner = fs.readFileSync(
  path.join(REPOSITORY_ROOT, 'scripts', 'run-integration-tests.mjs'),
  'utf8',
);
const testSuiteRunner = fs.readFileSync(
  path.join(REPOSITORY_ROOT, 'src', 'test', 'runTestSuite.ts'),
  'utf8',
);

test('integration tests use the maintained Electron harness without the vulnerable CLI', () => {
  assert.equal(
    packageJson.scripts['test:integration'],
    'node scripts/run-integration-tests.mjs',
  );
  assert.ok(packageJson.devDependencies['@vscode/test-electron']);
  assert.equal(packageJson.devDependencies['@vscode/test-cli'], undefined);
  assert.match(integrationRunner, /import \{ runTests \} from '@vscode\/test-electron'/);
  assert.match(integrationRunner, /extensionTestsPath: path\.join\(repositoryRoot, 'out', 'test', 'runTestSuite\.js'\)/);
  assert.match(testSuiteRunner, /export async function run\(\): Promise<void>/);
  assert.match(testSuiteRunner, /await import\('\.\/extension\.test\.js'\)/);
});

test('the integration harness launches an isolated, non-interactive editor profile', () => {
  // A developer's installed extensions or settings must never change the result,
  // so the harness always launches against a throwaway profile.
  for (const flag of ['--user-data-dir=', '--extensions-dir=', '--disable-workspace-trust', '--disable-telemetry']) {
    assert.ok(
      integrationRunner.includes(flag),
      `The integration harness must pass ${flag} so runs are reproducible.`,
    );
  }
  assert.match(integrationRunner, /mkdtempSync/, 'The harness must create a temporary profile.');
  assert.match(
    integrationRunner,
    /LEDGERBOARD_VSCODE_VERSION/,
    'CI must be able to pin the editor version it validates.',
  );
});

test('sandbox cleanup can never turn a passing integration run red', () => {
  // Windows holds handles open briefly after the editor exits, so an rmSync
  // that throws would fail a run in which every test passed.
  const cleanup = integrationRunner.match(/function removeSandbox\(\) \{([\s\S]*?)\n\}/);
  assert.ok(cleanup, 'Sandbox removal must live in one guarded helper.');
  assert.match(cleanup[1], /try \{/, 'Cleanup must swallow filesystem errors.');
  assert.match(cleanup[1], /maxRetries/, 'Cleanup must retry while handles are released.');
  assert.doesNotMatch(
    integrationRunner,
    /finally \{\n\s*fs\.rmSync/,
    'Call removeSandbox from the finally block so cleanup cannot throw.',
  );
});

test('the suite runner reports every failure instead of aborting on the first', () => {
  assert.match(
    testSuiteRunner,
    /const failures = results\.filter\(/,
    'The runner must aggregate results so one run reports the full picture.',
  );
  assert.match(testSuiteRunner, /passing, \$\{failures\.length\} failing/);
  assert.match(testSuiteRunner, /exceeded the \$\{timeoutMs\}ms timeout/, 'Hung tests must fail, not hang CI.');
  assert.match(testSuiteRunner, /suiteTeardown\(body: TestBody\)/);
});

test('every integration test isolates itself in a dedicated temporary workspace', () => {
  const suiteSource = fs.readFileSync(
    path.join(REPOSITORY_ROOT, 'src', 'test', 'extension.test.ts'),
    'utf8',
  );
  assert.match(suiteSource, /async function withWorkspace\(/);
  assert.match(suiteSource, /Math\.random\(\)\.toString\(36\)/, 'Fixture names must not collide between runs.');
});
