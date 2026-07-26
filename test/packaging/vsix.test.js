/**
 * Packaging verification.
 *
 * Runs against the VSIX produced by `npm run vsix` (the `pretest:packaging`
 * hook). These tests exist because a broken package cannot be detected by any
 * other layer: the extension compiles, the tests pass, and the published
 * artifact is still unusable if an asset is missing or a private file leaks.
 */

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { REPOSITORY_ROOT, repositoryPath } = require('../helpers/repository.js');

const manifest = JSON.parse(fs.readFileSync(repositoryPath('package.json'), 'utf8'));

function locateVsix() {
  const candidates = fs.readdirSync(REPOSITORY_ROOT)
    .filter((name) => name.endsWith('.vsix'))
    .map((name) => path.join(REPOSITORY_ROOT, name));
  assert.ok(
    candidates.length > 0,
    'No .vsix found. Run `npm run vsix` (or `npm run test:packaging`) first.',
  );
  return candidates
    .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime)[0].file;
}

const vsixPath = locateVsix();

/** List the archive entries without unpacking, using PowerShell-free Node APIs. */
function listEntries(archive) {
  const buffer = fs.readFileSync(archive);
  const entries = [];
  // Walk the central directory, which is the authoritative entry list.
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let offset = buffer.indexOf(signature);
  while (offset !== -1) {
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.push({ name, uncompressedSize });
    offset = buffer.indexOf(signature, offset + 46 + nameLength + extraLength + commentLength);
  }
  return entries;
}

const entries = listEntries(vsixPath);
const names = new Set(entries.map((entry) => entry.name));

test('produces a VSIX named for the current version', () => {
  assert.match(path.basename(vsixPath), /\.vsix$/);
  assert.ok(
    path.basename(vsixPath).includes(manifest.version),
    `Expected ${path.basename(vsixPath)} to contain version ${manifest.version}.`,
  );
});

test('ships the bundled extension entry point', () => {
  assert.ok(names.has('extension/dist/extension.js'), 'dist/extension.js is missing from the VSIX.');
  const bundle = entries.find((entry) => entry.name === 'extension/dist/extension.js');
  assert.ok(bundle.uncompressedSize > 1024, 'The bundled entry point looks empty.');
  assert.equal(manifest.main, './dist/extension.js');
});

test('ships every webview asset the panel loads', () => {
  for (const asset of ['index.html', 'app.js', 'board-model.js', 'styles.css']) {
    assert.ok(names.has(`extension/media/${asset}`), `media/${asset} is missing from the VSIX.`);
  }
});

test('ships the marketplace metadata files', () => {
  // `vsce` lowercases the readme and changelog when it packages them.
  const lowercased = new Set([...names].map((name) => name.toLowerCase()));
  for (const file of ['package.json', 'readme.md', 'changelog.md', 'license.txt']) {
    assert.ok(lowercased.has(`extension/${file}`), `${file} is missing from the VSIX.`);
  }
  assert.ok(names.has('extension.vsixmanifest'));
});

test('excludes source, tests, tooling, and CI configuration', () => {
  const leaked = [...names].filter((name) => (
    name.startsWith('extension/src/')
    || name.startsWith('extension/test/')
    || name.startsWith('extension/scripts/')
    || name.startsWith('extension/docs/')
    || name.startsWith('extension/.github/')
    || name.startsWith('extension/node_modules/')
    || name.endsWith('.ts')
    || name.endsWith('.map')
    || name.endsWith('.vsix')
  ));
  assert.deepEqual(leaked, [], `The VSIX leaks files that belong in the repository only: ${leaked}`);
});

test('excludes the test artifacts produced by the other layers', () => {
  const artifacts = [...names].filter((name) => (
    name.includes('/coverage/')
    || name.includes('/playwright-report/')
    || name.includes('/test-results/')
    || name.includes('playwright.config')
  ));
  assert.deepEqual(artifacts, [], `The VSIX contains test artifacts: ${artifacts}`);
});

test('stays within a reasonable size budget', () => {
  const bytes = fs.statSync(vsixPath).size;
  assert.ok(bytes > 20_000, `The VSIX is suspiciously small at ${bytes} bytes.`);
  assert.ok(bytes < 5_000_000, `The VSIX grew to ${bytes} bytes, over the 5 MB budget.`);
});

test('declares every contributed command in activation-safe form', () => {
  const commands = manifest.contributes.commands.map((command) => command.command);
  assert.ok(commands.length > 0, 'The extension contributes no commands.');
  for (const command of commands) {
    assert.match(command, /^ledgerBoard\./, `${command} is outside the ledgerBoard namespace.`);
  }
  const menuCommands = (manifest.contributes.menus?.commandPalette ?? [])
    .map((item) => item.command);
  for (const command of menuCommands) {
    assert.ok(commands.includes(command), `${command} appears in a menu but is not contributed.`);
  }
});

test('declares the engine range the CI matrix validates', () => {
  assert.ok(manifest.engines.vscode, 'The manifest must declare a VS Code engine range.');
  assert.match(manifest.engines.vscode, /^\^1\.\d+\.\d+$/);
});

test('installs into a clean extensions directory', (t) => {
  const cli = process.env.VSCODE_CLI_PATH;
  if (!cli || !fs.existsSync(cli)) {
    t.skip('Set VSCODE_CLI_PATH to run the install smoke check.');
    return;
  }
  const extensionsDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ledgerboard-vsix-'));
  try {
    const output = execFileSync(
      cli,
      ['--install-extension', vsixPath, '--extensions-dir', extensionsDir, '--force'],
      { encoding: 'utf8' },
    );
    assert.match(output, /successfully installed/i);
    assert.ok(fs.readdirSync(extensionsDir).length > 0);
  } finally {
    fs.rmSync(extensionsDir, { force: true, recursive: true });
  }
});
