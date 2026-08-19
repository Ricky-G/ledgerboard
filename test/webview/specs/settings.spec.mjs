import { expect, test } from '@playwright/test';

import { columnCardIds, openBoard, saveNow } from './helpers.mjs';

const configSource = (page) => page.evaluate(() => window.ledgerboardHarness.configSource());
const boardSource = (page) => page.evaluate(() => window.ledgerboardHarness.boardSource());

test.describe('settings view', () => {
  test('shows the saved workspace, labels, and people', async ({ page }) => {
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

  test('adds a label and offers it to new cards', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="settings"]').click();
    await page.locator('#addEntityButton').click();

    await expect(page.locator('#entityList > *')).toHaveCount(4);
    await saveNow(page);
    const config = await configSource(page);
    expect(config).toContain('"id": "label-4"');
    expect(config).toContain('"name": "New label"');
  });

  test('keeps generated label names and IDs unique', async ({ page }) => {
    await openBoard(page, { scenario: 'label-id-collision' });
    await page.locator('.view-tab[data-view="settings"]').click();
    await page.locator('#addEntityButton').click();
    await page.locator('#addEntityButton').click();

    const labelRows = page.locator('#entityList > *');
    await expect(labelRows).toHaveCount(6);
    await expect(labelRows.nth(4).locator('.entity-id-input')).toHaveValue('label-5');
    await expect(labelRows.nth(4).getByLabel('Label name')).toHaveValue('New label');
    await expect(labelRows.nth(5).locator('.entity-id-input')).toHaveValue('label-6');
    await expect(labelRows.nth(5).getByLabel('Label name')).toHaveValue('New label 2');
  });

  test('rejects a duplicate label name before persistence', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="settings"]').click();

    const labelName = page.locator('#entityList input[aria-label="Label name"]').first();
    await labelName.fill('  NORTHSTAR LAUNCH  ');
    await labelName.blur();

    await expect(page.locator('.toast[data-tone="error"]')).toHaveText(
      'A label named "Northstar launch" already exists. Enter a different label name.',
    );
    await expect(labelName).toHaveValue('LedgerBoard');
    await expect(page.locator('#unsavedIndicator')).toBeHidden();
    expect(await configSource(page)).toContain('"name": "LedgerBoard"');
  });

  test('normalizes and persists a distinct label name', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="settings"]').click();

    const labelName = page.locator('#entityList input[aria-label="Label name"]').first();
    await labelName.fill('  Product planning  ');
    await labelName.blur();

    await expect(labelName).toHaveValue('Product planning');
    await expect(page.locator('#unsavedIndicator')).toBeVisible();
    await saveNow(page);
    expect(await configSource(page)).toContain('"name": "Product planning"');
  });

  test('uses label terminology when rejecting a duplicate label ID', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="settings"]').click();

    const labelId = page.locator('#entityList .entity-id-input').first();
    await labelId.fill('northstar');
    await labelId.blur();

    await expect(page.locator('.toast[data-tone="error"]')).toHaveText(
      'The label ID "northstar" is already used. Enter a unique label ID.',
    );
    await expect(labelId).toHaveValue('ledgerboard');
    await expect(page.locator('#unsavedIndicator')).toBeHidden();
  });

  test('removes an unreferenced label from card options and saved configuration', async ({ page }) => {
    await openBoard(page);
    await page.locator('#addCardButton').click();
    await page.locator('#cardArea').selectOption('internal');
    await page.locator('#cardDialog .close-dialog-button').click();
    await expect(page.locator('#cardDialog')).toBeHidden();
    await page.locator('.view-tab[data-view="analytics"]').click();
    await page.locator('#analyticsArea').selectOption('internal');
    await page.locator('.view-tab[data-view="settings"]').click();

    await page.getByRole('button', { name: 'Remove Internal' }).click();
    await expect(page.locator('#labelRemovalDialog')).toBeVisible();
    await expect(page.locator('#labelRemovalMessage')).toHaveText(
      'Remove Internal from the label palette? This does not change any tickets.',
    );
    await page.locator('#confirmLabelRemovalButton').click();

    await expect(page.locator('#entityList > *')).toHaveCount(2);
    await expect(page.locator('#cardArea option[value="internal"]')).toHaveCount(0);
    await expect(page.locator('#cardArea')).toHaveValue('ledgerboard');
    await expect(page.locator('#analyticsArea option[value="internal"]')).toHaveCount(0);
    await expect(page.locator('#analyticsArea')).toHaveValue('');
    await saveNow(page);
    expect(await configSource(page)).not.toContain('"id": "internal"');

    await page.evaluate(() => window.ledgerboardHarness.externalChange('KANBAN-CONFIG.md'));
    await expect(page.locator('#entityList > *')).toHaveCount(2);
    await expect(page.locator('#cardArea option[value="internal"]')).toHaveCount(0);
  });

  test('leaves a label unchanged when its removal confirmation is cancelled', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="settings"]').click();

    await page.getByRole('button', { name: 'Remove Internal' }).click();
    await expect(page.locator('#labelRemovalDialog')).toBeVisible();
    await page.locator('#cancelLabelRemovalButton').click();

    await expect(page.locator('#entityList > *')).toHaveCount(3);
    await expect(page.locator('#cardArea option[value="internal"]')).toHaveCount(1);
    await expect(page.locator('#unsavedIndicator')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Remove Internal' })).toBeFocused();
    expect(await configSource(page)).toContain('"id": "internal"');
  });

  test('blocks removal of a label referenced by current tickets', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="settings"]').click();

    await page.getByRole('button', { name: 'Remove Northstar launch' }).click();

    await expect(page.locator('#labelRemovalDialog')).toBeHidden();
    await expect(page.locator('.toast[data-tone="error"]')).toHaveText(
      'Northstar launch is assigned to 3 ticket(s). Reassign them before removing it.',
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

  test('configures, persists, and reorders board columns without losing tickets', async ({ page }) => {
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

    const columns = page.locator('#columnList .column-row');
    for (let index = 0; index < 5; index += 1) {
      await page.locator('#addColumnButton').click();
      await expect(columns).toHaveCount(6 + index);
    }

    await expect(columns).toHaveCount(10);
    const names = await columns.locator('.column-name-input').evaluateAll(
      (inputs) => inputs.map((input) => input.value),
    );
    expect(names.slice(5)).toEqual([
      'New column',
      'New column 2',
      'New column 3',
      'New column 4',
      'New column 5',
    ]);
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
