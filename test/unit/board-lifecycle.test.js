'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const model = require('../../media/board-model.js');
const {
  CONFIG,
  EMPTY_BOARD,
  HISTORY,
  boardWith,
  buildBoard,
  card,
} = require('../fixtures/board-fixtures.js');

test('parseBoard rejects non-string input', () => {
  assert.throws(() => model.parseBoard(undefined), TypeError);
  assert.throws(() => model.parseBoard(42), /Board content must be a string/);
});

test('parseBoard requires all five columns', () => {
  const truncated = EMPTY_BOARD.split('---\n\n## Done')[0];
  assert.throws(() => model.parseBoard(truncated), /Expected five board columns/);
});

test('parseBoard preserves CRLF newlines through a round trip', () => {
  const source = boardWith(card({ id: 'AO-001', title: 'Windows outcome' })).replace(/\n/g, '\r\n');
  const board = model.parseBoard(source);
  assert.equal(board.newline, '\r\n');
  assert.equal(model.serializeBoard(board), source);
});

test('createCard reserves the next free ID and applies defaults', () => {
  const board = model.parseBoard(boardWith(card({ id: 'AO-007', title: 'Existing' })));
  const created = model.createCard(board);
  assert.equal(created.id, 'AO-008');
  assert.equal(created.title, 'Untitled outcome');
  assert.equal(created.priority, 'P2');
  assert.equal(created.area, 'meta');
  assert.equal(created.columnId, 'inbox');
  assert.equal(created.checked, false);
});

test('nextCardId takes the highest of board and history identifiers', () => {
  const board = model.parseBoard(boardWith(card({ id: 'AO-012', title: 'Board card' })));
  assert.equal(model.nextCardId(board), 'AO-013');
  assert.equal(model.nextCardId(board, [{ card: 'AO-099' }]), 'AO-100');
  assert.equal(model.nextCardId(board, [{ card: 'not-an-id' }]), 'AO-013');
});

test('findCard returns the owning column and index, or null', () => {
  const board = model.parseBoard(buildBoard({
    Inbox: card({ id: 'AO-001', title: 'First' }),
    Doing: card({ id: 'AO-002', title: 'Second' }),
  }));

  const found = model.findCard(board, 'AO-002');
  assert.equal(found.column.id, 'doing');
  assert.equal(found.cardIndex, 0);
  assert.equal(model.findCard(board, 'AO-404'), null);
});

test('moveCard flips the checkbox when a card enters or leaves Done', () => {
  const board = model.parseBoard(boardWith(card({ id: 'AO-001', title: 'Ship it' })));

  const completed = model.moveCard(board, 'AO-001', 'done');
  assert.equal(completed.checked, true);
  assert.equal(completed.columnId, 'done');

  const reopened = model.moveCard(board, 'AO-001', 'doing');
  assert.equal(reopened.checked, false);
  assert.equal(reopened.columnId, 'doing');
  assert.doesNotThrow(() => model.validateBoard(board));
});

test('moveCard rejects unknown cards and unknown columns', () => {
  const board = model.parseBoard(boardWith(card({ id: 'AO-001', title: 'Only card' })));
  assert.throws(() => model.moveCard(board, 'AO-404', 'done'), /Card or target column was not found/);
  assert.throws(() => model.moveCard(board, 'AO-001', 'archive'), /Card or target column was not found/);
});

test('moveCard to the same index is a no-op that still validates', () => {
  const board = model.parseBoard(boardWith([
    card({ id: 'AO-001', title: 'First' }),
    card({ id: 'AO-002', title: 'Second' }),
  ].join('\n\n')));

  model.moveCard(board, 'AO-002', 'inbox', 1);
  assert.deepEqual(board.columns[0].cards.map((item) => item.id), ['AO-001', 'AO-002']);
});

test('moveCard clamps out-of-range target indexes', () => {
  const board = model.parseBoard(boardWith([
    card({ id: 'AO-001', title: 'First' }),
    card({ id: 'AO-002', title: 'Second' }),
    card({ id: 'AO-003', title: 'Third' }),
  ].join('\n\n')));

  model.moveCard(board, 'AO-003', 'inbox', -5);
  assert.deepEqual(board.columns[0].cards.map((item) => item.id), ['AO-003', 'AO-001', 'AO-002']);

  model.moveCard(board, 'AO-003', 'inbox', 999);
  assert.deepEqual(board.columns[0].cards.map((item) => item.id), ['AO-001', 'AO-002', 'AO-003']);
});

test('reordering downward accounts for the removed source slot', () => {
  const board = model.parseBoard(boardWith([
    card({ id: 'AO-001', title: 'First' }),
    card({ id: 'AO-002', title: 'Second' }),
    card({ id: 'AO-003', title: 'Third' }),
  ].join('\n\n')));

  model.moveCard(board, 'AO-001', 'inbox', 2);
  assert.deepEqual(board.columns[0].cards.map((item) => item.id), ['AO-002', 'AO-001', 'AO-003']);
});

test('validateBoard rejects duplicate identifiers across columns', () => {
  const board = model.parseBoard(boardWith(card({ id: 'AO-001', title: 'First' })));
  board.columns[1].cards.push({ ...board.columns[0].cards[0], columnId: 'next' });
  assert.throws(() => model.validateBoard(board), /Duplicate card ID AO-001/);
});

test('serializeBoard preserves description and assignee details in order', () => {
  const source = boardWith(card({
    id: 'AO-001',
    title: 'Detailed outcome',
    details: [['Description', 'Written detail.'], ['Assignee', 'alex-smith']],
  }));
  const board = model.parseBoard(source);

  assert.equal(board.columns[0].cards[0].detailValues.description, 'Written detail.');
  assert.equal(board.columns[0].cards[0].detailValues.assignee, 'alex-smith');
  assert.equal(model.serializeBoard(board), source);
});

test('an empty column serializes back to the empty marker', () => {
  const board = model.parseBoard(boardWith(card({ id: 'AO-001', title: 'Only card' })));
  model.moveCard(board, 'AO-001', 'done');
  assert.match(model.serializeBoard(board), /## Inbox\n\n<!-- empty -->/);
});

test('a bundle with no cards and no history validates', () => {
  const validation = model.validateBundleSources(EMPTY_BOARD, CONFIG, HISTORY);
  assert.equal(validation.cardCount, 0);
  assert.equal(validation.historyEvents.length, 0);
  assert.equal(validation.diagnostics.length, 0);
});
