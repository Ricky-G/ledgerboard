const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { REPOSITORY_ROOT } = require('../helpers/repository.js');

const packageJson = JSON.parse(fs.readFileSync(
  path.join(REPOSITORY_ROOT, 'package.json'),
  'utf8',
));
const packageLock = JSON.parse(fs.readFileSync(
  path.join(REPOSITORY_ROOT, 'package-lock.json'),
  'utf8',
));

function parseVersion(version, description) {
  const match = version.match(/^\^?(\d+)\.(\d+)\.(\d+)$/);
  assert.ok(match, `${description} must be an exact or caret semantic version, received ${version}.`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

test('the declared and locked TypeScript versions satisfy typescript-eslint', () => {
  const declaredVersion = parseVersion(
    packageJson.devDependencies.typescript,
    'The declared TypeScript version',
  );
  const lockedVersion = parseVersion(
    packageLock.packages['node_modules/typescript'].version,
    'The locked TypeScript version',
  );
  const peerRange = packageLock.packages['node_modules/typescript-eslint'].peerDependencies.typescript;
  const upperBound = peerRange.match(/<(\d+\.\d+\.\d+)/);

  assert.ok(
    upperBound,
    `The typescript-eslint peer range must contain an exclusive upper bound, received ${peerRange}.`,
  );

  const maximumSupportedVersion = parseVersion(
    upperBound[1],
    'The typescript-eslint upper bound',
  );
  assert.ok(
    compareVersions(declaredVersion, maximumSupportedVersion) < 0,
    `Declared TypeScript ${packageJson.devDependencies.typescript} must satisfy typescript-eslint ${peerRange}.`,
  );
  assert.ok(
    compareVersions(lockedVersion, maximumSupportedVersion) < 0,
    `Locked TypeScript ${packageLock.packages['node_modules/typescript'].version} must satisfy typescript-eslint ${peerRange}.`,
  );
});
