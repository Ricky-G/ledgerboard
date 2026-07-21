const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const test = require('node:test');
const model = require('../media/board-model.js');

function createBoard(cardCount) {
  const cards = Array.from({ length: cardCount }, (_, index) => {
    const id = `AO-${String(index + 1).padStart(4, '0')}`;
    return `- [ ] ${id} — Outcome ${index + 1} · P3 · area:internal\n    - **Description:** Deterministic performance fixture ${index + 1}.`;
  }).join('\n\n');
  return `# Performance Board

---

## Inbox

${cards}

---

## Next

<!-- empty -->

---

## Doing \`(WIP <= 3)\`

<!-- empty -->

---

## Review / Blocked

<!-- empty -->

---

## Done

<!-- empty -->
`;
}

test('validates and serializes 1,000 cards within the performance budget', () => {
  const source = createBoard(1_000);
  const started = performance.now();
  const report = model.analyzeBoardSource(source);
  const durationMs = performance.now() - started;

  assert.equal(report.errors.length, 0);
  assert.equal(report.board.columns[0].cards.length, 1_000);
  assert.equal(report.canonicalSource, source);
  assert.ok(durationMs < 2_000, `1,000-card validation took ${Math.round(durationMs)}ms; budget is 2000ms.`);
});

test('builds analytics for 10,000 history events within the performance budget', () => {
  const board = model.parseBoard(createBoard(100));
  const events = Array.from({ length: 10_000 }, (_, index) => ({
    at: `2026-01-${String((index % 28) + 1).padStart(2, '0')}T12:00:00+00:00`,
    card: `AO-${String((index % 100) + 1).padStart(4, '0')}`,
    event: index % 3 === 0 ? 'moved' : 'updated',
    from: index % 3 === 0 ? 'inbox' : undefined,
    to: 'next',
    changes: index % 3 === 0 ? undefined : ['priority'],
    area: 'internal',
    priority: 'P3',
    title: `Outcome ${(index % 100) + 1}`,
  }));
  const started = performance.now();
  const analytics = model.buildAnalytics(board, events, {
    now: '2026-01-31T23:59:59+00:00',
    days: 30,
  });
  const durationMs = performance.now() - started;

  assert.equal(analytics.total, 100);
  assert.equal(analytics.historyEvents, 10_000);
  assert.ok(durationMs < 2_000, `10,000-event analytics took ${Math.round(durationMs)}ms; budget is 2000ms.`);
});
