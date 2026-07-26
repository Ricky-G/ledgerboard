import { expect, test } from '@playwright/test';

import { boardSource, historySource, openBoard, openCardDialog, saveNow } from './helpers.mjs';

test.describe('card editing', () => {
  test('creates a card and persists it to BOARD.md and history', async ({ page }) => {
    await openBoard(page);
    await openCardDialog(page, null);

    await expect(page.locator('#cardDialogTitle')).toHaveText('Add an outcome');
    await expect(page.locator('#deleteCardButton')).toBeHidden();

    await page.locator('#cardTitle').fill('Harden the release gate');
    await page.locator('#cardDescription').fill('Require every layer to pass before publishing.');
    await page.locator('#cardArea').selectOption('internal');
    await page.locator('#cardPriority').selectOption('P1');
    await page.locator('#cardColumn').selectOption('next');
    await page.locator('#cardAssignee').selectOption('priya-shah');
    await page.locator('#submitCardButton').click();

    await expect(page.locator('#cardDialog')).toBeHidden();
    const created = page.locator('[data-card-id="AO-007"]');
    await expect(created).toBeVisible();
    await expect(created).toContainText('Harden the release gate');
    await expect(page.locator('.card-list[data-column="next"] .kanban-card')).toHaveCount(2);

    await saveNow(page);
    const markdown = await boardSource(page);
    expect(markdown).toContain('- [ ] AO-007 — Harden the release gate · P1 · area:internal');
    expect(markdown).toContain('    - **Description:** Require every layer to pass before publishing.');
    expect(markdown).toContain('    - **Assignee:** priya-shah');

    const history = await historySource(page);
    expect(history).toContain('"card":"AO-007"');
    expect(history).toContain('"event":"created"');
  });

  test('edits an existing card and records the change', async ({ page }) => {
    await openBoard(page);
    await openCardDialog(page, 'AO-002');

    await expect(page.locator('#cardDialogTitle')).toHaveText('Edit outcome');
    await expect(page.locator('#cardDialogEyebrow')).toHaveText('AO-002');
    await expect(page.locator('#cardTitle')).toHaveValue('Define reporting signal');
    await expect(page.locator('#deleteCardButton')).toBeVisible();

    await page.locator('#cardTitle').fill('Define reporting signals');
    await page.locator('#cardPriority').selectOption('P1');
    await page.locator('#cardAssignee').selectOption('maya-chen');
    await page.locator('#submitCardButton').click();

    await expect(page.locator('[data-card-id="AO-002"]')).toContainText('Define reporting signals');
    await expect(page.locator('[data-card-id="AO-002"]')).toContainText('Maya Chen');

    await saveNow(page);
    const markdown = await boardSource(page);
    expect(markdown).toContain('- [ ] AO-002 — Define reporting signals · P1 · area:ledgerboard');

    const history = await historySource(page);
    expect(history).toContain('"event":"updated"');
    expect(history).toContain('"changes":["title","priority","assignee"]');
    expect(history).toContain('"previousAssignee":null');
    expect(history).toContain('"assignee":"maya-chen"');
  });

  test('deletes a card after the removal is applied', async ({ page }) => {
    await openBoard(page);
    page.on('dialog', (dialog) => dialog.accept());
    await openCardDialog(page, 'AO-005');
    await page.locator('#deleteCardButton').click();

    await expect(page.locator('[data-card-id="AO-005"]')).toHaveCount(0);
    await expect(page.locator('.kanban-card')).toHaveCount(5);

    await saveNow(page);
    const markdown = await boardSource(page);
    expect(markdown).not.toContain('AO-005');
    expect(await historySource(page)).toContain('"event":"deleted"');
  });

  test('rejects a card with no title and keeps the dialog open', async ({ page }) => {
    await openBoard(page);
    await openCardDialog(page, null);

    await page.locator('#cardTitle').fill('   ');
    await page.locator('#submitCardButton').click();

    await expect(page.locator('#toastRegion')).toContainText('Outcome title is required.');
    await expect(page.locator('#cardDialog')).toBeVisible();
    await expect(page.locator('.kanban-card')).toHaveCount(6);
  });

  test('discards edits when the dialog is dismissed', async ({ page }) => {
    await openBoard(page);
    await openCardDialog(page, 'AO-001');

    await page.locator('#cardTitle').fill('Abandoned edit');
    await page.keyboard.press('Escape');

    await expect(page.locator('#cardDialog')).toBeHidden();
    await expect(page.locator('[data-card-id="AO-001"]')).toContainText('Confirm research themes');
    await expect(page.locator('#unsavedIndicator')).toBeHidden();
  });

  test('moves a card between columns from the dialog', async ({ page }) => {
    await openBoard(page);
    await openCardDialog(page, 'AO-001');

    await page.locator('#cardColumn').selectOption('done');
    await page.locator('#submitCardButton').click();

    await expect(page.locator('.card-list[data-column="done"] [data-card-id="AO-001"]')).toBeVisible();
    await saveNow(page);
    expect(await boardSource(page)).toContain('- [x] AO-001 — Confirm research themes');
  });

  test('opens the create dialog when the host requests a new card', async ({ page }) => {
    await openBoard(page);
    await page.evaluate(() => window.ledgerboardHarness.openNewCard());

    await expect(page.locator('#cardDialog')).toBeVisible();
    await expect(page.locator('#cardColumn')).toHaveValue('inbox');
  });
});
