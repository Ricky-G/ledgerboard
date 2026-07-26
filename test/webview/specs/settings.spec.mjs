import { expect, test } from '@playwright/test';

import { openBoard, saveNow } from './helpers.mjs';

const configSource = (page) => page.evaluate(() => window.ledgerboardHarness.configSource());

test.describe('settings view', () => {
  test('shows the saved workspace, entities, and people', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="settings"]').click();

    await expect(page.locator('#settingsView')).toBeVisible();
    await expect(page.locator('#configWorkspaceName')).toHaveValue('Harness workspace');
    await expect(page.locator('#configBoardTitle')).toHaveValue('Harness board');
    await expect(page.locator('#configTimezone')).toHaveValue('Etc/UTC');
    await expect(page.locator('#entityList > *')).toHaveCount(3);
    await expect(page.locator('#peopleList > *')).toHaveCount(4);
  });

  test('persists a workspace rename to KANBAN-CONFIG.md', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="settings"]').click();

    await page.locator('#configWorkspaceName').fill('Renamed workspace');
    await page.locator('#configWorkspaceName').blur();

    await expect(page.locator('#unsavedIndicator')).toBeVisible();
    await saveNow(page);

    expect(await configSource(page)).toContain('"name": "Renamed workspace"');
    await expect(page.locator('#workspaceName')).toHaveText('Renamed workspace');
  });

  test('adds an entity and offers it to new cards', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="settings"]').click();
    await page.locator('#addEntityButton').click();

    await expect(page.locator('#entityList > *')).toHaveCount(4);
    await saveNow(page);
    const config = await configSource(page);
    expect(config.match(/"id":/g).length).toBeGreaterThanOrEqual(8);
  });

  test('adds a person and offers them as an assignee', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="settings"]').click();
    await page.locator('#addPersonButton').click();

    await expect(page.locator('#peopleList > *')).toHaveCount(5);
    await saveNow(page);

    await page.locator('.view-tab[data-view="board"]').click();
    await page.locator('#addCardButton').click();
    await expect(page.locator('#cardAssignee option')).toHaveCount(6);
  });

  test('applies an accent change to the board immediately', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="settings"]').click();

    await page.locator('#configAccent').fill('#123456');
    await page.locator('#configAccent').dispatchEvent('input');

    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    expect(accent).toBe('#123456');
  });
});
