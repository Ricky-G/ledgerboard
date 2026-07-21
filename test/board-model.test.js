const assert = require('node:assert/strict');
const test = require('node:test');
const model = require('../media/board-model.js');

const EMPTY_BOARD = `# Test Board

---

## Inbox

<!-- empty -->

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

function boardWith(cardLine, column = 'Inbox') {
  return EMPTY_BOARD.replace(`## ${column}\n\n<!-- empty -->`, `## ${column}\n\n${cardLine}`);
}

test('empty board round-trips byte-for-byte', () => {
  const board = model.parseBoard(EMPTY_BOARD);
  assert.equal(model.serializeBoard(board), EMPTY_BOARD);
  assert.equal(board.columns.length, 5);
});

test('checkbox state must match status', () => {
  assert.throws(
    () => model.parseBoard(boardWith('- [x] AO-001 — Open work · P2 · area:internal')),
    /must use \[ \] outside Done/,
  );
  assert.throws(
    () => model.parseBoard(boardWith('- [ ] AO-001 — Closed work · P2 · area:internal', 'Done')),
    /must use \[x\] in Done/,
  );
});

test('historical card IDs remain reserved', () => {
  const board = model.parseBoard(boardWith('- [ ] AO-004 — Current work · P2 · area:internal'));
  const card = model.createCard(board, {
    title: 'New work',
    historyEvents: [{ card: 'AO-029' }],
  });
  assert.equal(card.id, 'AO-030');
});

test('legacy customer configuration migrates to canonical entities', () => {
  const legacy = `# Config\n\n\`\`\`json\n${JSON.stringify({
    version: 1,
    workspace: { name: 'Legacy' },
    appearance: { accent: '#e24a35', density: 'comfortable' },
    customers: [{ id: 'internal', name: 'Internal', color: '#167d74' }],
  }, null, 2)}\n\`\`\`\n`;
  const parsed = model.parseConfig(legacy);
  const serialized = model.serializeConfig(legacy, parsed);

  assert.equal(parsed.entities[0].id, 'internal');
  assert.equal(Object.hasOwn(parsed, 'customers'), false);
  assert.equal(serialized.includes('"customers"'), false);
});

test('semantic diff records movement and edits separately', () => {
  const source = boardWith('- [ ] AO-001 — Prepare review · P2 · area:internal');
  const before = model.parseBoard(source);
  const after = model.parseBoard(source);
  const found = model.findCard(after, 'AO-001');
  found.card.priority = 'P1';
  model.moveCard(after, 'AO-001', 'next');
  const events = model.diffBoardEvents(before, after, '2026-07-21T10:00:00+12:00');

  assert.deepEqual(events.map((event) => event.event), ['moved', 'updated']);
  assert.deepEqual(events[1].changes, ['priority']);
});

test('append-only history preserves its exact prefix', () => {
  const source = '# Kanban History\n\n## Events\n';
  const event = {
    at: '2026-07-21T10:00:00+12:00',
    card: 'AO-001',
    event: 'created',
    to: 'inbox',
    area: 'internal',
    priority: 'P2',
    title: 'Prepare review',
  };
  const result = model.appendHistory(source, [event]);

  assert.ok(result.startsWith(source));
  assert.equal(model.parseHistory(result).events.length, 1);
});
