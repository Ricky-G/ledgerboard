import { expect, test } from '@playwright/test';

import { openBoard } from './helpers.mjs';

test.describe('accessibility and keyboard use', () => {
  test('gives every card a descriptive accessible name', async ({ page }) => {
    await openBoard(page);

    await expect(page.locator('[data-card-id="AO-004"]')).toHaveAttribute(
      'aria-label',
      'AO-004, Ship assignment history, LedgerBoard, assigned to Alex Smith, P1',
    );
    await expect(page.locator('[data-card-id="AO-002"]')).toHaveAttribute(
      'aria-label',
      'AO-002, Define reporting signal, LedgerBoard, unassigned, P3',
    );
  });

  test('exposes exactly one main landmark and a labelled board region', async ({ page }) => {
    await openBoard(page);

    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.locator('#kanbanBoard')).toHaveAttribute('aria-label', /board/i);
  });

  test('marks the active view tab with aria-pressed', async ({ page }) => {
    await openBoard(page);

    const board = page.locator('.view-tab[data-view="board"]');
    const analytics = page.locator('.view-tab[data-view="analytics"]');
    await expect(board).toHaveAttribute('aria-pressed', 'true');
    await expect(analytics).toHaveAttribute('aria-pressed', 'false');

    await analytics.click();
    await expect(analytics).toHaveAttribute('aria-pressed', 'true');
    await expect(board).toHaveAttribute('aria-pressed', 'false');
  });

  test('reaches a card with the keyboard and opens its editor with Enter', async ({ page }) => {
    await openBoard(page);
    const card = page.locator('[data-card-id="AO-001"]');
    await card.focus();
    await page.keyboard.press('Enter');

    await expect(page.locator('#cardDialog')).toBeVisible();
    await expect(page.locator('#cardDialogEyebrow')).toHaveText('AO-001');
  });

  test('supports keyboard context-menu keys, arrow keys, and Escape', async ({ page }) => {
    await openBoard(page);
    const card = page.locator('[data-card-id="AO-001"]');
    await card.focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.locator('#cardActionMenu')).toBeVisible();
    await expect(page.locator('#editCardActionButton')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#duplicateCardActionButton')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.locator('#editCardActionButton')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('#cardActionMenu')).toBeHidden();
    await expect(card).toBeFocused();
  });

  test('duplicates the focused card through the keyboard context menu', async ({ page }) => {
    await openBoard(page);
    const card = page.locator('[data-card-id="AO-001"]');
    await card.focus();
    await page.keyboard.press('Shift+F10');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page.locator('[data-card-id="AO-007"]')).toBeVisible();
    await expect(page.locator('#cardDialog')).toBeVisible();
    await expect(page.locator('#cardTitle')).toHaveValue('Confirm research themes (Copy)');
  });

  test('keeps deletion confirmation keyboard accessible and restores edit focus on cancel', async ({ page }) => {
    await openBoard(page);
    await page.locator('[data-card-id="AO-001"]').focus();
    await page.keyboard.press('Enter');
    await page.locator('#deleteCardButton').click();

    const confirmation = page.locator('#deleteConfirmationDialog');
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toHaveAccessibleName('Delete ticket?');
    await expect(page.locator('#cancelDeleteCardButton')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(confirmation).toBeHidden();
    await expect(page.locator('#cardDialog')).toBeVisible();
    await expect(page.locator('#deleteCardButton')).toBeFocused();
  });

  test('announces status changes in a live region', async ({ page }) => {
    await openBoard(page);

    await expect(page.locator('#toastRegion')).toHaveAttribute('aria-live', /polite|assertive/);
    await expect(page.locator('#statusMessage')).toBeVisible();
  });

  test('labels every card form control', async ({ page }) => {
    await openBoard(page);
    await page.locator('#addCardButton').click();
    await expect(page.locator('#cardDialog')).toBeVisible();

    for (const id of ['cardTitle', 'cardDescription', 'cardArea', 'cardAssignee', 'cardColumn', 'cardPriority']) {
      const labelled = await page.evaluate((controlId) => {
        const control = document.getElementById(controlId);
        if (control.getAttribute('aria-label')) {return true;}
        return [...(control.labels ?? [])].some((label) => label.textContent.trim().length > 0);
      }, id);
      expect(labelled, `${id} needs an accessible name`).toBe(true);
    }
  });

  test('keeps toolbar controls reachable in tab order', async ({ page }) => {
    await openBoard(page);
    const reachable = await page.evaluate(() =>
      [...document.querySelectorAll('#addCardButton, #reloadButton, #searchInput')]
        .every((element) => element.tabIndex >= 0 && !element.hasAttribute('aria-hidden')));
    expect(reachable).toBe(true);
  });
});
