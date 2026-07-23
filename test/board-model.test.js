const assert = require('node:assert/strict');
const test = require('node:test');
const model = require('../media/board-model.js');

const CONFIG = `# Config

\`\`\`json
{"version":1,"workspace":{"name":"Test"},"appearance":{"accent":"#e24a35","density":"comfortable"},"entities":[{"id":"internal","name":"Internal","color":"#167d74"}]}
\`\`\`
`;
const HISTORY = '# History\n\n## Events\n';

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

function boardWithTwoCards(separator = '\n') {
  const cards = [
    '- [ ] AO-001 — First outcome · P1 · area:internal\n    - **Description:** First description.',
    '- [ ] AO-002 — Second outcome · P2 · area:internal\n    - **Description:** Second description.',
  ].join(separator);
  return boardWith(cards);
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
  assert.deepEqual(parsed.people, []);
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

test('assignees round-trip through cards and validate against configured people', () => {
  const source = boardWith(
    '- [ ] AO-001 — Prepare review · P2 · area:internal\n'
      + '    - **Description:** Prepare the review pack.\n'
      + '    - **Assignee:** alex-smith',
  );
  const config = CONFIG.replace(
    '"entities":[{"id":"internal","name":"Internal","color":"#167d74"}]',
    '"entities":[{"id":"internal","name":"Internal","color":"#167d74"}],"people":[{"id":"alex-smith","name":"Alex Smith","color":"#7257b5"}]',
  );
  const board = model.parseBoard(source);

  assert.equal(board.columns[0].cards[0].detailValues.assignee, 'alex-smith');
  assert.equal(model.serializeBoard(board), source);
  assert.doesNotThrow(() => model.validateBundleSources(source, config, HISTORY));
});

test('bundle validation reports assignees missing from the people directory', () => {
  const source = boardWith(
    '- [ ] AO-001 — Prepare review · P2 · area:internal\n'
      + '    - **Assignee:** missing-person',
  );

  assert.throws(
    () => model.validateBundleSources(source, CONFIG, HISTORY),
    /Missing person configuration: missing-person/,
  );
});

test('assignment changes record previous and current values', () => {
  const source = boardWith(
    '- [ ] AO-001 — Prepare review · P2 · area:internal\n'
      + '    - **Assignee:** alex-smith',
  );
  const before = model.parseBoard(source);
  const reassigned = model.parseBoard(source);
  reassigned.columns[0].cards[0].detailValues.assignee = 'sam-lee';
  const reassignment = model.diffBoardEvents(before, reassigned, '2026-07-21T10:00:00+12:00');

  assert.deepEqual(reassignment[0].changes, ['assignee']);
  assert.equal(reassignment[0].previousAssignee, 'alex-smith');
  assert.equal(reassignment[0].assignee, 'sam-lee');

  const unassigned = model.parseBoard(source);
  unassigned.columns[0].cards[0].detailValues.assignee = '';
  const unassignment = model.diffBoardEvents(before, unassigned, '2026-07-21T11:00:00+12:00');
  assert.equal(unassignment[0].previousAssignee, 'alex-smith');
  assert.equal(unassignment[0].assignee, null);
});

test('assignment history preserves an available actor', () => {
  const event = {
    at: '2026-07-21T10:00:00+12:00',
    card: 'AO-001',
    event: 'updated',
    to: 'inbox',
    changes: ['assignee'],
    previousAssignee: null,
    assignee: 'alex-smith',
    actor: 'Local editor',
    area: 'internal',
    priority: 'P2',
    title: 'Prepare review',
  };
  const history = model.appendHistory(HISTORY, [event]);

  assert.deepEqual(model.parseHistory(history).events[0], event);
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

test('adjacent cards require exactly one blank physical line', () => {
  const report = model.analyzeBoardSource(boardWithTwoCards('\n'));

  assert.equal(report.errors[0].code, 'card-separator');
  assert.equal(report.errors[0].line, 9);
  assert.match(report.errors[0].message, /Cards AO-001 and AO-002 must be separated by exactly one blank physical line/);
  assert.equal(report.canNormalize, true);
});

test('cards separated by one blank physical line round-trip exactly', () => {
  const source = boardWithTwoCards('\n\n');
  const report = model.analyzeBoardSource(source);

  assert.deepEqual(report.errors, []);
  assert.equal(report.isCanonical, true);
  assert.equal(report.canonicalSource, source);
});

test('extra blank lines between cards are diagnosed and normalized', () => {
  const source = boardWithTwoCards('\n\n\n');
  const report = model.analyzeBoardSource(source);
  const normalized = model.normalizeBoardSource(source);

  assert.equal(report.errors[0].code, 'card-separator');
  assert.match(report.errors[0].message, /found 2/);
  assert.equal(normalized.source, boardWithTwoCards('\n\n'));
  assert.equal(normalized.changed, true);
});

test('LF input round-trips as LF', () => {
  const source = boardWithTwoCards('\n\n');
  const report = model.analyzeBoardSource(source);

  assert.equal(report.newline, '\n');
  assert.equal(report.canonicalSource, source);
  assert.equal(report.canonicalSource.includes('\r\n'), false);
});

test('CRLF input round-trips as CRLF', () => {
  const source = boardWithTwoCards('\n\n').replace(/\n/g, '\r\n');
  const report = model.analyzeBoardSource(source);

  assert.equal(report.newline, '\r\n');
  assert.equal(report.canonicalSource, source);
  assert.equal(report.canonicalSource.replace(/\r\n/g, '').includes('\n'), false);
});

test('mixed line endings produce a specific normalizable error', () => {
  const source = boardWithTwoCards('\n\n').replace('\n', '\r\n');
  const report = model.analyzeBoardSource(source);

  assert.equal(report.errors[0].code, 'mixed-line-endings');
  assert.match(report.errors[0].message, /mixed line endings/);
  assert.equal(report.canNormalize, true);
  assert.equal(model.normalizeBoardSource(source).source.includes('\r\n'), false);
});

test('multiline descriptions produce a specific non-normalizable error', () => {
  const source = boardWith(
    '- [ ] AO-001 — First outcome · P1 · area:internal\n'
      + '    - **Description:** First line.\n'
      + '      Second physical line.',
  );
  const report = model.analyzeBoardSource(source);

  assert.equal(report.errors[0].code, 'multiline-description');
  assert.match(report.errors[0].message, /Description for AO-001 must stay on one physical line/);
  assert.equal(report.canNormalize, false);
  assert.throws(() => model.normalizeBoardSource(source), /must stay on one physical line/);
});

test('unsupported detail fields are preserved and warned', () => {
  const source = boardWith(
    '- [ ] AO-001 — First outcome · P1 · area:internal\n'
      + '    - **Description:** First description.\n'
      + '    - **Custom:** Preserved value.',
  );
  const report = model.analyzeBoardSource(source);

  assert.deepEqual(report.errors, []);
  assert.equal(report.warnings[0].code, 'unsupported-detail');
  assert.equal(report.canonicalSource, source);
});

test('duplicate card IDs are rejected without dropping either card', () => {
  const source = boardWithTwoCards('\n\n').replace('AO-002', 'AO-001');
  assert.throws(() => model.parseBoard(source), /Duplicate card ID AO-001/);
});

test('invalid checkbox markers report the source line', () => {
  const source = boardWith('- [o] AO-001 — Work in progress · P2 · area:internal');
  assert.throws(() => model.parseBoard(source), /Invalid card format on line 7/);
});

test('bundle validation reports missing entities', () => {
  const source = boardWith('- [ ] AO-001 — External outcome · P2 · area:missing');
  assert.throws(
    () => model.validateBundleSources(source, CONFIG, HISTORY),
    /Missing entity configuration: missing/,
  );
});

test('duplicate entity IDs are rejected', () => {
  const duplicate = CONFIG.replace(
    '"entities":[{"id":"internal","name":"Internal","color":"#167d74"}]',
    '"entities":[{"id":"internal","name":"Internal","color":"#167d74"},{"id":"internal","name":"Duplicate","color":"#7257b5"}]',
  );
  assert.throws(() => model.parseConfig(duplicate), /Duplicate entity ID: internal/);
});

test('duplicate person IDs are rejected', () => {
  const duplicate = CONFIG.replace(
    '"entities":[{"id":"internal","name":"Internal","color":"#167d74"}]',
    '"entities":[{"id":"internal","name":"Internal","color":"#167d74"}],"people":['
      + '{"id":"alex-smith","name":"Alex Smith","color":"#7257b5"},'
      + '{"id":"alex-smith","name":"Duplicate","color":"#2e6ea6"}]',
  );
  assert.throws(() => model.parseConfig(duplicate), /Duplicate person ID: alex-smith/);
});

test('invalid entity colors are rejected', () => {
  assert.throws(() => model.parseConfig(CONFIG.replace('#167d74', 'blue')), /Invalid color for internal/);
});

test('malformed history events report their line', () => {
  const history = `${HISTORY}    {"at":"not-a-date","card":"AO-001","event":"created"}\n`;
  assert.throws(() => model.parseHistory(history), /History event on line 4 requires an ISO timestamp/);
});

test('normalization is idempotent for canonical boards', () => {
  const source = boardWithTwoCards('\n\n');
  const result = model.normalizeBoardSource(source);
  assert.equal(result.changed, false);
  assert.equal(result.source, source);
});

test('noncanonical formatting reports the first differing line', () => {
  const source = boardWith(
    '- [ ] AO-001 — First outcome · P1 · area:internal\n'
      + '    - **Description:** First description.   ',
  );
  const report = model.analyzeBoardSource(source);

  assert.equal(report.errors[0].code, 'noncanonical-formatting');
  assert.match(report.errors[0].message, /near line 8/);
  assert.match(report.errors[0].message, /Expected/);
  assert.equal(report.canNormalize, true);
});

test('analytics handles an empty board', () => {
  const analytics = model.buildAnalytics(model.parseBoard(EMPTY_BOARD), [], { now: '2026-01-15T12:00:00Z' });
  assert.equal(analytics.total, 0);
  assert.equal(analytics.completionRate, 0);
  assert.equal(analytics.medianCycleDays, null);
});

test('analytics handles an all-done board', () => {
  const source = boardWith('- [x] AO-001 — Finished outcome · P2 · area:internal', 'Done');
  const analytics = model.buildAnalytics(model.parseBoard(source), [], { now: '2026-01-15T12:00:00Z' });
  assert.equal(analytics.total, 1);
  assert.equal(analytics.done, 1);
  assert.equal(analytics.active, 0);
  assert.equal(analytics.completionRate, 100);
});
