import { expect, test } from '@playwright/test';

import {
  boardSource,
  cancelDrag,
  columnCardIds,
  dragCardTo,
  finishDrag,
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

    await startDrag(page, 'AO-001', 'inbox', { position: 'end' });
    await expect(page.locator('.card-list[data-column="inbox"] .drop-indicator'))
      .toHaveAttribute('data-drop-index', '2');
    await finishDrag(page, 'AO-001', 'inbox');
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

    await startDrag(page, 'AO-005', 'doing');
    await expect(page.locator('.card-list[data-column="doing"] .empty-column')).toHaveClass(/is-drop-target/);
    await finishDrag(page, 'AO-005', 'doing');
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
    await expect(page.locator('.card-list[data-column="done"] .drop-indicator')).toHaveCount(1);

    await cancelDrag(page, 'AO-001');

    await expect(page.locator('.kanban-column[data-column="done"]')).not.toHaveClass(/is-drag-target/);
    await expect(page.locator('[data-card-id="AO-001"]')).not.toHaveClass(/is-dragging/);
    await expect(page.locator('.drop-indicator')).toHaveCount(0);
    expect(await columnCardIds(page, 'inbox')).toEqual(['AO-001', 'AO-002']);
    await expect(page.locator('#unsavedIndicator')).toBeHidden();
  });

  test('shows the displayed insertion slot for first, middle, and last placements', async ({ page }) => {
    await openBoard(page);

    await startDrag(page, 'AO-003', 'inbox', { position: 'start' });
    await expect(page.locator('.kanban-column[data-column="inbox"]')).toHaveClass(/is-drag-target/);
    await expect(page.locator('.card-list[data-column="inbox"] .drop-indicator'))
      .toHaveAttribute('data-drop-index', '0');
    await expect(page.locator('.card-list[data-column="inbox"] .drop-indicator'))
      .toHaveCSS('min-height', '42px');
    await expect(page.locator('.card-list[data-column="inbox"] .drop-indicator-label'))
      .toHaveText('Drop ticket here');
    await expect(page.locator('.card-list[data-column="inbox"] .drop-indicator'))
      .toHaveAttribute('aria-hidden', 'true');
    await cancelDrag(page, 'AO-003');

    await startDrag(page, 'AO-004', 'inbox', { beforeCardId: 'AO-002' });
    await expect(page.locator('.card-list[data-column="inbox"] .drop-indicator'))
      .toHaveAttribute('data-drop-index', '1');
    await finishDrag(page, 'AO-004', 'inbox');
    expect(await columnCardIds(page, 'inbox')).toEqual(['AO-001', 'AO-004', 'AO-002']);

    await startDrag(page, 'AO-003', 'inbox', { position: 'end' });
    await expect(page.locator('.card-list[data-column="inbox"] .drop-indicator'))
      .toHaveAttribute('data-drop-index', '3');
    await finishDrag(page, 'AO-003', 'inbox');
    expect(await columnCardIds(page, 'inbox')).toEqual(['AO-001', 'AO-004', 'AO-002', 'AO-003']);
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
