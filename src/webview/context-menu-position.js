(function initContextMenuPosition(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.LedgerBoardMenuPosition = api;
})(globalThis, function createContextMenuPosition() {
  "use strict";

  const DEFAULT_MARGIN = 12;
  const KEYBOARD_TRIGGER_OFFSET = 8;

  function calculateContextMenuPosition({
    pointer,
    triggerBounds,
    menuBounds,
    viewport,
    margin = DEFAULT_MARGIN,
  }) {
    const requestedLeft = pointer?.x ?? triggerBounds.left;
    const requestedTop = pointer?.y ?? triggerBounds.bottom + KEYBOARD_TRIGGER_OFFSET;
    return {
      left: clampToViewport(requestedLeft, menuBounds.width, viewport.width, margin),
      top: clampToViewport(requestedTop, menuBounds.height, viewport.height, margin),
    };
  }

  function clampToViewport(requestedPosition, menuSize, viewportSize, margin) {
    const maximum = Math.max(margin, viewportSize - menuSize - margin);
    return Math.max(margin, Math.min(requestedPosition, maximum));
  }

  return { calculateContextMenuPosition };
});
