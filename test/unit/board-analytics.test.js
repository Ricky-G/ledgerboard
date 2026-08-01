'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const model = require('../../src/webview/board-model.js');
const { boardWith, buildBoard, card } = require('../fixtures/board-fixtures.js');

const NOW = '2026-03-10T12:00:00.000Z';

function analytics(board, events, options = {}) {
  return model.buildAnalytics(model.parseBoard(board), events, { now: NOW, timeZone: 'Etc/UTC', ...options });
}

const SAMPLE_BOARD = buildBoard({
  Inbox: card({ id: 'AO-001', title: 'Waiting ticket', priority: 'P1' }),
  Doing: card({
    id: 'AO-002',
    title: 'Active ticket',
    priority: 'P2',
    details: [['Assignee', 'alex-smith']],
  }),
  Done: card({ id: 'AO-003', title: 'Finished ticket', priority: 'P3', done: true }),
});

const SAMPLE_EVENTS = [
  { at: '2026-03-01T09:00:00.000Z', card: 'AO-001', event: 'created', to: 'inbox', priority: 'P1', area: 'internal' },
  { at: '2026-03-02T09:00:00.000Z', card: 'AO-002', event: 'created', to: 'inbox', priority: 'P2', area: 'internal' },
  { at: '2026-03-03T09:00:00.000Z', card: 'AO-002', event: 'moved', from: 'inbox', to: 'doing', priority: 'P2', area: 'internal', assignee: 'alex-smith' },
  { at: '2026-03-04T09:00:00.000Z', card: 'AO-003', event: 'created', to: 'inbox', priority: 'P3', area: 'internal' },
  { at: '2026-03-06T09:00:00.000Z', card: 'AO-003', event: 'moved', from: 'inbox', to: 'done', priority: 'P3', area: 'internal' },
];

test('buildAnalytics rejects an invalid current timestamp', () => {
  assert.throws(
    () => model.buildAnalytics(model.parseBoard(SAMPLE_BOARD), [], { now: 'not-a-date' }),
    /requires a valid current timestamp/,
  );
});

test('buildAnalytics falls back to UTC for an unusable time zone', () => {
  const result = analytics(SAMPLE_BOARD, SAMPLE_EVENTS, { timeZone: 'Mars/Olympus_Mons' });
  assert.equal(result.metadata.timeZone, 'Etc/UTC');
});

test('buildAnalytics rejects an inverted date range', () => {
  assert.throws(
    () => analytics(SAMPLE_BOARD, SAMPLE_EVENTS, { startDate: '2026-03-10', endDate: '2026-03-01' }),
    /must not be after its end date/,
  );
});

test('buildAnalytics rejects a range longer than ten years', () => {
  assert.throws(
    () => analytics(SAMPLE_BOARD, SAMPLE_EVENTS, { startDate: '2000-01-01', endDate: '2026-03-01' }),
    /cannot exceed ten years/,
  );
});

test('buildAnalytics defaults to a thirty day window ending today', () => {
  const result = analytics(SAMPLE_BOARD, SAMPLE_EVENTS);
  assert.equal(result.metadata.range.days, 30);
  assert.equal(result.metadata.range.end, '2026-03-10');
  assert.equal(result.metadata.range.start, '2026-02-09');
  assert.equal(result.daily.length, 30);
});

test('buildAnalytics ignores a non-positive or fractional day count', () => {
  assert.equal(analytics(SAMPLE_BOARD, SAMPLE_EVENTS, { days: 0 }).metadata.range.days, 30);
  assert.equal(analytics(SAMPLE_BOARD, SAMPLE_EVENTS, { days: -7 }).metadata.range.days, 30);
  assert.equal(analytics(SAMPLE_BOARD, SAMPLE_EVENTS, { days: 7.5 }).metadata.range.days, 30);
  assert.equal(analytics(SAMPLE_BOARD, SAMPLE_EVENTS, { days: 7 }).metadata.range.days, 7);
});

test('buildAnalytics ignores malformed explicit dates', () => {
  const result = analytics(SAMPLE_BOARD, SAMPLE_EVENTS, { startDate: '10/03/2026', endDate: '2026-02-30' });
  assert.equal(result.metadata.range.end, '2026-03-10');
  assert.equal(result.metadata.range.days, 30);
});

test('a time zone shifts an event into the neighbouring day bucket', () => {
  const events = [{ at: '2026-03-05T23:30:00.000Z', card: 'AO-001', event: 'created', to: 'inbox' }];
  const utc = analytics(SAMPLE_BOARD, events, { timeZone: 'Etc/UTC' });
  const sydney = analytics(SAMPLE_BOARD, events, { timeZone: 'Australia/Sydney' });

  assert.equal(utc.daily.find((bucket) => bucket.created > 0).date, '2026-03-05');
  assert.equal(sydney.daily.find((bucket) => bucket.created > 0).date, '2026-03-06');
});

test('counts stay inside the requested window', () => {
  const result = analytics(SAMPLE_BOARD, SAMPLE_EVENTS, { startDate: '2026-03-05', endDate: '2026-03-10' });
  const created = result.daily.reduce((sum, bucket) => sum + bucket.created, 0);
  const completed = result.daily.reduce((sum, bucket) => sum + bucket.completed, 0);

  assert.equal(created, 0, 'creations before the window must not be counted');
  assert.equal(completed, 1);
});

test('status, priority, label, and assignee totals reflect the board', () => {
  const result = analytics(SAMPLE_BOARD, SAMPLE_EVENTS);

  assert.equal(result.total, 3);
  assert.equal(result.status.inbox, 1);
  assert.equal(result.status.doing, 1);
  assert.equal(result.status.done, 1);
  assert.equal(result.priority.P1, 1);
  assert.equal(result.labels.internal, 3);
  assert.deepEqual(result.entities, result.labels);
  assert.equal(result.assignees['alex-smith'], 1);
  assert.equal(result.assignees.unassigned, 2);
});

test('a status filter narrows both cards and their supporting history', () => {
  const result = analytics(SAMPLE_BOARD, SAMPLE_EVENTS, { filters: { statuses: ['doing'] } });

  assert.equal(result.total, 1);
  assert.equal(result.status.doing, 1);
  assert.equal(result.status.inbox, 0);
  assert.ok(result.daily.every((bucket) => bucket.completedCardIds.every((id) => id === 'AO-002')));
});

test('unknown filter values are discarded rather than emptying the board', () => {
  const result = analytics(SAMPLE_BOARD, SAMPLE_EVENTS, {
    filters: { statuses: ['archive'], priorities: ['P9'], areas: [], assignees: [] },
  });
  assert.equal(result.total, 3);
});

test('the assignee filter distinguishes unassigned cards', () => {
  const assigned = analytics(SAMPLE_BOARD, SAMPLE_EVENTS, { filters: { assignees: ['alex-smith'] } });
  const unassigned = analytics(SAMPLE_BOARD, SAMPLE_EVENTS, { filters: { assignees: ['unassigned'] } });

  assert.equal(assigned.total, 1);
  assert.equal(unassigned.total, 2);
});

test('the search filter matches identifier, title, and area case insensitively', () => {
  assert.equal(analytics(SAMPLE_BOARD, SAMPLE_EVENTS, { filters: { search: 'ACTIVE' } }).total, 1);
  assert.equal(analytics(SAMPLE_BOARD, SAMPLE_EVENTS, { filters: { search: 'ao-003' } }).total, 1);
  assert.equal(analytics(SAMPLE_BOARD, SAMPLE_EVENTS, { filters: { search: 'internal' } }).total, 3);
  assert.equal(analytics(SAMPLE_BOARD, SAMPLE_EVENTS, { filters: { search: 'nothing matches' } }).total, 0);
});

test('analytics tolerate an empty board and an empty history', () => {
  const result = analytics(buildBoard({}), []);

  assert.equal(result.total, 0);
  assert.equal(result.daily.length, 30);
  assert.ok(result.daily.every((bucket) => bucket.activity === 0));
  assert.equal(result.comparison.current.activity, 0);
});

test('analytics tolerate history for cards that no longer exist', () => {
  const orphaned = [
    ...SAMPLE_EVENTS,
    { at: '2026-03-07T09:00:00.000Z', card: 'AO-404', event: 'created', to: 'inbox' },
    { at: '2026-03-08T09:00:00.000Z', card: 'AO-404', event: 'deleted', from: 'inbox' },
  ];
  const result = analytics(SAMPLE_BOARD, orphaned);

  assert.equal(result.total, 3);
  assert.ok(result.daily.reduce((sum, bucket) => sum + bucket.activity, 0) >= 6);
});

test('baseline events seed state without inflating activity', () => {
  const board = model.parseBoard(SAMPLE_BOARD);
  const baseline = model.createBaselineEvents(board, '2026-03-01T00:00:00.000Z');
  const result = model.buildAnalytics(board, baseline, { now: NOW, timeZone: 'Etc/UTC' });

  assert.equal(result.daily.reduce((sum, bucket) => sum + bucket.activity, 0), 0);
  assert.equal(result.total, 3);
});

test('the period comparison contrasts the window with the one before it', () => {
  const result = analytics(SAMPLE_BOARD, SAMPLE_EVENTS, { startDate: '2026-03-04', endDate: '2026-03-06' });

  assert.equal(result.comparison.current.created, 1);
  assert.equal(result.comparison.current.completed, 1);
  assert.equal(result.comparison.previous.created, 2);
});

test('the cumulative flow series covers every day in the range', () => {
  const result = analytics(SAMPLE_BOARD, SAMPLE_EVENTS, { startDate: '2026-03-01', endDate: '2026-03-10' });

  assert.equal(result.cumulativeFlow.length, 10);
  assert.equal(result.cumulativeFlow.at(-1).date, '2026-03-10');
  assert.ok(model.COLUMNS.every((column) => Object.hasOwn(result.cumulativeFlow.at(-1), column.id)));
});

test('aging reports days in the current column for active cards only', () => {
  const result = analytics(SAMPLE_BOARD, SAMPLE_EVENTS);
  const aged = result.aging.items.find((entry) => entry.id === 'AO-002');

  assert.ok(aged, 'active cards must appear in the aging report');
  assert.ok(aged.ageDays >= 7, `expected at least seven days in column, received ${aged.ageDays}`);
  assert.ok(!result.aging.items.some((entry) => entry.id === 'AO-003'), 'done cards are not aged');
  assert.ok(result.aging.unknown.some((entry) => entry.id === 'AO-001') || aged.basis.includes('inbox') === false);
});

test('data quality flags cards that lack an owner', () => {
  const result = analytics(SAMPLE_BOARD, SAMPLE_EVENTS);
  assert.ok(result.quality.unassigned.some((entry) => entry.id === 'AO-001'));
  assert.ok(!result.quality.unassigned.some((entry) => entry.id === 'AO-002'));
});

test('workload attributes active cards to their assignee', () => {
  const result = analytics(SAMPLE_BOARD, SAMPLE_EVENTS);
  const owner = result.workload.find((entry) => entry.assignee === 'alex-smith');

  assert.ok(owner);
  assert.equal(owner.active, 1);
});

test('analyzeBoardSource reports a parse failure as a diagnostic instead of throwing', () => {
  const analysis = model.analyzeBoardSource('# Not a board');

  assert.equal(analysis.board, null);
  assert.equal(analysis.canNormalize, false);
  assert.ok(analysis.errors.some((item) => item.code === 'board-parse'));
});

test('analyzeBoardSource flags mixed line endings', () => {
  const source = boardWith(card({ id: 'AO-001', title: 'Mixed' })).replace('## Next', '\r\n## Next');
  const analysis = model.analyzeBoardSource(source);

  assert.ok(analysis.diagnostics.some((item) => item.code === 'mixed-line-endings'));
});

test('analyzeBoardSource flags a non canonical detail label and normalization repairs it', () => {
  const source = boardWith('- [ ] AO-001 — Spaced · P1 · area:internal\n    - **description:** Lower case label.');
  const analysis = model.analyzeBoardSource(source);

  assert.ok(analysis.diagnostics.some((item) => item.code === 'noncanonical-formatting'));
  assert.equal(analysis.canNormalize, true);

  const normalized = model.normalizeBoardSource(source);
  assert.equal(normalized.changed, true);
  assert.match(normalized.source, /- \*\*Description:\*\* Lower case label\./);
  assert.equal(model.analyzeBoardSource(normalized.source).errors.length, 0);
});

test('analyzeBoardSource refuses to normalize a detail it cannot represent', () => {
  const source = boardWith('- [ ] AO-001 — Spaced · P1 · area:internal\n      - **Description:** Over indented.');
  const analysis = model.analyzeBoardSource(source);

  assert.ok(analysis.diagnostics.some((item) => item.code === 'multiline-detail'));
  assert.equal(analysis.canNormalize, false);
  assert.throws(() => model.normalizeBoardSource(source));
});

test('normalizing an already canonical board reports no change', () => {
  const source = boardWith(card({ id: 'AO-001', title: 'Canonical' }));
  const normalized = model.normalizeBoardSource(source);

  assert.equal(normalized.changed, false);
  assert.equal(normalized.source, source);
});

test('normalizeBoardSource refuses to repair a board it cannot parse', () => {
  assert.throws(() => model.normalizeBoardSource('# Not a board'), /column/i);
});
