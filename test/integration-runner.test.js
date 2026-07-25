const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const packageJson = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '..', 'package.json'),
  'utf8',
));
const integrationRunner = fs.readFileSync(
  path.resolve(__dirname, '..', 'scripts', 'run-integration-tests.mjs'),
  'utf8',
);
const testSuiteRunner = fs.readFileSync(
  path.resolve(__dirname, '..', 'src', 'test', 'runTestSuite.ts'),
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
