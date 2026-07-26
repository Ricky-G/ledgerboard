import { expect } from '@playwright/test';

/** Navigate to the harness and wait for the board to finish its first render. */
export async function openBoard(page, { scenario = 'default' } = {}) {
  const query = scenario === 'default' ? '' : `?scenario=${scenario}`;
  await page.goto(`/${query}`);
  if (scenario === 'invalid') {
    await expect(page.locator('#welcomePanel')).toHaveAttribute('data-state', 'error');
    return;
  }
  await expect(page.locator('#welcomePanel')).toBeHidden();
  await expect(page.locator('.kanban-column')).toHaveCount(5);
}

/** The persisted BOARD.md the harness currently holds. */
export function boardSource(page) {
  return page.evaluate(() => window.ledgerboardHarness.boardSource());
}

/** The persisted KANBAN-HISTORY.md the harness currently holds. */
export function historySource(page) {
  return page.evaluate(() => window.ledgerboardHarness.historySource());
}

/** Wait until the webview reports that all pending edits are persisted. */
export async function waitForSaved(page) {
  await expect(page.locator('#saveState')).toHaveAttribute('data-state', 'saved');
  await expect(page.locator('#unsavedIndicator')).toBeHidden();
}

/**
 * Persist pending edits and wait for the write to land.
 *
 * Autosave has a 1 second debounce, so the manual save button may already have
 * been disabled by an autosave that fired first. Invoking `persistChanges`
 * directly keeps the helper deterministic either way.
 */
export async function saveNow(page) {
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
  });
  await waitForSaved(page);
}

/** Open the create/edit dialog for a card, or the create dialog when id is null. */
export async function openCardDialog(page, cardId) {
  if (cardId) {
    await page.locator(`[data-card-id="${cardId}"]`).click();
  } else {
    await page.locator('#addCardButton').click();
  }
  await expect(page.locator('#cardDialog')).toBeVisible();
}

/** Card ids in DOM order for a column. */
export function columnCardIds(page, column) {
  return page.locator(`.card-list[data-column="${column}"] .kanban-card`).evaluateAll(
    (cards) => cards.map((card) => card.dataset.cardId),
  );
}

/**
 * Drive an HTML5 drag between two elements.
 *
 * Playwright's `dragTo` does not emit a `DataTransfer` payload that the board's
 * drop handler can read, so the sequence is built explicitly.
 */
export async function dragCardTo(page, cardId, targetColumn, { position = 'end' } = {}) {
  await page.evaluate(
    ({ cardId: id, targetColumn: column, position: where }) => {
      const card = document.querySelector(`[data-card-id="${id}"]`);
      const list = document.querySelector(`.card-list[data-column="${column}"]`);
      if (!card || !list) {
        throw new Error(`Missing drag source ${id} or drop target ${column}.`);
      }
      const transfer = new DataTransfer();
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));

      const bounds = list.getBoundingClientRect();
      const first = list.querySelector('.kanban-card:not(.is-filtered-out)');
      const clientY = where === 'start' && first
        ? first.getBoundingClientRect().top + 1
        : bounds.bottom + 1000;

      list.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientY, dataTransfer: transfer }));
      list.dispatchEvent(new DragEvent('drop', { bubbles: true, clientY, dataTransfer: transfer }));
      card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
    },
    { cardId, targetColumn, position },
  );
}

/** Begin a drag without dropping, so hover feedback can be asserted. */
export async function startDrag(page, cardId, targetColumn) {
  await page.evaluate(
    ({ cardId: id, targetColumn: column }) => {
      const card = document.querySelector(`[data-card-id="${id}"]`);
      const list = document.querySelector(`.card-list[data-column="${column}"]`);
      const transfer = new DataTransfer();
      window.__harnessTransfer = transfer;
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
      list.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: transfer }));
    },
    { cardId, targetColumn },
  );
}

/** Abandon an in-flight drag the way pressing Escape or releasing outside does. */
export async function cancelDrag(page, cardId) {
  await page.evaluate((id) => {
    const card = document.querySelector(`[data-card-id="${id}"]`);
    card.dispatchEvent(new DragEvent('dragend', {
      bubbles: true,
      dataTransfer: window.__harnessTransfer ?? new DataTransfer(),
    }));
  }, cardId);
}
