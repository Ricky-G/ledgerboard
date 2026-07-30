import { expect, test } from '@playwright/test';

import { columnCardIds, openBoard, saveNow } from './helpers.mjs';

const configSource = (page) => page.evaluate(() => window.ledgerboardHarness.configSource());
const boardSource = (page) => page.evaluate(() => window.ledgerboardHarness.boardSource());

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

  test('removes an unreferenced entity from card options and saved configuration', async ({ page }) => {
    await openBoard(page);
    await page.locator('#addCardButton').click();
    await page.locator('#cardArea').selectOption('internal');
    await page.locator('#cardDialog .close-dialog-button').click();
    await expect(page.locator('#cardDialog')).toBeHidden();
    await page.locator('.view-tab[data-view="settings"]').click();

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Remove Internal' }).click();

    await expect(page.locator('#entityList > *')).toHaveCount(2);
    await expect(page.locator('#cardArea option[value="internal"]')).toHaveCount(0);
    await expect(page.locator('#cardArea')).toHaveValue('ledgerboard');
    await saveNow(page);
    expect(await configSource(page)).not.toContain('"id": "internal"');

    await page.evaluate(() => window.ledgerboardHarness.externalChange('KANBAN-CONFIG.md'));
    await expect(page.locator('#entityList > *')).toHaveCount(2);
    await expect(page.locator('#cardArea option[value="internal"]')).toHaveCount(0);
  });

  test('leaves an entity unchanged when its removal confirmation is cancelled', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="settings"]').click();

    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Remove Internal' }).click();

    await expect(page.locator('#entityList > *')).toHaveCount(3);
    await expect(page.locator('#cardArea option[value="internal"]')).toHaveCount(1);
    await expect(page.locator('#unsavedIndicator')).toBeHidden();
    expect(await configSource(page)).toContain('"id": "internal"');
  });

  test('blocks removal of an entity referenced by current outcomes', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="settings"]').click();

    await page.getByRole('button', { name: 'Remove Northstar launch' }).click();

    await expect(page.locator('.toast[data-tone="error"]')).toHaveText(
      'Northstar launch is assigned to 3 outcome(s). Reassign them before removing it.',
    );
    await expect(page.locator('#entityList > *')).toHaveCount(3);
    await expect(page.locator('.kanban-card')).toHaveCount(6);
    await expect(page.locator('#unsavedIndicator')).toBeHidden();
    expect(await configSource(page)).toContain('"id": "northstar"');
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

  test('configures, persists, and reorders board columns without losing outcomes', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="settings"]').click();

    const columns = page.locator('#columnList .column-row');
    await expect(columns).toHaveCount(5);
    await columns.nth(0).locator('.column-name-input').fill('Capture');
    await columns.nth(0).locator('.column-name-input').blur();
    await page.locator('#addColumnButton').click();
    await expect(columns).toHaveCount(6);
    await columns.nth(5).locator('.column-name-input').fill('Release follow-through');
    await columns.nth(5).locator('.column-name-input').blur();
    await columns.nth(5).getByRole('button', { name: /move release follow-through earlier/i }).click();

    await saveNow(page);
    expect(await configSource(page)).toContain('"columns"');
    expect(await configSource(page)).toContain('"name": "Capture"');
    expect(await boardSource(page)).toContain('## Capture <!-- ledgerboard-column:inbox -->');
    expect(await boardSource(page)).toContain('## Release follow-through <!-- ledgerboard-column:column-6 -->');

    await page.locator('.view-tab[data-view="board"]').click();
    await expect(page.locator('.kanban-column[data-column="inbox"] h2')).toHaveText('Capture');
    await expect(page.locator('.kanban-card')).toHaveCount(6);
  });

  test('discards pending column edits before they change the board', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="settings"]').click();

    const name = page.locator('#columnList .column-name-input').first();
    await name.fill('Temporary');
    await name.blur();
    await expect(page.locator('#discardColumnChangesButton')).toBeEnabled();
    await page.locator('#discardColumnChangesButton').click();

    await expect(page.locator('#columnList .column-name-input').first()).toHaveValue('Inbox');
    await page.locator('.view-tab[data-view="board"]').click();
    await expect(page.locator('.kanban-column[data-column="inbox"] h2')).toHaveText('Inbox');
    expect(await boardSource(page)).not.toContain('ledgerboard-column:');
  });

  test('prevents an eleventh board column with a clear limit message', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="settings"]').click();

    for (let index = 0; index < 5; index += 1) {
      await page.locator('#addColumnButton').click();
    }

    await expect(page.locator('#columnList .column-row')).toHaveCount(10);
    await expect(page.locator('#addColumnButton')).toBeDisabled();
    await expect(page.locator('#columnsLimitMessage')).toHaveText(
      'A board can have a maximum of 10 columns.',
    );
    await expect(page.locator('#kanbanBoard')).toHaveAttribute(
      'style',
      /grid-template-columns: repeat\(10, minmax\(var\(--column-width\), 1fr\)\)/,
    );
  });

  test('requires a destination before removing a non-empty column', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="settings"]').click();

    await page.getByRole('button', { name: 'Remove Doing' }).click();
    await expect(page.locator('#columnRemovalDialog')).toBeVisible();
    await expect(page.locator('#columnRemovalTargetField')).toBeVisible();
    await page.locator('#columnRemovalTarget').selectOption('inbox');
    await page.locator('#confirmColumnRemovalButton').click();

    await expect(page.locator('#columnRemovalDialog')).toBeHidden();
    await expect(page.locator('#columnList .column-row')).toHaveCount(4);
    await saveNow(page);
    await page.locator('.view-tab[data-view="board"]').click();
    await expect(page.locator('.kanban-column[data-column="doing"]')).toHaveCount(0);
    await expect(page.locator('.kanban-card')).toHaveCount(6);
    await expect.poll(() => columnCardIds(page, 'inbox')).toEqual(['AO-001', 'AO-002', 'AO-004']);
    expect(await boardSource(page)).not.toContain('ledgerboard-column:doing');
  });
});
