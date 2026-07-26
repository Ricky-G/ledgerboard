const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  GENERIC_CHECKS,
  POLICY_FIXTURE,
  checkGenericPatterns,
  checkHashedTerms,
  checkStandardAreas,
  isExpectedDocumentation,
  readTrackedFile,
  reportFailures,
  scanFiles,
  trackedFiles,
} = require('../../scripts/privacy-scan.js');

const label = (name) => GENERIC_CHECKS.find((check) => check.label === name);

test('the scan rejects the machine-specific details a contributor might paste in', () => {
  const cases = [
    ['docs/example.md', 'Contact someone@example.com for access.', 'email address'],
    ['docs/example.md', 'Open C:\\Users\\someone\\Projects\\board', 'absolute Windows path'],
    ['docs/example.md', 'Run it from ~/Projects/board', 'user-home path'],
  ];

  for (const [file, content, expected] of cases) {
    assert.deepEqual(
      checkGenericPatterns(file, content),
      [`${file}: contains ${expected}`],
      `The scan must reject a ${expected}.`,
    );
  }
});

test('the scan rejects prose that points at a conversation a reader cannot see', () => {
  // This repository is public. A reference to a private exchange leaves a reader
  // with context they cannot verify, so the wording has to stand on its own.
  const rejected = [
    'You asked that every task add a test.',
    'As we discussed, the gate stays required.',
    'Per your request the job was renamed.',
    'This came out of our conversation about coverage.',
    'See the thread above for the rationale.',
  ];

  for (const content of rejected) {
    assert.deepEqual(
      checkGenericPatterns('docs/example.md', content),
      ['docs/example.md: contains reference to a private conversation'],
      `The scan must reject: ${content}`,
    );
  }
});

test('the conversation check leaves ordinary second-person documentation alone', () => {
  // A guard that fires on normal prose gets disabled, so it has to be precise.
  const accepted = [
    'Run the layer you are changing before opening a pull request.',
    'You can install the Gitleaks CLI to reproduce the scan locally.',
    'If you asked for a feature, open an issue so the discussion is public.',
    'Our policy is documented in docs/pull-request-gates.md.',
    'The call to validateBundleSources throws when the board is malformed.',
  ];

  for (const content of accepted) {
    assert.deepEqual(
      checkGenericPatterns('docs/example.md', content),
      [],
      `The scan must accept ordinary documentation: ${content}`,
    );
  }
});

test('a document may quote a banned phrase in order to ban it', () => {
  // Otherwise the policy could not be written down without violating itself.
  assert.deepEqual(
    checkGenericPatterns(
      'CONTRIBUTING.md',
      'Phrases such as "you asked" or "as we discussed" imply hidden context.',
    ),
    [],
  );
  assert.deepEqual(
    checkGenericPatterns('docs/testing.md', 'Avoid `per your request` in a description.'),
    [],
  );
  // The same phrase written as prose is still rejected.
  assert.deepEqual(
    checkGenericPatterns('CONTRIBUTING.md', 'Per your request the job was renamed.'),
    ['CONTRIBUTING.md: contains reference to a private conversation'],
  );
});

test('the scan and its own fixture may spell out the phrases they search for', () => {
  assert.ok(isExpectedDocumentation('scripts/privacy-scan.js', 'reference to a private conversation'));
  assert.ok(isExpectedDocumentation(POLICY_FIXTURE, 'reference to a private conversation'));
  assert.ok(isExpectedDocumentation(POLICY_FIXTURE, 'email address'));
  assert.ok(!isExpectedDocumentation('docs/testing.md', 'reference to a private conversation'));
  assert.ok(!isExpectedDocumentation('README.md', 'email address'));
  assert.ok(!isExpectedDocumentation('scripts/privacy-scan.js', 'email address'));
});

test('test fixtures may contain realistic board Markdown but shipped docs may not', () => {
  const board = '# Team Kanban Board\n';
  assert.deepEqual(checkGenericPatterns('test/fixtures/board-fixtures.js', board), []);
  assert.deepEqual(checkGenericPatterns('src/test/extension.test.ts', board), []);
  assert.deepEqual(
    checkGenericPatterns('README.md', board),
    ['README.md: contains actual board file'],
  );
});

test('the hashed deny list matches a private term without storing it in the open', () => {
  const term = 'confidential programme name';
  const digest = crypto.createHash('sha256').update(term).digest('hex');

  assert.deepEqual(
    checkHashedTerms('docs/example.md', `Planning for ${term} continues.`, { 3: [digest] }),
    ['docs/example.md: contains blocked private identifier near token 3'],
  );
  assert.deepEqual(
    checkHashedTerms('docs/example.md', 'Planning continues.', { 3: [digest] }),
    [],
  );
});

test('the board standard only demonstrates generic example areas', () => {
  assert.deepEqual(checkStandardAreas('BOARD-STANDARDS.md', 'area:team-ops'), []);
  assert.deepEqual(
    checkStandardAreas('BOARD-STANDARDS.md', 'area:acme-migration'),
    ["BOARD-STANDARDS.md: non-generic example area 'acme-migration'"],
  );
  assert.deepEqual(checkStandardAreas('docs/testing.md', 'area:acme-migration'), []);
});

test('every generic check is labelled so a failure names what was found', () => {
  const labels = GENERIC_CHECKS.map((check) => check.label);
  assert.equal(new Set(labels).size, labels.length, 'Check labels must be unique.');
  for (const name of [
    'email address',
    'absolute Windows path',
    'user-home path',
    'actual board file',
    'reference to a private conversation',
  ]) {
    assert.ok(label(name), `The scan must keep the ${name} check.`);
  }
});

test('the scan only reads text files and tolerates a file that has been deleted', () => {
  const read = [];
  const contents = {
    'docs/example.md': 'Per your request the job was renamed.',
    'images/logo.png': 'ignored',
    'docs/deleted.md': null,
  };

  const failures = scanFiles(Object.keys(contents), (file) => {
    read.push(file);
    return contents[file];
  }, {});

  assert.deepEqual(read, ['docs/example.md', 'docs/deleted.md'], 'Binary paths must be skipped.');
  assert.deepEqual(failures, ['docs/example.md: contains reference to a private conversation']);
});

test('the scan reports every finding and signals failure through the exit code', () => {
  const errors = [];
  const logs = [];
  const out = { error: (line) => errors.push(line), log: (line) => logs.push(line) };

  assert.equal(reportFailures(['a: contains x', 'b: contains y'], 2, out), 1);
  assert.deepEqual(errors, ['Privacy scan failed:', '- a: contains x', '- b: contains y']);
  assert.deepEqual(logs, []);

  assert.equal(reportFailures([], 98, out), 0);
  assert.deepEqual(logs, ['Privacy scan passed: 98 repository files checked.']);
});

test('the scan covers untracked files so a leak cannot hide in an unstaged file', () => {
  const files = trackedFiles();
  assert.ok(files.includes('package.json'), 'The file list must come from the working tree.');
  assert.ok(files.includes(POLICY_FIXTURE), 'The scan must see its own test file.');
});

test('reading a file that git listed but no longer exists returns null', () => {
  // `git ls-files` still lists a file deleted without staging the deletion.
  assert.match(readTrackedFile('package.json'), /"name": "ledgerboard"/);
  assert.equal(readTrackedFile('docs/this-file-was-deleted.md'), null);
});
