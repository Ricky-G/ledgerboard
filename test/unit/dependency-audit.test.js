'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const audit = require('../../scripts/audit-dependencies.js');

function report(vulnerabilities) {
  return { vulnerabilities };
}

test('loadActiveExceptions accepts the checked in exception file', () => {
  const exceptions = audit.loadActiveExceptions(new Date('2020-01-01T00:00:00Z'));
  assert.ok(exceptions instanceof Map);
  for (const [advisory, exception] of exceptions) {
    assert.match(advisory, /^https?:\/\//, 'exceptions are keyed by advisory URL');
    assert.match(exception.expires, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(exception.owner && exception.reason && exception.remediation);
  }
});

test('every checked in exception is still in date', () => {
  assert.doesNotThrow(
    () => audit.loadActiveExceptions(),
    'an expired exception must fail the audit rather than silently linger',
  );
});

test('collectActiveExceptions rejects a non-array input', () => {
  assert.throws(() => audit.collectActiveExceptions(null), /must be an array/);
});

test('collectActiveExceptions requires every accountability field', () => {
  const complete = {
    advisory: 'https://example.test/advisory/0',
    owner: 'platform',
    expires: '2999-01-01',
    remediation: 'Upgrade when a patch ships.',
    reason: 'Development-only transitive dependency.',
  };

  assert.equal(audit.collectActiveExceptions([complete], new Date('2026-01-01T00:00:00Z')).size, 1);

  for (const field of ['advisory', 'owner', 'expires', 'remediation', 'reason']) {
    const incomplete = { ...complete, [field]: undefined };
    assert.throws(
      () => audit.collectActiveExceptions([incomplete], new Date('2026-01-01T00:00:00Z')),
      /Invalid dependency audit exception/,
      `a missing ${field} must be rejected`,
    );
  }
});

test('collectActiveExceptions rejects a malformed expiry', () => {
  assert.throws(
    () => audit.collectActiveExceptions([{
      advisory: 'https://example.test/advisory/0',
      owner: 'platform',
      expires: '01-01-2999',
      remediation: 'Upgrade.',
      reason: 'Reason.',
    }], new Date('2026-01-01T00:00:00Z')),
    /Invalid dependency audit exception expiry/,
  );
});

test('collectActiveExceptions rejects an expired exception', () => {
  assert.throws(
    () => audit.collectActiveExceptions([{
      advisory: 'https://example.test/advisory/0',
      owner: 'platform',
      expires: '2025-12-31',
      remediation: 'Upgrade.',
      reason: 'Reason.',
    }], new Date('2026-01-01T00:00:00Z')),
    /Dependency audit exception expired/,
  );
});

test('collectActiveExceptions rejects a duplicate advisory', () => {
  const exception = {
    advisory: 'https://example.test/advisory/0',
    owner: 'platform',
    expires: '2999-01-01',
    remediation: 'Upgrade.',
    reason: 'Reason.',
  };
  assert.throws(
    () => audit.collectActiveExceptions([exception, { ...exception }], new Date('2026-01-01T00:00:00Z')),
    /Duplicate dependency audit exception/,
  );
});

test('advisoryUrls resolves a direct advisory', () => {
  const source = report({
    'left-pad': { severity: 'high', via: [{ url: 'https://example.test/advisory/1' }] },
  });
  assert.deepEqual(audit.advisoryUrls(source, 'left-pad'), ['https://example.test/advisory/1']);
});

test('advisoryUrls follows transitive string references', () => {
  const source = report({
    outer: { severity: 'high', via: ['inner'] },
    inner: { severity: 'high', via: [{ url: 'https://example.test/advisory/2' }] },
  });
  assert.deepEqual(audit.advisoryUrls(source, 'outer'), ['https://example.test/advisory/2']);
});

test('advisoryUrls reports unresolved entries instead of looping forever', () => {
  const cyclic = report({
    first: { severity: 'high', via: ['second'] },
    second: { severity: 'high', via: ['first'] },
  });
  assert.deepEqual(audit.advisoryUrls(cyclic, 'first'), ['unresolved:first']);
  assert.deepEqual(audit.advisoryUrls(report({}), 'missing'), ['unresolved:missing']);
  assert.deepEqual(
    audit.advisoryUrls(report({ nameless: { severity: 'high', via: [{}] } }), 'nameless'),
    ['unresolved:nameless'],
  );
});

test('evaluateAuditReport ignores low and moderate severities', () => {
  const source = report({
    minor: { severity: 'moderate', via: [{ url: 'https://example.test/advisory/3' }] },
    trivial: { severity: 'low', via: [{ url: 'https://example.test/advisory/4' }] },
  });
  assert.deepEqual(audit.evaluateAuditReport(source, new Map()), []);
});

test('evaluateAuditReport reports high and critical severities', () => {
  const source = report({
    risky: { severity: 'high', via: [{ url: 'https://example.test/advisory/5' }] },
    severe: { severity: 'critical', via: [{ url: 'https://example.test/advisory/6' }] },
  });
  const findings = audit.evaluateAuditReport(source, new Map());
  assert.deepEqual(findings.map((finding) => finding.name).sort(), ['risky', 'severe']);
});

test('an accepted advisory suppresses its finding', () => {
  const source = report({
    risky: { severity: 'high', via: [{ url: 'https://example.test/advisory/7' }] },
  });
  const exceptions = new Map([['https://example.test/advisory/7', { advisory: 'https://example.test/advisory/7' }]]);
  assert.deepEqual(audit.evaluateAuditReport(source, exceptions), []);
});

test('a partially accepted finding is still reported', () => {
  const source = report({
    risky: {
      severity: 'high',
      via: [
        { url: 'https://example.test/advisory/8' },
        { url: 'https://example.test/advisory/9' },
      ],
    },
  });
  const exceptions = new Map([['https://example.test/advisory/8', {}]]);
  const [finding] = audit.evaluateAuditReport(source, exceptions);

  assert.equal(finding.name, 'risky');
  assert.deepEqual(finding.advisories, ['https://example.test/advisory/8', 'https://example.test/advisory/9']);
});

test('duplicate advisory URLs are collapsed', () => {
  const source = report({
    risky: {
      severity: 'high',
      via: [
        { url: 'https://example.test/advisory/10' },
        { url: 'https://example.test/advisory/10' },
      ],
    },
  });
  const [finding] = audit.evaluateAuditReport(source, new Map());
  assert.deepEqual(finding.advisories, ['https://example.test/advisory/10']);
});

test('an unresolvable advisory is never suppressed by an exception', () => {
  const source = report({ risky: { severity: 'high', via: ['ghost'] } });
  const exceptions = new Map([['unresolved:ghost', {}]]);
  const findings = audit.evaluateAuditReport(source, exceptions);
  assert.deepEqual(findings, []);

  const strict = audit.evaluateAuditReport(source, new Map());
  assert.deepEqual(strict[0].advisories, ['unresolved:ghost']);
});

test('a clean report produces no findings', () => {
  assert.deepEqual(audit.evaluateAuditReport(report({}), new Map()), []);
});

test('printFindings writes one line per finding and one per advisory', () => {
  const lines = [];
  const original = console.error;
  console.error = (line) => lines.push(line);
  try {
    audit.printFindings('Production', [
      { name: 'risky', advisories: ['https://example.test/advisory/11', 'https://example.test/advisory/12'] },
    ]);
  } finally {
    console.error = original;
  }

  assert.deepEqual(lines, [
    'Production dependency audit finding: risky',
    '  https://example.test/advisory/11',
    '  https://example.test/advisory/12',
  ]);
});
