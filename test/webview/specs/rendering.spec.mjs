import { expect, test } from '@playwright/test';

import { openBoard } from './helpers.mjs';

test.describe('board rendering', () => {
  test('renders every column with its fixture cards', async ({ page }) => {
    await openBoard(page);

    const columns = page.locator('.kanban-column');
    await expect(columns).toHaveCount(5);
    await expect(columns.nth(0).locator('h2')).toHaveText('Inbox');
    await expect(columns.nth(1).locator('h2')).toHaveText('Next');
    await expect(columns.nth(2).locator('h2')).toHaveText('Doing');
    await expect(columns.nth(3).locator('h2')).toHaveText('Review / Blocked');
    await expect(columns.nth(4).locator('h2')).toHaveText('Done');

    await expect(page.locator('[data-column="inbox"] .kanban-card')).toHaveCount(2);
    await expect(page.locator('.kanban-card')).toHaveCount(6);
  });

  test('shows card identity, label, priority, and assignee', async ({ page }) => {
    await openBoard(page);

    const card = page.locator('[data-card-id="AO-004"]');
    await expect(card).toContainText('AO-004');
    await expect(card).toContainText('Ship assignment history');
    await expect(card).toContainText('LedgerBoard');
    await expect(card).toContainText('P1');
    await expect(card).toContainText('Alex Smith');
  });

  test('applies the configured accent and workspace name', async ({ page }) => {
    await openBoard(page);

    await expect(page.locator('#workspaceName')).toHaveText('Harness workspace');
    await expect(page.locator('#boardTitle')).toHaveText('Harness board');
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    expect(accent).toBe('#e24a35');
  });

  test('reports board statistics from the loaded bundle', async ({ page }) => {
    await openBoard(page);

    await expect(page.locator('#statusTotal')).toHaveText('6 tickets');
    await expect(page.locator('#historyEventCount')).toHaveText('3 events');
    await expect(page.locator('#activeCount')).toHaveText('5');
    await expect(page.locator('#doingCount')).toHaveText('1');
    await expect(page.locator('#blockedCount')).toHaveText('1');
  });

  test('renders an empty-state marker for a board with no cards', async ({ page }) => {
    await openBoard(page, { scenario: 'empty' });

    await expect(page.locator('.kanban-card')).toHaveCount(0);
    await expect(page.locator('.empty-column')).toHaveCount(5);
    await expect(page.locator('#activeCount')).toHaveText('0');
  });

  test('keeps the board readable in the active colour scheme', async ({ page }) => {
    await openBoard(page);

    const contrast = await page.evaluate(() => {
      const shell = document.getElementById('appShell');
      const styles = getComputedStyle(shell);
      return { background: styles.backgroundColor, color: styles.color };
    });
    expect(contrast.background).not.toBe(contrast.color);
    await expect(page.locator('#appShell')).toBeVisible();
  });
});
