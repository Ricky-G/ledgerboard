import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { openBoard } from './helpers.mjs';

test.describe('analytics view', () => {
  test('renders headline metrics from the fixture history', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="analytics"]').click();

    await expect(page.locator('#analyticsView')).toBeVisible();
    await expect(page.locator('#analyticsTimeZone')).toHaveText('Etc/UTC');
    await expect(page.locator('#metricActive')).not.toBeEmpty();
    await expect(page.locator('#metricBlocked')).not.toBeEmpty();
    await expect(page.locator('#statusChart')).not.toBeEmpty();
    await expect(page.locator('#priorityChart')).not.toBeEmpty();
  });

  test('respects the selected reporting range', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="analytics"]').click();

    const initial = await page.locator('#analyticsRangeSummary').textContent();
    await page.locator('#analyticsRange').selectOption('7');
    await expect(page.locator('#analyticsRangeSummary')).not.toHaveText(initial ?? '');
  });

  test('narrows analytics with the shared filters', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="analytics"]').click();
    await expect(page.locator('#analyticsHealthSummary')).toContainText('5 open');

    await page.locator('#analyticsArea').selectOption('northstar');

    await expect(page.locator('#analyticsHealthSummary')).toContainText('3 open');
    await expect(page.locator('#analyticsHealthSummary')).toContainText('1 blocked');
  });

  test('handles a board with no history without erroring', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await openBoard(page, { scenario: 'empty' });
    await page.locator('.view-tab[data-view="analytics"]').click();

    await expect(page.locator('#analyticsView')).toBeVisible();
    await expect(page.locator('#historyEventCount')).toHaveText('0 events');
    expect(errors).toEqual([]);
  });

  test('exports the current analytics selection', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="analytics"]').click();

    const download = page.waitForEvent('download');
    await page.locator('#analyticsExport').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.(csv|json|md)$/);
    const exported = JSON.parse(await readFile(await file.path(), 'utf8'));
    expect(exported.distribution.labels).toHaveProperty('northstar');
    expect(exported.distribution.entities).toEqual(exported.distribution.labels);
  });
});
