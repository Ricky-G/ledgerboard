'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const model = require('../../src/webview/board-model.js');
const { CONFIG, HISTORY, boardWithTwoCards } = require('../fixtures/board-fixtures.js');
const { REPOSITORY_ROOT } = require('../helpers/repository.js');
const { createTemporaryBundle } = require('../helpers/temporary-bundle.js');

const VALIDATE_CLI = path.join(REPOSITORY_ROOT, 'scripts', 'validate-board.js');

function runValidateCli(root) {
  return childProcess.spawnSync(process.execPath, [VALIDATE_CLI, root], { encoding: 'utf8' });
}

test('CLI and shared model return the same separator diagnostic', () => {
  const boardSource = boardWithTwoCards('\n');
  const bundle = createTemporaryBundle({ prefix: 'ledgerboard-cli-', boardSource });
  try {
    let modelMessage = '';
    try {
      model.validateBundleSources(boardSource, CONFIG, HISTORY);
    } catch (error) {
      modelMessage = error.message;
    }
    const result = runValidateCli(bundle.root);

    assert.notEqual(result.status, 0);
    assert.match(modelMessage, /Cards AO-001 and AO-002/);
    assert.ok(
      result.stderr.includes(modelMessage),
      `CLI stderr did not include the shared diagnostic: ${result.stderr}`,
    );
  } finally {
    bundle.cleanup();
  }
});

test('CLI succeeds and reports totals for a canonical bundle', () => {
  const bundle = createTemporaryBundle({
    prefix: 'ledgerboard-cli-valid-',
    boardSource: boardWithTwoCards('\n\n'),
  });
  try {
    const result = runValidateCli(bundle.root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Kanban bundle valid: 2 tickets, 1 label/);
  } finally {
    bundle.cleanup();
  }
});

test('CLI reports a missing bundle instead of crashing', () => {
  const result = runValidateCli(path.join(REPOSITORY_ROOT, 'this-folder-does-not-exist'));
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /ENOENT|invalid/i);
});
