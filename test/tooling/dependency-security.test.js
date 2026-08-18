const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { REPOSITORY_ROOT } = require('../helpers/repository.js');
const {
  evaluateAuditReport,
  loadActiveExceptions,
} = require('../../scripts/audit-dependencies');

const dependencySecurityWorkflow = fs.readFileSync(
  path.join(REPOSITORY_ROOT, '.github', 'workflows', 'dependency-security.yml'),
  'utf8',
);
const dependencyReviewWorkflow = fs.readFileSync(
  path.join(REPOSITORY_ROOT, '.github', 'workflows', 'dependency-review.yml'),
  'utf8',
);

function auditReport(vulnerabilities) {
  return { vulnerabilities };
}

test('dependency audit exceptions only allow the documented advisory IDs', () => {
  const exceptions = loadActiveExceptions(new Date('2026-07-25T00:00:00Z'));
  const report = auditReport({
    tool: {
      severity: 'high',
      via: ['transitive'],
    },
    transitive: {
      severity: 'high',
      via: [
        {
          url: 'https://github.com/advisories/GHSA-mh99-v99m-4gvg',
        },
        {
          url: 'https://github.com/advisories/GHSA-rgw5-rvv9-x895',
        },
      ],
    },
    unknown: {
      severity: 'critical',
      via: [{
        url: 'https://github.com/advisories/GHSA-unknown',
      }],
    },
    unresolved: {
      severity: 'high',
      via: ['missing'],
    },
  });

  assert.deepEqual(evaluateAuditReport(report, exceptions), [{
    name: 'unknown',
    advisories: ['https://github.com/advisories/GHSA-unknown'],
  }, {
    name: 'unresolved',
    advisories: ['unresolved:missing'],
  }]);
});

test('dependency audit exceptions expire', () => {
  assert.throws(
    () => loadActiveExceptions(new Date('2026-11-01T00:00:00Z')),
    /Dependency audit exception expired/,
  );
});

test('dependency security runs the strict exception-aware audit command', () => {
  assert.match(dependencySecurityWorkflow, /run: npm run audit:dependencies/);
  assert.doesNotMatch(dependencySecurityWorkflow, /run: npm audit --audit-level=high/);
});

test('dependency review allowlists only the documented advisory IDs', () => {
  const exceptions = loadActiveExceptions(new Date('2026-07-25T00:00:00Z'));
  const configuredAdvisories = dependencyReviewWorkflow
    .match(/allow-ghsas: ([^\r\n]+)/)[1]
    .split(',')
    .sort();
  const documentedAdvisories = [...exceptions.keys()]
    .map((advisory) => advisory.slice(advisory.lastIndexOf('/') + 1))
    .sort();

  assert.match(dependencyReviewWorkflow, /fail-on-scopes: runtime,development,unknown/);
  assert.deepEqual(configuredAdvisories, documentedAdvisories);
});
