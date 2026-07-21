#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const model = require('../media/board-model.js');

const root = path.resolve(process.argv[2] || process.cwd());
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

try {
  const boardSource = read('BOARD.md');
  const configSource = read('KANBAN-CONFIG.md');
  const historySource = read('KANBAN-HISTORY.md');
  const board = model.parseBoard(boardSource);
  const config = model.parseConfig(configSource);
  const history = model.parseHistory(historySource);
  const cards = board.columns.flatMap((column) => column.cards);
  const entityIds = new Set(config.entities.map((entity) => entity.id));
  const missing = [...new Set(cards.map((card) => card.area).filter((area) => !entityIds.has(area)))];

  if (missing.length > 0) throw new Error(`Missing entity configuration: ${missing.join(', ')}.`);
  if (model.serializeBoard(board) !== boardSource) {
    throw new Error('BOARD.md does not round-trip exactly. Keep descriptions on one physical line and line endings consistent.');
  }

  console.log(`Kanban bundle valid: ${cards.length} cards, ${config.entities.length} entities, ${history.events.length} history events`);
} catch (error) {
  console.error(`Kanban bundle invalid: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
