'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const { repositoryPath } = require('../helpers/repository.js');
const { buildWebviewHtml } = require('../../scripts/build-webview.js');

test('media contains one self-contained offline HTML application', () => {
  const mediaRoot = repositoryPath('media');
  const entries = fs.readdirSync(mediaRoot).sort();
  // Tolerate a clone made before .gitattributes pinned the working tree to LF.
  const html = fs.readFileSync(repositoryPath('media', 'index.html'), 'utf8').replace(/\r\n/g, '\n');

  assert.deepEqual(entries, ['index.html']);
  assert.match(html, /<style nonce="[^"]+">[\s\S]+<\/style>/);
  assert.doesNotMatch(html, /<link\b[^>]*\brel=["']stylesheet["']/i);
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=/i);
  assert.match(html, /showDirectoryPicker/);
  assert.match(html, /getFileHandle/);
  assert.doesNotMatch(html, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/);
  assert.equal(
    html,
    buildWebviewHtml().replace(/\r\n/g, '\n'),
    'media/index.html must match its maintainable sources.',
  );
});
