const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const releaseWorkflow = fs.readFileSync(
  path.resolve(__dirname, '..', '.github', 'workflows', 'release.yml'),
  'utf8',
);

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
