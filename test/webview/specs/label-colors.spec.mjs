import { expect, test } from '@playwright/test';

import { openBoard, saveNow } from './helpers.mjs';

const configSource = (page) => page.evaluate(() => window.ledgerboardHarness.configSource());

test.describe('label colors', () => {
  test('applies, persists, and reloads a committed label color change', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="settings"]').click();

    await page.getByLabel('Northstar launch color').evaluate((input) => {
      input.value = '#123456';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect(page.locator('#unsavedIndicator')).toBeVisible();
    await expect.poll(() => page.locator('[data-card-id="AO-001"]').evaluate(
      (card) => card.style.getPropertyValue('--entity-color'),
    )).toBe('#123456');
    await expect.poll(() => page.locator('#entityChart .analytics-bar-row')
      .filter({ hasText: 'Northstar launch' })
      .locator('.analytics-bar-fill')
      .evaluate((bar) => bar.style.getPropertyValue('--bar-color'))).toBe('#123456');

    await saveNow(page);
    expect(await configSource(page)).toContain('"color": "#123456"');

    await page.evaluate(() => window.ledgerboardHarness.externalChange('KANBAN-CONFIG.md'));
    await expect.poll(() => page.locator('[data-card-id="AO-001"]').evaluate(
      (card) => card.style.getPropertyValue('--entity-color'),
    )).toBe('#123456');

    await page.locator('.view-tab[data-view="settings"]').click();
    await expect(page.getByLabel('Northstar launch color')).toHaveValue('#123456');
  });
});
