#!/usr/bin/env node

/**
 * Coverage runner for the deterministic Node test layers.
 *
 * Node's built-in test runner provides coverage, so no extra dependency is
 * required. Thresholds live in `coverage-policy.json` next to this script and
 * are enforced by the `unit-tests` CI check. Raise them when a change lifts the
 * measured baseline; never lower them without a reviewed exception recorded in
 * the pull request.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, '..');
const policy = JSON.parse(readFileSync(path.join(scriptDir, 'coverage-policy.json'), 'utf8'));

const reportDir = path.join(repositoryRoot, 'coverage');
mkdirSync(reportDir, { recursive: true });

const args = [
  '--test',
  '--experimental-test-coverage',
  `--test-coverage-lines=${policy.thresholds.lines}`,
  `--test-coverage-branches=${policy.thresholds.branches}`,
  `--test-coverage-functions=${policy.thresholds.functions}`,
  ...policy.include.map((pattern) => `--test-coverage-include=${pattern}`),
  ...policy.exclude.map((pattern) => `--test-coverage-exclude=${pattern}`),
  '--test-reporter=spec',
  '--test-reporter-destination=stdout',
  '--test-reporter=lcov',
  `--test-reporter-destination=${path.join(reportDir, 'lcov.info')}`,
  ...policy.suites,
];

console.log(`Coverage thresholds: lines ${policy.thresholds.lines}%, `
  + `branches ${policy.thresholds.branches}%, functions ${policy.thresholds.functions}%.`);

const result = spawnSync(process.execPath, args, { cwd: repositoryRoot, stdio: 'inherit' });

if (result.error) {
  console.error(`Coverage run could not start: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
