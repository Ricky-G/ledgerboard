const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { REPOSITORY_ROOT } = require('../helpers/repository.js');

const releaseWorkflow = fs.readFileSync(
  path.join(REPOSITORY_ROOT, '.github', 'workflows', 'release.yml'),
  'utf8',
).replace(/\r\n/g, '\n');

const publishWorkflow = fs.readFileSync(
  path.join(REPOSITORY_ROOT, '.github', 'workflows', 'publish.yml'),
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

test('publication is never held behind the release preparation lock', () => {
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
  assert.match(report, /^ {4}permissions:\n {6}issues: write$/m);
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
