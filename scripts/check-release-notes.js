'use strict';

// A squash merge turns a pull request into one commit, and Release Please turns
// one commit into one changelog entry. That entry is the pull request title,
// which is written for maintainers, so a release reads as a list of engineering
// tasks rather than what changed for someone using the extension.
//
// Release Please splits a commit message on BEGIN_NESTED_COMMIT and
// END_NESTED_COMMIT markers and treats each block as its own commit, so one
// pull request can contribute several changelog entries. Because the squash
// commit message is the pull request body, those blocks are written and
// reviewed in the pull request itself.
//
// This check runs against the pull request body and fails when a block would
// not produce the entry its author expected, or when text outside a block would
// silently produce one nobody intended.

const fs = require('node:fs');
const path = require('node:path');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');

const BLOCK_START = 'BEGIN_NESTED_COMMIT';
const BLOCK_END = 'END_NESTED_COMMIT';

// The set Release Please looks for when it splits the body of a commit message.
// Any of these at the start of a line, following a blank line, becomes an entry.
const CONVENTIONAL_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
];

const CONVENTIONAL_PREFIX = new RegExp(`^(${CONVENTIONAL_TYPES.join('|')})(\\([^)]*\\))?!?: `);

/** The commit types that .release-please-config.json maps to a changelog section. */
function readReleasingTypes(root = REPOSITORY_ROOT) {
  const configPath = path.join(root, '.release-please-config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const sections = config.packages?.['.']?.['changelog-sections'] ?? [];

  if (sections.length === 0) {
    throw new Error(`${configPath} declares no changelog-sections, so no entry can be validated.`);
  }

  // `breaking` names a section rather than a commit type. Release Please fills
  // it from a `!` marker or a BREAKING CHANGE footer, not from a `breaking:`
  // prefix, so it is not something an author can write at the start of a block.
  return sections.map((section) => section.type).filter((type) => type !== 'breaking');
}

function parseBlocks(lines) {
  const blocks = [];
  const problems = [];
  let open = null;

  lines.forEach((raw, index) => {
    const number = index + 1;
    const trimmed = raw.trim();

    for (const marker of [BLOCK_START, BLOCK_END]) {
      if (raw.includes(marker) && trimmed !== marker) {
        problems.push(
          `Line ${number}: ${marker} must be alone on its line. Release Please splits on the `
            + 'marker wherever it appears, so surrounding text corrupts the entry.',
        );
      }
    }

    if (trimmed === BLOCK_START) {
      if (open) {
        problems.push(
          `Line ${number}: ${BLOCK_START} opens inside the block opened on line ${open.line}. `
            + 'Blocks cannot nest.',
        );
      } else {
        open = { line: number, lines: [] };
      }
      return;
    }

    if (trimmed === BLOCK_END) {
      if (open) {
        blocks.push(open);
        open = null;
      } else {
        problems.push(`Line ${number}: ${BLOCK_END} has no matching ${BLOCK_START}.`);
      }
      return;
    }

    if (open) {
      open.lines.push({ number, text: raw });
    }
  });

  if (open) {
    problems.push(`Line ${open.line}: ${BLOCK_START} is never closed with ${BLOCK_END}.`);
  }

  return { blocks, problems };
}

function checkBlock(block, releasingTypes) {
  const problems = [];
  const subject = block.lines.find((line) => line.text.trim() !== '');

  if (!subject) {
    problems.push(`Line ${block.line}: the block is empty, so it produces no changelog entry.`);
    return problems;
  }

  if (subject.text !== subject.text.trimStart()) {
    problems.push(
      `Line ${subject.number}: the entry is indented. Release Please only reads a conventional `
        + 'commit at the start of a line.',
    );
    return problems;
  }

  const match = CONVENTIONAL_PREFIX.exec(subject.text);
  if (!match) {
    problems.push(
      `Line ${subject.number}: "${subject.text.trim()}" is not a conventional commit, so it `
        + `produces no changelog entry. Start it with one of: ${releasingTypes.join(', ')}.`,
    );
    return problems;
  }

  const type = match[1];
  if (!releasingTypes.includes(type)) {
    problems.push(
      `Line ${subject.number}: "${type}:" has no section in .release-please-config.json, so this `
        + `block is silently dropped from the changelog. Use one of: ${releasingTypes.join(', ')}.`,
    );
  }

  const description = subject.text.slice(match[0].length).trim();
  if (description === '') {
    problems.push(`Line ${subject.number}: the entry has no description.`);
  } else if (/[<>]/.test(description)) {
    problems.push(
      `Line ${subject.number}: "${description}" still contains the placeholder from the example. `
        + 'Describe the change as someone using the extension would see it.',
    );
  }

  return problems;
}

function checkStrayEntries(lines, blocks) {
  const inBlock = new Set();
  for (const block of blocks) {
    inBlock.add(block.line);
    for (const line of block.lines) {
      inBlock.add(line.number);
    }
    // The closing marker sits directly after the final captured line.
    inBlock.add((block.lines.at(-1)?.number ?? block.line) + 1);
  }

  const problems = [];
  lines.forEach((raw, index) => {
    const number = index + 1;
    if (inBlock.has(number) || !CONVENTIONAL_PREFIX.test(raw)) {
      return;
    }

    // Release Please splits the message on a blank line followed by a
    // conventional commit. The body itself follows the subject after a blank
    // line, so its first line splits too.
    const precededByBlankLine = index === 0 || lines[index - 1].trim() === '';
    if (!precededByBlankLine) {
      return;
    }

    problems.push(
      `Line ${number}: "${raw.trim()}" starts a line after a blank line, so Release Please turns `
        + `it into a changelog entry. Wrap it in ${BLOCK_START} and ${BLOCK_END} if that is `
        + 'intended, or indent it if it is not.',
    );
  });

  return problems;
}

function checkReleaseNotes(body, releasingTypes) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const { blocks, problems } = parseBlocks(lines);

  for (const block of blocks) {
    problems.push(...checkBlock(block, releasingTypes));
  }
  problems.push(...checkStrayEntries(lines, blocks));

  return { blockCount: blocks.length, problems };
}

function main() {
  const body = process.env.PULL_REQUEST_BODY;

  if (typeof body !== 'string' || body.trim() === '') {
    console.log('No pull request body to check, so there are no release notes to validate.');
    return 0;
  }

  const { blockCount, problems } = checkReleaseNotes(body, readReleasingTypes());

  if (problems.length > 0) {
    console.error('The release notes in this pull request body would not produce what you expect:');
    for (const problem of problems) {
      console.error(`  ${problem}`);
    }
    console.error('');
    console.error('See docs/releasing.md for the exact form of a release notes block.');
    return 1;
  }

  console.log(
    blockCount === 0
      ? 'Release notes check passed: the pull request title is the only changelog entry.'
      : `Release notes check passed: ${blockCount} additional changelog `
        + `${blockCount === 1 ? 'entry' : 'entries'} alongside the pull request title.`,
  );
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { BLOCK_START, BLOCK_END, checkReleaseNotes, readReleasingTypes, main };
