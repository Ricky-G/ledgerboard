import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { dragCardTo, openBoard } from './helpers.mjs';

test.describe('analytics view', () => {
  test('renders headline metrics from the fixture history', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="analytics"]').click();

    await expect(page.locator('#analyticsView')).toBeVisible();
    await expect(page.locator('#analyticsTimeZone')).toHaveText('Etc/UTC');
    await expect(page.locator('#metricActive')).not.toBeEmpty();
    await expect(page.locator('#metricBlocked')).not.toBeEmpty();
    await expect(page.locator('#statusChart')).not.toBeEmpty();
    await expect(page.locator('#statusChart')).not.toContainText('Done');
    await expect(page.locator('#statusTotal')).toHaveText('5 WIP tickets');
    await expect(page.locator('#priorityChart')).not.toBeEmpty();
    await expect(page.locator('#throughputChart')).not.toBeEmpty();
    await expect(page.locator('#completedWorkTotal')).not.toBeEmpty();
    await expect(page.locator('#completedWorkComparison')).toContainText('Grouped by day');
  });

  test('respects the selected reporting range', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="analytics"]').click();

    const initial = await page.locator('#analyticsRangeSummary').textContent();
    await page.locator('#analyticsRange').selectOption('7');
    await expect(page.locator('#analyticsRangeSummary')).not.toHaveText(initial ?? '');
  });

  test('includes unsaved lifecycle movements when analytics is reopened', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="analytics"]').click();
    await expect(page.locator('#completedWorkTotal')).toHaveText('0 completed');
    await expect(page.locator('#historyEventCount')).toHaveText('3 events');

    await page.locator('.view-tab[data-view="board"]').click();
    await dragCardTo(page, 'AO-001', 'done');
    await page.locator('.view-tab[data-view="analytics"]').click();

    await expect(page.locator('#completedWorkTotal')).toHaveText('1 completed');
    await expect(page.locator('#historyEventCount')).toHaveText('4 events');
    await expect(page.locator('#recentActivity')).toContainText('AO-001');
  });

  test('narrows analytics with the shared filters', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="analytics"]').click();
    await expect(page.locator('#analyticsHealthSummary')).toContainText('5 open');

    await page.locator('#analyticsArea').selectOption('northstar');

    await expect(page.locator('#analyticsHealthSummary')).toContainText('3 open');
    await expect(page.locator('#analyticsHealthSummary')).toContainText('1 blocked');
  });

  test('drills into separate WIP and completed-work chart data', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-tab[data-view="analytics"]').click();
    await page.locator('#analyticsRange').selectOption('custom');
    await page.locator('#analyticsStartDate').fill('2026-03-01');
    await page.locator('#analyticsEndDate').fill('2026-03-10');
    await page.locator('#analyticsEndDate').press('Tab');

    await expect(page.locator('#completedWorkTotal')).toHaveText('1 completed');
    await page.getByRole('button', { name: 'Doing: 1 tickets' }).first().click();
    await expect(page.locator('#analyticsDrilldown')).toContainText('AO-004: Ship assignment history');

    await page.getByRole('button', { name: '2026-03-05: 1 completed' }).click();
    await expect(page.locator('#analyticsDrilldown')).toContainText('AO-006: Publish the validation standard');

    await page.locator('#analyticsArea').selectOption('northstar');
    await expect(page.locator('#statusTotal')).toHaveText('3 WIP tickets');
    await expect(page.locator('#throughputChart')).toContainText('No completed work matches this selected period and filter.');
  });

  test('handles a board with no history without erroring', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await openBoard(page, { scenario: 'empty' });
    await page.locator('.view-tab[data-view="analytics"]').click();

    await expect(page.locator('#analyticsView')).toBeVisible();
    await expect(page.locator('#historyEventCount')).toHaveText('0 events');
    await expect(page.locator('#statusChart')).toContainText('No work in progress matches this filter.');
    await expect(page.locator('#throughputChart')).toContainText('No completed work matches this selected period and filter.');
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
