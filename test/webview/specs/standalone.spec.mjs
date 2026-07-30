import { createRequire } from 'node:module';

import { expect, test } from '@playwright/test';

import { createBundle } from '../harness/bundle.mjs';
import { openCardDialog } from './helpers.mjs';

const require = createRequire(import.meta.url);
const model = require('../../../src/webview/board-model.js');

async function installStandaloneFolder(page, initial, name = 'offline-board') {
  await page.addInitScript((initial) => {
    const sources = {
      'BOARD.md': initial.bundle.boardSource,
      'KANBAN-CONFIG.md': initial.bundle.configSource,
      'KANBAN-HISTORY.md': initial.bundle.historySource,
    };
    const handles = Object.fromEntries(Object.keys(sources).map((name) => [
      name,
      {
        getFile: async () => ({ text: async () => sources[name] }),
        createWritable: async () => ({
          write: async (content) => {
            sources[name] = String(content);
          },
          close: async () => undefined,
        }),
      },
    ]));
    window.__standaloneSources = sources;
    window.showDirectoryPicker = async () => ({
      name: initial.name,
      getFileHandle: async (name) => {
        if (!handles[name]) throw new window.DOMException(`${name} missing`, 'NotFoundError');
        return handles[name];
      },
    });
  }, { bundle: initial, name });
}

test('opens, styles, edits, and saves a local Markdown bundle without companion assets', async ({ page }) => {
  const bundle = createBundle(model);
  const assetRequests = [];
  page.on('request', (request) => {
    if (request.resourceType() !== 'document') assetRequests.push(request.url());
  });
  await installStandaloneFolder(page, bundle);
  await page.goto('/?standalone=1');
  await expect(page.locator('#welcomePanel')).toBeVisible();
  await expect(page.locator('#welcomeConnectButton')).toHaveText('Choose board folder');
  const presentation = await page.locator('#appShell').evaluate((element) => {
    const styles = getComputedStyle(element);
    return { background: styles.backgroundColor, color: styles.color };
  });
  expect(presentation.background).not.toBe(presentation.color);
  expect(assetRequests).toEqual([]);

  await page.locator('#welcomeConnectButton').click();
  await expect(page.locator('.kanban-column')).toHaveCount(5);
  await expect(page.locator('#connectButton')).toHaveText('offline-board');

  await openCardDialog(page, 'AO-001');
  await page.locator('#cardTitle').fill('Saved in the air-gapped board');
  await page.locator('#submitCardButton').click();
  await page.locator('#saveButton').click();
  await expect(page.locator('#saveState')).toHaveAttribute('data-state', 'saved');

  const saved = await page.evaluate(() => ({ ...window.__standaloneSources }));
  expect(saved['BOARD.md']).toContain('Saved in the air-gapped board');
  expect(saved['KANBAN-HISTORY.md']).toContain('"event":"updated"');
});

test('duplicates an outcome and records its source in a local Markdown bundle', async ({ page }) => {
  const bundle = createBundle(model);
  await installStandaloneFolder(page, bundle);
  await page.goto('/?standalone=1');
  await page.locator('#welcomeConnectButton').click();

  await page.locator('[data-card-id="AO-001"]').click({ button: 'right' });
  await page.locator('#duplicateCardActionButton').click();
  await expect(page.locator('[data-card-id="AO-007"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#saveButton').click();
  await expect(page.locator('#saveState')).toHaveAttribute('data-state', 'saved');

  const saved = await page.evaluate(() => ({ ...window.__standaloneSources }));
  expect(saved['BOARD.md']).toContain('AO-007 — Confirm research themes (Copy)');
  expect(saved['KANBAN-HISTORY.md']).toContain('"duplicatedFrom":"AO-001"');

  await page.locator('#reloadButton').click();
  await expect(page.locator('[data-card-id="AO-007"]')).toContainText('Confirm research themes (Copy)');
});

test('normalizes a repairable board in the selected standalone folder', async ({ page }) => {
  const bundle = createBundle(model);
  bundle.boardSource = bundle.boardSource.replace(
    '    - **Assignee:** maya-chen\n\n- [ ] AO-002',
    '    - **Assignee:** maya-chen\n- [ ] AO-002',
  );
  await installStandaloneFolder(page, bundle, 'repairable-board');

  await page.goto('/?standalone=1');
  await page.locator('#welcomeConnectButton').click();
  await expect(page.locator('#welcomePanel')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#welcomeNormalizeButton')).toBeVisible();

  await page.locator('#welcomeNormalizeButton').click();

  await expect(page.locator('.kanban-column')).toHaveCount(5);
  const saved = await page.evaluate(() => ({ ...window.__standaloneSources }));
  expect(saved['BOARD.md']).toContain('    - **Assignee:** maya-chen\n\n- [ ] AO-002');
});
