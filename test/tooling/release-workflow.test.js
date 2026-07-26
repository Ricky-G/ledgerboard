const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { REPOSITORY_ROOT } = require('../helpers/repository.js');

const releaseWorkflow = fs.readFileSync(
  path.join(REPOSITORY_ROOT, '.github', 'workflows', 'release.yml'),
  'utf8',
).replace(/\r\n/g, '\n');

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
  assert.match(releaseWorkflow, /needs: \[wait-for-required-checks\]/);
});

test('release recovery can repair and publish an existing release tag', () => {
  const resolvePublication = releaseWorkflow.match(
    /  resolve-publication:[\s\S]*?(?=\n  publish:)/,
  )[0];
  const publish = releaseWorkflow.match(/  publish:[\s\S]*$/)[0];

  assert.match(releaseWorkflow, /workflow_dispatch:\s+inputs:\s+tag:/);
  assert.match(
    releaseWorkflow,
    /  release:\s+name: Create release preparation\s+if: github\.event_name == 'push'/,
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
