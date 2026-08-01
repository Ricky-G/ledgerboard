const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const model = require('../../src/webview/board-model.js');
const { REPOSITORY_ROOT } = require('../helpers/repository.js');

const EXTENSION_ROOT = path.join(REPOSITORY_ROOT, '.github', 'extensions', 'ledgerboard-preview');

test('project canvas resolves the current repository without branch-specific paths', async () => {
  const moduleUrl = pathToFileURL(path.join(EXTENSION_ROOT, 'repository-path.mjs')).href;
  const { repositoryRootFromExtensionRoot } = await import(moduleUrl);

  assert.equal(repositoryRootFromExtensionRoot(EXTENSION_ROOT), REPOSITORY_ROOT);
});

test('project canvas scripts have valid JavaScript syntax', () => {
  [
    'extension.mjs',
    'repository-path.mjs',
    'sample-data.mjs',
    'harness.js',
  ].forEach((fileName) => {
    const result = childProcess.spawnSync(
      process.execPath,
      ['--check', path.join(EXTENSION_ROOT, fileName)],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
  });
});

test('project canvas injects its host into the self-contained webview', () => {
  const source = require('node:fs').readFileSync(path.join(EXTENSION_ROOT, 'extension.mjs'), 'utf8');

  assert.match(source, /LEDGERBOARD_HOST/);
  assert.match(source, /bGVkZ2VyYm9hcmQ/);
  assert.doesNotMatch(source, /\/assets\/(?:styles|board-model|app)/);
  assert.doesNotMatch(source, /\{\{(?:cspSource|nonce|stylesUri|modelUri|appUri)\}\}/);
});

test('project canvas reports labels with an entities compatibility alias', () => {
  const source = require('node:fs').readFileSync(path.join(EXTENSION_ROOT, 'extension.mjs'), 'utf8');

  assert.match(source, /description: "Report the number of tickets, people, labels, and history events in the sandbox\."/);
  assert.match(source, /labels: validation\.config\.entities\.length/);
  assert.match(source, /entities: validation\.config\.entities\.length/);
});

test('project canvas sample data validates against the shared model', async () => {
  const moduleUrl = pathToFileURL(path.join(EXTENSION_ROOT, 'sample-data.mjs')).href;
  const { createSampleBundle } = await import(moduleUrl);
  const bundle = createSampleBundle(model);
  const validation = model.validateBundleSources(
    bundle.boardSource,
    bundle.configSource,
    bundle.historySource,
  );

  assert.equal(validation.cardCount, 9);
  assert.equal(validation.config.entities.length, 3);
  assert.equal(validation.config.people.length, 4);
  assert.equal(validation.historyEvents.length, 5);
});
