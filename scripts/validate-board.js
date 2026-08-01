#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const model = require('../src/webview/board-model.js');

const root = path.resolve(process.argv[2] || process.cwd());
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

try {
  const boardSource = read('BOARD.md');
  const configSource = read('KANBAN-CONFIG.md');
  const historySource = read('KANBAN-HISTORY.md');
  const result = model.validateBundleSources(boardSource, configSource, historySource);

  console.log(`Kanban bundle valid: ${result.cardCount} ticket${result.cardCount === 1 ? '' : 's'}, ${result.config.entities.length} label${result.config.entities.length === 1 ? '' : 's'}, ${result.config.people.length} people, ${result.historyEvents.length} history events`);
  result.warnings.forEach((warning) => console.warn(`Warning: ${warning.message}`));
} catch (error) {
  console.error(`Kanban bundle invalid: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
