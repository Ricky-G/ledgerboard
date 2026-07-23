const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const model = require('../media/board-model.js');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
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
