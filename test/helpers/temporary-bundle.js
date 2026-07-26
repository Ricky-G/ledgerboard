'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { CONFIG, HISTORY } = require('../fixtures/board-fixtures.js');

/**
 * Create an isolated on-disk board bundle in the OS temp directory.
 *
 * Callers receive the directory path and a `cleanup` function. Every temp
 * directory carries a unique suffix so parallel or repeated runs cannot share
 * state, and cleanup is force-recursive so a failed assertion never leaves a
 * fixture behind.
 */
function createTemporaryBundle({
  prefix = 'ledgerboard-',
  boardSource,
  configSource = CONFIG,
  historySource = HISTORY,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(root, 'BOARD.md'), boardSource);
  fs.writeFileSync(path.join(root, 'KANBAN-CONFIG.md'), configSource);
  fs.writeFileSync(path.join(root, 'KANBAN-HISTORY.md'), historySource);
  return {
    root,
    read: (fileName) => fs.readFileSync(path.join(root, fileName), 'utf8'),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

module.exports = { createTemporaryBundle };
