'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const model = require('../../media/board-model.js');
const {
  CONFIG,
  HISTORY,
  boardWith,
  buildBoard,
  card,
} = require('../fixtures/board-fixtures.js');

const AT = '2026-01-01T00:00:00.000Z';
const BASE_EVENT = { at: AT, card: 'AO-001', event: 'created', to: 'inbox' };

function historyWith(...events) {
  return `${HISTORY}${events.map((event) => `    ${JSON.stringify(event)}\n`).join('')}`;
}

test('parseHistory rejects non-string input', () => {
  assert.throws(() => model.parseHistory(null), TypeError);
});

test('parseHistory reads only indented JSON lines and preserves order', () => {
  const source = historyWith(BASE_EVENT, { ...BASE_EVENT, card: 'AO-002' });
  const history = model.parseHistory(`${source}\nNarrative prose is ignored.\n`);

  assert.equal(history.events.length, 2);
  assert.deepEqual(history.events.map((event) => event.card), ['AO-001', 'AO-002']);
  assert.equal(history.newline, '\n');
});

test('parseHistory reports the offending line number for malformed JSON', () => {
  assert.throws(
    () => model.parseHistory(`${HISTORY}    {"at": }\n`),
    /Invalid history JSON on line 4/,
  );
});

test('parseHistory rejects unsupported event types', () => {
  assert.throws(
    () => model.parseHistory(historyWith({ ...BASE_EVENT, event: 'archived' })),
    /unsupported type/,
  );
});

test('parseHistory rejects malformed timestamps and card identifiers', () => {
  assert.throws(() => model.parseHistory(historyWith({ ...BASE_EVENT, at: 'yesterday' })), /ISO timestamp/);
  assert.throws(() => model.parseHistory(historyWith({ ...BASE_EVENT, card: 'XX-1' })), /requires a card ID/);
});

test('parseHistory rejects invalid statuses, assignees, and actors', () => {
  assert.throws(() => model.parseHistory(historyWith({ ...BASE_EVENT, to: 'archive' })), /invalid to status/);
  assert.throws(() => model.parseHistory(historyWith({ ...BASE_EVENT, from: 'archive' })), /invalid from status/);
  assert.throws(() => model.parseHistory(historyWith({ ...BASE_EVENT, assignee: 'Not An Id' })), /invalid assignee/);
  assert.throws(() => model.parseHistory(historyWith({ ...BASE_EVENT, actor: '   ' })), /invalid actor/);
});

test('an assignment event must carry both the previous and the new assignee', () => {
  assert.throws(
    () => model.parseHistory(historyWith({
      at: AT,
      card: 'AO-001',
      event: 'updated',
      changes: ['assignee'],
      assignee: 'alex',
    })),
    /requires previousAssignee and assignee/,
  );
});

test('appendHistory is a no-op for an empty or missing event list', () => {
  assert.equal(model.appendHistory(HISTORY, []), HISTORY);
  assert.equal(model.appendHistory(HISTORY, undefined), HISTORY);
});

test('appendHistory only ever adds lines to the end of the file', () => {
  const first = model.appendHistory(HISTORY, [BASE_EVENT]);
  const second = model.appendHistory(first, [{ ...BASE_EVENT, card: 'AO-002' }]);

  assert.ok(second.startsWith(first), 'earlier history lines must never be rewritten');
  assert.ok(second.endsWith('\n'));
  assert.equal(model.parseHistory(second).events.length, 2);
});

test('appendHistory validates before writing anything', () => {
  assert.throws(
    () => model.appendHistory(HISTORY, [BASE_EVENT, { ...BASE_EVENT, event: 'archived' }]),
    /unsupported type/,
  );
});

test('appendHistory follows the existing newline convention', () => {
  const crlf = HISTORY.replace(/\n/g, '\r\n');
  const appended = model.appendHistory(crlf, [BASE_EVENT]);

  assert.ok(appended.endsWith('\r\n'));
  assert.equal(model.parseHistory(appended).events.length, 1);
});

test('createBaselineEvents emits one baseline row per card', () => {
  const board = model.parseBoard(buildBoard({
    Inbox: card({ id: 'AO-001', title: 'First' }),
    Done: card({ id: 'AO-002', title: 'Second', done: true }),
  }));

  const events = model.createBaselineEvents(board, AT);
  assert.equal(events.length, 2);
  assert.ok(events.every((event) => event.event === 'baseline' && event.at === AT));
  assert.deepEqual(events.map((event) => event.to), ['inbox', 'done']);
  assert.equal(model.parseHistory(model.appendHistory(HISTORY, events)).events.length, 2);
});

test('diffBoardEvents detects creation, movement, updates, and deletion', () => {
  const before = model.parseBoard(buildBoard({
    Inbox: card({ id: 'AO-001', title: 'Original title' }),
    Next: card({ id: 'AO-002', title: 'Doomed' }),
  }));
  const after = model.parseBoard(buildBoard({
    Doing: card({ id: 'AO-001', title: 'Renamed', priority: 'P1' }),
    Next: card({ id: 'AO-003', title: 'Brand new' }),
  }));

  const events = model.diffBoardEvents(before, after, AT);
  const byType = new Map(events.map((event) => [event.event, event]));

  assert.deepEqual([...byType.keys()].sort(), ['created', 'deleted', 'moved', 'updated']);
  assert.equal(byType.get('moved').from, 'inbox');
  assert.equal(byType.get('moved').to, 'doing');
  assert.deepEqual(byType.get('updated').changes.slice().sort(), ['priority', 'title']);
  assert.equal(byType.get('deleted').card, 'AO-002');
  assert.equal(byType.get('created').card, 'AO-003');
  assert.equal(model.parseHistory(model.appendHistory(HISTORY, events)).events.length, events.length);
});

test('diffBoardEvents records an assignment with both sides of the change', () => {
  const before = model.parseBoard(boardWith(card({
    id: 'AO-001',
    title: 'Owned outcome',
    details: [['Assignee', 'alex-smith']],
  })));
  const after = model.parseBoard(boardWith(card({
    id: 'AO-001',
    title: 'Owned outcome',
    details: [['Assignee', 'jordan-lee']],
  })));

  const [event] = model.diffBoardEvents(before, after, AT);
  assert.deepEqual(event.changes, ['assignee']);
  assert.equal(event.previousAssignee, 'alex-smith');
  assert.equal(event.assignee, 'jordan-lee');
  assert.doesNotThrow(() => model.appendHistory(HISTORY, [event]));
});

test('diffBoardEvents records unassignment with an explicit null', () => {
  const before = model.parseBoard(boardWith(card({
    id: 'AO-001',
    title: 'Owned outcome',
    details: [['Assignee', 'alex-smith']],
  })));
  const after = model.parseBoard(boardWith(card({ id: 'AO-001', title: 'Owned outcome' })));

  const [event] = model.diffBoardEvents(before, after, AT);
  assert.equal(event.previousAssignee, 'alex-smith');
  assert.equal(event.assignee, null);
});

test('diffBoardEvents produces nothing for an unchanged board', () => {
  const source = boardWith(card({ id: 'AO-001', title: 'Stable' }));
  assert.deepEqual(model.diffBoardEvents(model.parseBoard(source), model.parseBoard(source), AT), []);
});

test('parseConfig requires a fenced JSON block', () => {
  assert.throws(() => model.parseConfig('# No config here'), /must contain one fenced JSON block/);
  assert.throws(() => model.parseConfig(undefined), TypeError);
});

test('parseConfig migrates a legacy customers array to entities', () => {
  const legacy = '```json\n' + JSON.stringify({
    workspace: { name: 'Legacy' },
    customers: [{ id: 'meta', name: 'Meta', color: '#3b82f6' }],
  }) + '\n```\n';

  const config = model.parseConfig(legacy);
  assert.equal(config.entities.length, 1);
  assert.deepEqual(config.people, []);
  assert.equal(config.customers, undefined);
});

test('validateConfig enforces identifier, name, and colour shapes', () => {
  const base = model.parseConfig(CONFIG);

  assert.throws(() => model.validateConfig(null), /must be an object/);
  assert.throws(() => model.validateConfig({ entities: [], people: [] }), /requires workspace.name/);
  assert.throws(() => model.validateConfig({ ...base, entities: undefined }), /requires an entities array/);
  assert.throws(() => model.validateConfig({ ...base, people: undefined }), /requires a people array/);
  assert.throws(
    () => model.validateConfig({ ...base, entities: [{ id: 'Bad Id', color: '#ffffff' }] }),
    /Invalid entity ID/,
  );
  assert.throws(
    () => model.validateConfig({ ...base, entities: [{ id: 'meta', color: '#ffffff' }, { id: 'meta', color: '#ffffff' }] }),
    /Duplicate entity ID/,
  );
  assert.throws(
    () => model.validateConfig({ ...base, entities: [{ id: 'meta', color: 'blue' }] }),
    /Invalid color/,
  );
  assert.throws(
    () => model.validateConfig({ ...base, people: [{ id: 'alex', name: '  ', color: '#ffffff' }] }),
    /Invalid name for alex/,
  );
});

test('serializeConfig replaces an existing block and creates a missing one', () => {
  const config = model.parseConfig(CONFIG);
  config.workspace.name = 'Renamed workspace';

  const replaced = model.serializeConfig(CONFIG, config);
  assert.equal(model.parseConfig(replaced).workspace.name, 'Renamed workspace');
  assert.equal(replaced.match(/```json/g).length, 1);

  const created = model.serializeConfig('# Kanban Configuration\n', config);
  assert.equal(model.parseConfig(created).workspace.name, 'Renamed workspace');
});

test('createDefaultConfig produces a configuration that round trips', () => {
  const config = model.createDefaultConfig();
  assert.equal(model.validateConfig(config), true);
  assert.deepEqual(model.parseConfig(model.serializeConfig('', config)), config);
});

test('validateBundleSources rejects cards referencing unknown entities', () => {
  const board = boardWith(card({ id: 'AO-001', title: 'Orphan', area: 'nonexistent' }));
  assert.throws(
    () => model.validateBundleSources(board, CONFIG, HISTORY),
    /Missing entity configuration: nonexistent/,
  );
});
