import { expect, test } from '@playwright/test';

import { openBoard } from './helpers.mjs';

test.describe('narrow layout', () => {
  test('offers one tab per column with its card count', async ({ page }) => {
    await openBoard(page);

    const tabs = page.locator('#mobileColumnTabs .mobile-column-tab');
    await expect(tabs).toHaveCount(5);
    await expect(tabs.nth(0)).toContainText('Inbox');
    await expect(tabs.nth(0)).toContainText('2');
    await expect(tabs.nth(4)).toContainText('Done');
  });

  test('switches the active column when a tab is chosen', async ({ page }) => {
    await openBoard(page);
    await expect(page.locator('.kanban-column[data-column="doing"]'))
      .toHaveClass(/is-mobile-active/);

    await page.locator('#mobileColumnTabs .mobile-column-tab').nth(0).click();

    await expect(page.locator('.kanban-column[data-column="inbox"]'))
      .toHaveClass(/is-mobile-active/);
    await expect(page.locator('.kanban-column[data-column="doing"]'))
      .not.toHaveClass(/is-mobile-active/);
    await expect(page.locator('[data-card-id="AO-001"]')).toBeVisible();
  });

  test('keeps card editing usable at a narrow width', async ({ page }) => {
    await openBoard(page);
    await page.locator('[data-card-id="AO-004"]').click();

    await expect(page.locator('#cardDialog')).toBeVisible();
    const fitsViewport = await page.evaluate(() => {
      const dialog = document.getElementById('cardDialog').getBoundingClientRect();
      return dialog.width <= window.innerWidth && dialog.left >= 0;
    });
    expect(fitsViewport).toBe(true);
  });

  test('does not overflow the viewport horizontally', async ({ page }) => {
    await openBoard(page);

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
