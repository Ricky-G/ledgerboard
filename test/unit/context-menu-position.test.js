'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const modulePath = path.resolve(__dirname, '../../src/webview/context-menu-position.js');
const { calculateContextMenuPosition } = require(modulePath);

const triggerBounds = { left: 120, top: 160, bottom: 264 };
const menuBounds = { width: 264, height: 192 };
const viewport = { width: 1280, height: 720 };

test('positions a pointer-invoked menu at the invoking coordinates', () => {
  assert.deepEqual(
    calculateContextMenuPosition({
      pointer: { x: 612, y: 356 },
      triggerBounds,
      menuBounds,
      viewport,
    }),
    { left: 612, top: 356 },
  );
});

test('anchors a keyboard-invoked menu below its focused ticket', () => {
  assert.deepEqual(
    calculateContextMenuPosition({ triggerBounds, menuBounds, viewport }),
    { left: 120, top: 272 },
  );
});

test('keeps menus within the viewport at its right and bottom edges', () => {
  assert.deepEqual(
    calculateContextMenuPosition({
      pointer: { x: 1275, y: 715 },
      triggerBounds,
      menuBounds,
      viewport,
    }),
    { left: 1004, top: 516 },
  );
});

test('exposes the positioning helper to the browser webview', () => {
  const browser = { globalThis: {} };
  vm.runInNewContext(fs.readFileSync(modulePath, 'utf8'), browser, { filename: modulePath });

  assert.equal(
    browser.globalThis.LedgerBoardMenuPosition.calculateContextMenuPosition({
      triggerBounds,
      menuBounds,
      viewport,
    }).top,
    272,
  );
});
