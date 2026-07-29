'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { REPOSITORY_ROOT, repositoryPath } = require('../helpers/repository.js');
const {
  BLOCK_START,
  BLOCK_END,
  checkReleaseNotes,
  readReleasingTypes,
  main,
} = require('../../scripts/check-release-notes.js');

const RELEASING_TYPES = readReleasingTypes();

function check(body) {
  return checkReleaseNotes(body, RELEASING_TYPES);
}

function block(...lines) {
  return [BLOCK_START, ...lines, BLOCK_END].join('\n');
}

test('the releasing types come from the changelog sections that actually exist', () => {
  const config = JSON.parse(fs.readFileSync(repositoryPath('.release-please-config.json'), 'utf8'));
  const sections = config.packages['.']['changelog-sections'].map((section) => section.type);

  assert.deepEqual(RELEASING_TYPES, sections.filter((type) => type !== 'breaking'));
  assert.ok(
    RELEASING_TYPES.includes('feat') && RELEASING_TYPES.includes('fix'),
    'A release note must be able to describe a feature or a fix.',
  );
  assert.ok(
    !RELEASING_TYPES.includes('breaking'),
    'breaking names a section, not a prefix an author can write.',
  );
});

test('a well formed block adds one changelog entry', () => {
  const result = check(['## What changed', '', block('feat: group cards by assignee')].join('\n'));

  assert.deepEqual(result.problems, []);
  assert.equal(result.blockCount, 1);
});

test('several blocks each add an entry', () => {
  const result = check(
    [
      'Prose that is not a changelog entry.',
      '',
      block('feat: group cards by assignee', '', 'Longer description for the release notes.'),
      '',
      block('fix: keep the board readable at small window widths'),
    ].join('\n'),
  );

  assert.deepEqual(result.problems, []);
  assert.equal(result.blockCount, 2);
});

test('an unclosed block is rejected instead of swallowing the rest of the body', () => {
  const result = check([BLOCK_START, 'feat: group cards by assignee'].join('\n'));

  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /is never closed/);
});

test('a closing marker with no opening marker is rejected', () => {
  const result = check(['feat: something', BLOCK_END].join('\n'));

  assert.ok(result.problems.some((problem) => /has no matching/.test(problem)));
});

test('a marker sharing a line with other text is rejected', () => {
  const result = check([`<!-- ${BLOCK_START}`, 'feat: group cards by assignee', BLOCK_END].join('\n'));

  assert.ok(result.problems.some((problem) => /must be alone on its line/.test(problem)));
});

test('a block whose type has no changelog section is rejected', () => {
  const result = check(block('test: add a regression test for the parser'));

  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /has no section in \.release-please-config\.json/);
});

test('a block that is not a conventional commit is rejected', () => {
  const result = check(block('Group cards by assignee'));

  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /is not a conventional commit/);
});

test('an unedited example placeholder is rejected', () => {
  const result = check(block('feat: <what a reader can now do>'));

  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /still contains the placeholder/);
});

test('an empty block is rejected', () => {
  const result = check(block('', ''));

  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /the block is empty/);
});

test('a conventional commit outside a block is reported because it silently becomes an entry', () => {
  const result = check(['Some prose.', '', 'fix: this was never meant to ship as an entry'].join('\n'));

  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /turns it into a changelog entry/);
});

test('an indented conventional commit is left alone because Release Please ignores it', () => {
  const result = check(['Some prose.', '', '  fix: quoted in an example, not an entry'].join('\n'));

  assert.deepEqual(result.problems, []);
  assert.equal(result.blockCount, 0);
});

test('a conventional commit continuing a paragraph is left alone', () => {
  const result = check(['A sentence.', 'fix: still part of the paragraph above'].join('\n'));

  assert.deepEqual(result.problems, []);
});

test('the pull request template passes unedited', () => {
  // The template becomes the commit message of every squash merge, so a stray
  // conventional commit or an unbalanced marker in it would corrupt the
  // changelog for every pull request that does not edit that section.
  const template = fs.readFileSync(
    path.join(REPOSITORY_ROOT, '.github', 'PULL_REQUEST_TEMPLATE.md'),
    'utf8',
  );
  const result = check(template);

  assert.deepEqual(result.problems, []);
  assert.equal(result.blockCount, 0);
});

test('the pull request template tells authors where the release notes form lives', () => {
  const template = fs.readFileSync(
    path.join(REPOSITORY_ROOT, '.github', 'PULL_REQUEST_TEMPLATE.md'),
    'utf8',
  );

  assert.match(template, /^## Release notes$/m);
  assert.match(template, /docs\/releasing\.md/);
});

test('the release process documents the exact markers the parser looks for', () => {
  const releasing = fs.readFileSync(repositoryPath('docs', 'releasing.md'), 'utf8');

  assert.ok(
    releasing.includes(BLOCK_START) && releasing.includes(BLOCK_END),
    'docs/releasing.md must show the block form, because the template deliberately does not.',
  );
});

test('the agent instructions show the block form and the trap next to it', () => {
  const instructions = fs.readFileSync(repositoryPath('.github', 'copilot-instructions.md'), 'utf8');

  assert.ok(
    instructions.includes(BLOCK_START) && instructions.includes(BLOCK_END),
    'An agent that never opens docs/releasing.md still has to know the exact markers.',
  );
  assert.match(
    instructions,
    /Never start a line in the body with a Conventional Commit prefix/,
    'The instructions must warn that a bare prefix in the body silently becomes an entry.',
  );
});

test('a block opened inside another block is rejected', () => {
  const result = check([BLOCK_START, BLOCK_START, 'feat: one thing', BLOCK_END, BLOCK_END].join('\n'));

  assert.ok(result.problems.some((problem) => /opens inside the block opened on line/.test(problem)));
});

test('an indented entry inside a block is rejected', () => {
  const result = check(block('  feat: group cards by assignee'));

  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /the entry is indented/);
});

test('an entry with a prefix but no description is rejected', () => {
  const result = check(block('feat: '));

  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /has no description/);
});

test('no releasing type is documented as one that skips a release', () => {
  const releasingTypes = readReleasingTypes(REPOSITORY_ROOT);
  const instructions = fs.readFileSync(repositoryPath('.github', 'copilot-instructions.md'), 'utf8');
  const bullet = instructions
    .split('\n- ')
    .find((entry) => entry.includes('should not') && entry.includes('independently create a release'));

  assert.ok(bullet, 'The instructions must say which commit types skip a release.');

  for (const type of releasingTypes) {
    assert.ok(
      !bullet.includes(`\`${type}:\``),
      `"${type}:" has a section in .release-please-config.json, so it creates a release. The `
        + 'instructions must not list it as a type that skips one.',
    );
  }
});

test('the contributing guide accounts for every releasing type', () => {
  const contributing = fs.readFileSync(repositoryPath('CONTRIBUTING.md'), 'utf8');
  const section = contributing
    .split('### Versioning convention')[1]
    .split('### Automated lifecycle')[0];

  for (const type of readReleasingTypes(REPOSITORY_ROOT)) {
    assert.ok(
      section.includes(`\`${type}:\``),
      `The versioning convention must tell contributors what "${type}:" releases.`,
    );
  }
});

test('a configuration with no changelog sections fails loudly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerboard-release-notes-'));
  try {
    fs.writeFileSync(
      path.join(root, '.release-please-config.json'),
      JSON.stringify({ packages: { '.': { 'changelog-sections': [] } } }),
    );

    assert.throws(() => readReleasingTypes(root), /declares no changelog-sections/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function runMain(body) {
  const previous = process.env.PULL_REQUEST_BODY;
  const output = [];
  const { log, error } = console;

  if (body === undefined) {
    delete process.env.PULL_REQUEST_BODY;
  } else {
    process.env.PULL_REQUEST_BODY = body;
  }
  console.log = (line) => output.push(line);
  console.error = (line) => output.push(line);

  try {
    return { code: main(), output: output.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
    if (previous === undefined) {
      delete process.env.PULL_REQUEST_BODY;
    } else {
      process.env.PULL_REQUEST_BODY = previous;
    }
  }
}

test('the command passes when there is no pull request body to read', () => {
  const { code, output } = runMain(undefined);

  assert.equal(code, 0);
  assert.match(output, /No pull request body to check/);
});

test('the command passes when only the title carries the entry', () => {
  const { code, output } = runMain('## What changed\n\nNothing worth a second entry.');

  assert.equal(code, 0);
  assert.match(output, /the pull request title is the only changelog entry/);
});

test('the command counts the additional entries it accepted', () => {
  const { code, output } = runMain(
    [block('feat: group cards by assignee'), '', block('fix: keep the board readable')].join('\n'),
  );

  assert.equal(code, 0);
  assert.match(output, /2 additional changelog entries/);
});

test('the command reports every problem and points at the documentation', () => {
  const { code, output } = runMain(block('test: not a released type'));

  assert.equal(code, 1);
  assert.match(output, /would not produce what you expect/);
  assert.match(output, /has no section in \.release-please-config\.json/);
  assert.match(output, /See docs\/releasing\.md/);
});
