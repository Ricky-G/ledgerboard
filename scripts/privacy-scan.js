#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const root = path.resolve(__dirname, '..');
const textExtensions = new Set([
  '.cjs', '.css', '.html', '.js', '.json', '.md', '.mjs', '.ts', '.txt', '.yml', '.yaml',
]);
const allowedStandardAreas = new Set(['client-a', 'client-b', 'internal', 'project-alpha', 'team-ops']);

const GENERIC_CHECKS = [
  { label: 'email address', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { label: 'absolute Windows path', pattern: /\b[A-Z]:\\(?:Users|_GitHub|Projects|Repos|OneDrive)\\/i },
  { label: 'user-home path', pattern: /(?:^|[\s"'])~\/(?:Documents|Downloads|OneDrive|Projects|Repos)\//im },
  { label: 'actual board file', pattern: /^(?:# .*Kanban Board|## Inbox\s*$[\s\S]*^- \[[ x]\] AO-\d{3,})/m },
  // This repository is public. Prose that points at an exchange a reader cannot
  // see leaks context they cannot verify, so documentation, comments, and
  // generated descriptions have to stand on their own.
  {
    label: 'reference to a private conversation',
    // "You asked" is only anchored to a sentence or line start, so ordinary
    // conditional prose such as "if you asked for a feature" is left alone. A
    // guard that fires on normal documentation gets disabled instead of obeyed.
    pattern: /(?:^|[.!?]["')\]]?\s+)you (?:asked|said|mentioned|wanted|requested)\b|\bas (?:we|you) (?:discussed|agreed)\b|\bper your (?:request|instruction|message)\b|\bour (?:conversation|chat|call)\b|\b(?:the|our) (?:chat|thread) (?:above|earlier)\b/im,
    // A document that bans a phrase has to quote it. Quoted spans are therefore
    // exempt, while the same phrase written as prose is not.
    stripQuoted: true,
  },
];

// Everything this file checks for has to appear verbatim in its own test.
const POLICY_FIXTURE = 'test/tooling/privacy-scan.test.js';

function stripQuotedSpans(content) {
  return content.replace(/"[^"\n]*"/g, '""').replace(/`[^`\n]*`/g, '``');
}

function checkGenericPatterns(relativePath, content) {
  return GENERIC_CHECKS
    .filter(({ label, pattern, stripQuoted }) => {
      if (isExpectedDocumentation(relativePath, label)) {
        return false;
      }
      return pattern.test(stripQuoted ? stripQuotedSpans(content) : content);
    })
    .map(({ label }) => `${relativePath}: contains ${label}`);
}

function checkHashedTerms(relativePath, content, denyHashes) {
  const tokens = normalize(content).split(' ').filter(Boolean);
  const failures = [];
  for (const [sizeText, hashes] of Object.entries(denyHashes)) {
    const size = Number(sizeText);
    const blocked = new Set(hashes);
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const phrase = tokens.slice(index, index + size).join(' ');
      if (blocked.has(hash(phrase))) {
        failures.push(`${relativePath}: contains blocked private identifier near token ${index + 1}`);
        break;
      }
    }
  }
  return failures;
}

function checkStandardAreas(relativePath, content) {
  if (relativePath !== 'BOARD-STANDARDS.md') {
    return [];
  }
  return [...content.matchAll(/area:([a-z0-9][a-z0-9-]*)/g)]
    .filter(([, area]) => !allowedStandardAreas.has(area))
    .map(([, area]) => `${relativePath}: non-generic example area '${area}'`);
}

function isExpectedDocumentation(relativePath, label) {
  // The scan's own test supplies a fixture for every pattern below, so it is
  // exempt from all of them rather than from a list that drifts out of date.
  if (relativePath === POLICY_FIXTURE) {
    return true;
  }
  return (label === 'actual board file'
      && (relativePath === 'BOARD-STANDARDS.md'
        || relativePath === '.github/extensions/ledgerboard-preview/sample-data.mjs'
        || /^test\//i.test(relativePath)
        || /^src\/test\//i.test(relativePath)))
    || (label === 'email address' && relativePath === 'package-lock.json')
    // The pattern below has to spell out the phrases it searches for.
    || (label === 'reference to a private conversation' && relativePath === 'scripts/privacy-scan.js');
}

function normalize(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// The scan is split so the decision logic can be tested directly: `scanFiles`
// takes the file list and a reader, while `main` supplies the repository ones.
function scanFiles(files, readFile, denyHashes) {
  const failures = [];
  for (const relativePath of files) {
    if (!textExtensions.has(path.extname(relativePath).toLowerCase())) continue;

    const content = readFile(relativePath);
    if (content === null) continue;

    failures.push(
      ...checkGenericPatterns(relativePath, content),
      ...checkHashedTerms(relativePath, content, denyHashes),
      ...checkStandardAreas(relativePath, content),
    );
  }
  return failures;
}

function reportFailures(failures, fileCount, out = console) {
  if (failures.length > 0) {
    out.error('Privacy scan failed:');
    failures.forEach((failure) => out.error(`- ${failure}`));
    return 1;
  }
  out.log(`Privacy scan passed: ${fileCount} repository files checked.`);
  return 0;
}

function trackedFiles() {
  return childProcess.execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  }).split(/\r?\n/).filter(Boolean);
}

function readTrackedFile(relativePath) {
  const absolutePath = path.join(root, relativePath);
  // `git ls-files` still lists a file that was deleted but not yet staged.
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : null;
}

function main() {
  const denyHashes = JSON.parse(fs.readFileSync(path.join(__dirname, 'privacy-deny-hashes.json'), 'utf8'));
  const files = trackedFiles();
  process.exitCode = reportFailures(scanFiles(files, readTrackedFile, denyHashes), files.length);
}

if (require.main === module) {
  main();
}

module.exports = {
  GENERIC_CHECKS,
  POLICY_FIXTURE,
  checkGenericPatterns,
  checkHashedTerms,
  checkStandardAreas,
  isExpectedDocumentation,
  readTrackedFile,
  reportFailures,
  scanFiles,
  stripQuotedSpans,
  trackedFiles,
};
