'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const test = require('node:test');

const { REPOSITORY_ROOT, repositoryPath } = require('../helpers/repository.js');

test('the working tree is pinned to LF on every platform', () => {
  const attributesPath = repositoryPath('.gitattributes');

  assert.ok(
    fs.existsSync(attributesPath),
    'The repository must have a .gitattributes file. Without one, line endings depend on each '
      + "contributor's core.autocrlf setting.",
  );

  const attributes = fs.readFileSync(attributesPath, 'utf8');

  assert.match(
    attributes,
    /^\* +text=auto +eol=lf *$/m,
    '.gitattributes must contain "* text=auto eol=lf". Without it a Windows checkout '
      + 'produces a CRLF working tree, and guards that compare a checked-in file against '
      + 'generator output fail locally while passing in CI.',
  );

  assert.match(
    attributes,
    /^\*\.png +binary *$/m,
    '.gitattributes must keep images binary so no line ending conversion is applied to them.',
  );
});

test('no tracked text file is committed with CRLF', () => {
  const listed = childProcess.spawnSync('git', ['ls-files', '--eol'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  });

  assert.equal(
    listed.status,
    0,
    `git ls-files --eol did not run: ${listed.error?.message ?? listed.stderr}`,
  );

  // The first column reports the line endings of the committed copy, which is
  // what a fresh checkout on any platform receives.
  const committedWithCarriageReturns = listed.stdout
    .split('\n')
    .filter((line) => /^i\/(?:crlf|mixed)\b/.test(line))
    .map((line) => line.split('\t').pop().trim());

  assert.deepEqual(
    committedWithCarriageReturns,
    [],
    'These files are committed with CRLF, which .gitattributes is meant to prevent. '
      + 'Run "git add --renormalize ." and commit the result.',
  );
});
