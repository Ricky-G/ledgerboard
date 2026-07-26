import { expect, test } from '@playwright/test';

import {
  boardSource,
  cancelDrag,
  columnCardIds,
  dragCardTo,
  historySource,
  openBoard,
  saveNow,
  startDrag,
} from './helpers.mjs';

test.describe('drag and drop', () => {
  test('moves a card to another column and records the move', async ({ page }) => {
    await openBoard(page);
    await dragCardTo(page, 'AO-001', 'doing');

    expect(await columnCardIds(page, 'doing')).toEqual(['AO-004', 'AO-001']);
    expect(await columnCardIds(page, 'inbox')).toEqual(['AO-002']);

    await saveNow(page);
    const history = await historySource(page);
    expect(history).toContain('"card":"AO-001"');
    expect(history).toContain('"from":"inbox"');
    expect(history).toContain('"to":"doing"');
  });

  test('reorders a card within its own column', async ({ page }) => {
    await openBoard(page);
    expect(await columnCardIds(page, 'inbox')).toEqual(['AO-001', 'AO-002']);

    await dragCardTo(page, 'AO-001', 'inbox');
    expect(await columnCardIds(page, 'inbox')).toEqual(['AO-002', 'AO-001']);

    await saveNow(page);
    const markdown = await boardSource(page);
    expect(markdown.indexOf('AO-002')).toBeLessThan(markdown.indexOf('AO-001'));
  });

  test('drops a card onto an empty column', async ({ page }) => {
    await openBoard(page);
    await dragCardTo(page, 'AO-004', 'next');
    await dragCardTo(page, 'AO-003', 'inbox');
    expect(await columnCardIds(page, 'doing')).toEqual([]);

    await dragCardTo(page, 'AO-005', 'doing');
    expect(await columnCardIds(page, 'doing')).toEqual(['AO-005']);
    await expect(page.locator('.card-list[data-column="doing"] .empty-column')).toHaveCount(0);
  });

  test('checks the card when it lands in Done and unchecks it when it leaves', async ({ page }) => {
    await openBoard(page);
    await dragCardTo(page, 'AO-001', 'done');
    await saveNow(page);
    expect(await boardSource(page)).toContain('- [x] AO-001 —');

    await dragCardTo(page, 'AO-006', 'inbox');
    await saveNow(page);
    expect(await boardSource(page)).toContain('- [ ] AO-006 —');
  });

  test('highlights the hovered column and clears the highlight on cancel', async ({ page }) => {
    await openBoard(page);
    await startDrag(page, 'AO-001', 'done');

    await expect(page.locator('.kanban-column[data-column="done"]')).toHaveClass(/is-drag-target/);
    await expect(page.locator('[data-card-id="AO-001"]')).toHaveClass(/is-dragging/);

    await cancelDrag(page, 'AO-001');

    await expect(page.locator('.kanban-column[data-column="done"]')).not.toHaveClass(/is-drag-target/);
    await expect(page.locator('[data-card-id="AO-001"]')).not.toHaveClass(/is-dragging/);
    expect(await columnCardIds(page, 'inbox')).toEqual(['AO-001', 'AO-002']);
    await expect(page.locator('#unsavedIndicator')).toBeHidden();
  });

  test('keeps a long column stable across repeated moves', async ({ page }) => {
    await openBoard(page);
    for (const cardId of ['AO-002', 'AO-003', 'AO-005', 'AO-006']) {
      await dragCardTo(page, cardId, 'inbox');
    }

    expect(await columnCardIds(page, 'inbox'))
      .toEqual(['AO-001', 'AO-002', 'AO-003', 'AO-005', 'AO-006']);
    await expect(page.locator('.kanban-card')).toHaveCount(6);

    await saveNow(page);
    const markdown = await boardSource(page);
    for (const cardId of ['AO-001', 'AO-002', 'AO-003', 'AO-004', 'AO-005', 'AO-006']) {
      expect(markdown).toContain(cardId);
    }
  });
});
