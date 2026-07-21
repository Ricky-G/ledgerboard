#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const root = path.resolve(__dirname, '..');
const denyHashes = JSON.parse(fs.readFileSync(path.join(__dirname, 'privacy-deny-hashes.json'), 'utf8'));
const textExtensions = new Set([
  '.cjs', '.css', '.html', '.js', '.json', '.md', '.mjs', '.ts', '.txt', '.yml', '.yaml',
]);
const allowedStandardAreas = new Set(['client-a', 'client-b', 'internal', 'project-alpha', 'team-ops']);
const failures = [];

const files = childProcess.execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  cwd: root,
  encoding: 'utf8',
}).split(/\r?\n/).filter(Boolean);

for (const relativePath of files) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath) || !textExtensions.has(path.extname(relativePath).toLowerCase())) continue;

  const content = fs.readFileSync(absolutePath, 'utf8');
  checkGenericPatterns(relativePath, content);
  checkHashedTerms(relativePath, content);

  if (relativePath === 'BOARD-STANDARDS.md') {
    for (const match of content.matchAll(/area:([a-z0-9][a-z0-9-]*)/g)) {
      if (!allowedStandardAreas.has(match[1])) {
        failures.push(`${relativePath}: non-generic example area '${match[1]}'`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Privacy scan failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Privacy scan passed: ${files.length} repository files checked.`);
}

function checkGenericPatterns(relativePath, content) {
  const checks = [
    { label: 'email address', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
    { label: 'absolute Windows path', pattern: /\b[A-Z]:\\(?:Users|_GitHub|Projects|Repos|OneDrive)\\/i },
    { label: 'user-home path', pattern: /(?:^|[\s"'])~\/(?:Documents|Downloads|OneDrive|Projects|Repos)\//im },
    { label: 'actual board file', pattern: /^(?:# .*Kanban Board|## Inbox\s*$[\s\S]*^- \[[ x]\] AO-\d{3,})/m },
  ];
  checks.forEach(({ label, pattern }) => {
    if (pattern.test(content) && !isExpectedDocumentation(relativePath, label)) {
      failures.push(`${relativePath}: contains ${label}`);
    }
  });
}

function checkHashedTerms(relativePath, content) {
  const tokens = normalize(content).split(' ').filter(Boolean);
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
}

function isExpectedDocumentation(relativePath, label) {
  return (label === 'actual board file' && relativePath === 'BOARD-STANDARDS.md')
    || (label === 'email address' && relativePath === 'package-lock.json');
}

function normalize(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
