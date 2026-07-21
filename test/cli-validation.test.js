const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const model = require('../media/board-model.js');

const BOARD = `# Test Board

---

## Inbox

- [ ] AO-001 — First outcome · P1 · area:internal
    - **Description:** First description.
- [ ] AO-002 — Second outcome · P2 · area:internal
    - **Description:** Second description.

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

const CONFIG = `# Config

\`\`\`json
{"version":1,"workspace":{"name":"Test"},"appearance":{"accent":"#e24a35","density":"comfortable"},"entities":[{"id":"internal","name":"Internal","color":"#167d74"}]}
\`\`\`
`;

const HISTORY = '# History\n\n## Events\n';

test('CLI and shared model return the same separator diagnostic', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerboard-cli-'));
  try {
    fs.writeFileSync(path.join(root, 'BOARD.md'), BOARD);
    fs.writeFileSync(path.join(root, 'KANBAN-CONFIG.md'), CONFIG);
    fs.writeFileSync(path.join(root, 'KANBAN-HISTORY.md'), HISTORY);

    let modelMessage = '';
    try {
      model.validateBundleSources(BOARD, CONFIG, HISTORY);
    } catch (error) {
      modelMessage = error.message;
    }
    const result = childProcess.spawnSync(
      process.execPath,
      [path.resolve(__dirname, '..', 'scripts', 'validate-board.js'), root],
      { encoding: 'utf8' },
    );

    assert.notEqual(result.status, 0);
    assert.match(modelMessage, /Cards AO-001 and AO-002/);
    assert.ok(result.stderr.includes(modelMessage), `CLI stderr did not include shared diagnostic: ${result.stderr}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});