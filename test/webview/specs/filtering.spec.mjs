import { expect, test } from '@playwright/test';

import { columnCardIds, openBoard } from './helpers.mjs';

const visibleCards = (page) =>
  page.locator('.kanban-card:not(.is-filtered-out)');

test.describe('filtering and search', () => {
  test('filters cards by free-text search', async ({ page }) => {
    await openBoard(page);
    await page.locator('#searchInput').fill('assignment');

    await expect(visibleCards(page)).toHaveCount(1);
    await expect(visibleCards(page)).toHaveAttribute('data-card-id', 'AO-004');
  });

  test('matches search against the card identifier', async ({ page }) => {
    await openBoard(page);
    await page.locator('#searchInput').fill('AO-006');

    await expect(visibleCards(page)).toHaveCount(1);
    await expect(visibleCards(page)).toHaveAttribute('data-card-id', 'AO-006');
  });

  test('filters by label', async ({ page }) => {
    await openBoard(page);
    await page.locator('#areaFilter').selectOption('northstar');

    await expect(visibleCards(page)).toHaveCount(3);
    await expect(page.locator('[data-card-id="AO-004"]')).toHaveClass(/is-filtered-out/);
  });

  test('filters by assignee', async ({ page }) => {
    await openBoard(page);
    await page.locator('#assigneeFilter').selectOption('jordan-lee');

    await expect(visibleCards(page)).toHaveCount(2);
  });

  test('filters by priority', async ({ page }) => {
    await openBoard(page);
    await page.locator('#priorityFilter').selectOption('P1');

    await expect(visibleCards(page)).toHaveCount(1);
    await expect(visibleCards(page)).toHaveAttribute('data-card-id', 'AO-004');
  });

  test('combines filters and shows nothing when they do not intersect', async ({ page }) => {
    await openBoard(page);
    await page.locator('#areaFilter').selectOption('northstar');
    await page.locator('#priorityFilter').selectOption('P1');

    await expect(visibleCards(page)).toHaveCount(0);
    await expect(page.locator('.kanban-card')).toHaveCount(6);
  });

  test('restores every card when filters are cleared', async ({ page }) => {
    await openBoard(page);
    await page.locator('#searchInput').fill('nothing matches this');
    await expect(visibleCards(page)).toHaveCount(0);

    await page.locator('#searchInput').fill('');
    await expect(visibleCards(page)).toHaveCount(6);
  });

  test('does not mutate the board while filtering', async ({ page }) => {
    await openBoard(page);
    await page.locator('#searchInput').fill('research');
    await page.locator('#searchInput').fill('');

    expect(await columnCardIds(page, 'inbox')).toEqual(['AO-001', 'AO-002']);
    await expect(page.locator('#unsavedIndicator')).toBeHidden();
  });
});
