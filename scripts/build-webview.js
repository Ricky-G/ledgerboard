'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const SOURCE_ROOT = path.join(REPOSITORY_ROOT, 'src', 'webview');
const OUTPUT_FILE = path.join(REPOSITORY_ROOT, 'media', 'index.html');
const INLINE_NONCE = 'bGVkZ2VyYm9hcmQ';

function readSource(fileName) {
  return fs.readFileSync(path.join(SOURCE_ROOT, fileName), 'utf8').replace(/\r\n/g, '\n');
}

function indent(source, spaces) {
  const prefix = ' '.repeat(spaces);
  return source.trimEnd().split('\n').map((line) => (line ? `${prefix}${line}` : '')).join('\n');
}

function inlineStyle(source) {
  return `    <style nonce="${INLINE_NONCE}">\n${indent(source, 6)}\n    </style>`;
}

function inlineScript(source) {
  const safeSource = source.replaceAll('</script', '<\\/script');
  return `    <script nonce="${INLINE_NONCE}">\n${indent(safeSource, 6)}\n    </script>`;
}

function buildWebviewHtml() {
  const replacements = new Map([
    ['    <!-- LEDGERBOARD_STYLES -->', inlineStyle(readSource('styles.css'))],
    ['    <!-- LEDGERBOARD_MODEL -->', inlineScript(readSource('board-model.js'))],
    ['    <!-- LEDGERBOARD_STANDALONE -->', inlineScript(readSource('standalone.js'))],
    ['    <!-- LEDGERBOARD_MENU_POSITION -->', inlineScript(readSource('context-menu-position.js'))],
    ['    <!-- LEDGERBOARD_APP -->', inlineScript(readSource('app.js'))],
  ]);
  let html = readSource('index.html');
  for (const [marker, content] of replacements) {
    if (!html.includes(marker)) {
      throw new Error(`Missing webview build marker: ${marker.trim()}`);
    }
    html = html.replace(marker, content);
  }
  return `${html.trimEnd()}\n`;
}

function writeWebview() {
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, buildWebviewHtml(), 'utf8');
}

function watchWebview() {
  writeWebview();
  let timer;
  fs.watch(SOURCE_ROOT, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        writeWebview();
        console.log('[watch] rebuilt media/index.html');
      } catch (error) {
        console.error(error);
      }
    }, 50);
  });
}

if (require.main === module) {
  if (process.argv.includes('--watch')) {
    watchWebview();
  } else {
    writeWebview();
  }
}

module.exports = { INLINE_NONCE, OUTPUT_FILE, buildWebviewHtml, watchWebview, writeWebview };
