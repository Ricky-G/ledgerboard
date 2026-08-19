import { expect, test } from '@playwright/test';

import { boardSource, openBoard, openCardDialog, saveNow, waitForSaved } from './helpers.mjs';

test.describe('load, save, and recovery states', () => {
  test('shows the error panel when the bundle cannot be loaded', async ({ page }) => {
    await openBoard(page, { scenario: 'invalid' });

    await expect(page.locator('#welcomePanel')).toBeVisible();
    await expect(page.locator('#welcomeTitle')).toHaveText('This board could not be loaded.');
    await expect(page.locator('#saveState')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('#addCardButton')).toBeDisabled();
    await expect(page.locator('.kanban-card')).toHaveCount(0);
  });

  test('guides users to repair persisted duplicate labels without changing ticket references', async ({ page }) => {
    await openBoard(page, { scenario: 'duplicate-labels' });

    await expect(page.locator('#welcomeCopy')).toHaveText(
      'Duplicate label name "northstar launch". Labels are matched without regard to case or surrounding whitespace. '
      + 'Rename one label in KANBAN-CONFIG.md while keeping label IDs unchanged so ticket references remain valid.',
    );
    await expect(page.locator('#addCardButton')).toBeDisabled();
  });

  test('offers normalization only when the model says it is safe', async ({ page }) => {
    await openBoard(page, { scenario: 'invalid' });
    await expect(page.locator('#welcomeNormalizeButton')).toBeHidden();

    await page.evaluate(() => window.ledgerboardHarness.loadError('Formatting drifted.', true));
    await expect(page.locator('#welcomeNormalizeButton')).toBeVisible();
    await expect(page.locator('#welcomeCopy')).toHaveText('Formatting drifted.');
  });

  test('marks the board dirty after an edit and clean after a save', async ({ page }) => {
    await openBoard(page);
    await expect(page.locator('#unsavedIndicator')).toBeHidden();
    await expect(page.locator('#saveButton')).toBeDisabled();

    await openCardDialog(page, 'AO-001');
    await page.locator('#cardTitle').fill('Renamed ticket');
    await page.locator('#submitCardButton').click();

    await expect(page.locator('#unsavedIndicator')).toBeVisible();
    await expect(page.locator('#saveButton')).toBeEnabled();

    await saveNow(page);
    expect(await boardSource(page)).toContain('Renamed ticket');
  });

  test('saves with the keyboard shortcut', async ({ page }) => {
    await openBoard(page);
    await openCardDialog(page, 'AO-001');
    await page.locator('#cardTitle').fill('Saved by shortcut');
    await page.locator('#submitCardButton').click();
    await expect(page.locator('#unsavedIndicator')).toBeVisible();

    await page.keyboard.press('Control+s');

    await waitForSaved(page);
    expect(await boardSource(page)).toContain('Saved by shortcut');
  });

  test('surfaces a save failure without losing the pending edit', async ({ page }) => {
    await openBoard(page);
    await openCardDialog(page, 'AO-001');
    await page.locator('#cardTitle').fill('Conflicting edit');
    await page.locator('#submitCardButton').click();

    // Simulate the file changing on disk between the read and the write.
    await page.evaluate(() => window.ledgerboardHarness.corruptDisk('# Rewritten elsewhere\n'));
    await page.locator('#saveButton').click();

    await expect(page.locator('#saveState')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('#toastRegion')).toContainText('Reload before saving');
    await expect(page.locator('[data-card-id="AO-001"]')).toContainText('Conflicting edit');
  });

  test('warns instead of reloading when an external change lands on dirty state', async ({ page }) => {
    await openBoard(page);
    await openCardDialog(page, 'AO-001');
    await page.locator('#cardTitle').fill('Local work in progress');
    await page.locator('#submitCardButton').click();

    await page.evaluate(() => window.ledgerboardHarness.externalChange('BOARD.md'));

    await expect(page.locator('#saveStateLabel')).toHaveText('External change');
    await expect(page.locator('#statusMessage')).toContainText('Reload to reconcile');
    await expect(page.locator('[data-card-id="AO-001"]')).toContainText('Local work in progress');
  });

  test('reloads silently when an external change lands on clean state', async ({ page }) => {
    await openBoard(page);
    await page.evaluate(() => window.ledgerboardHarness.externalChange('BOARD.md'));

    await expect(page.locator('.kanban-card')).toHaveCount(6);
    await expect(page.locator('#saveState')).toHaveAttribute('data-state', 'saved');
    const reloads = await page.evaluate(() =>
      window.ledgerboardHarness.posted.filter((message) => message.type === 'reload').length);
    expect(reloads).toBe(1);
  });

  test('recovers to a working board after a reported save error', async ({ page }) => {
    await openBoard(page);
    await page.evaluate(() => window.ledgerboardHarness.saveError('Disk is read only.'));
    await expect(page.locator('#saveState')).toHaveAttribute('data-state', 'error');

    await page.locator('#reloadButton').click();

    await expect(page.locator('#saveState')).toHaveAttribute('data-state', 'saved');
    await expect(page.locator('.kanban-card')).toHaveCount(6);
  });
});
