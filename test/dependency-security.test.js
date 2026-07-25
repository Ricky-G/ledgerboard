const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  evaluateAuditReport,
  loadActiveExceptions,
} = require('../scripts/audit-dependencies');

const dependencySecurityWorkflow = fs.readFileSync(
  path.resolve(__dirname, '..', '.github', 'workflows', 'dependency-security.yml'),
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
      via: [{
        url: 'https://github.com/advisories/GHSA-mh99-v99m-4gvg',
      }],
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
