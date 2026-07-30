/**
 * Browser-side VS Code API stub for the webview harness.
 *
 * Loads before `board-model.js` and `app.js`, so the app sees a working
 * `acquireVsCodeApi()`. All bundle state lives in this page, which keeps every
 * spec isolated. `window.ledgerboardHarness` lets specs drive host-side events
 * such as external file changes and load failures.
 */
(function initializeWebviewHarness() {
  "use strict";

  const element = document.getElementById("harnessBundle");
  const initial = JSON.parse(element ? element.textContent : "{}");
  const state = { ...initial };
  const posted = [];

  function dispatch(data) {
    window.dispatchEvent(new MessageEvent("message", { data }));
  }

  function load() {
    // The extension host validates before posting, and reports a load error
    // with a normalization hint when the bundle is unusable. Mirror that here
    // so specs exercise the same webview code paths.
    try {
      window.LedgerBoardModel.validateBundleSources(
        state.boardSource,
        state.configSource,
        state.historySource,
      );
    } catch (error) {
      dispatch({
        type: "loadError",
        message: error.message,
        canNormalize: Boolean(error.canNormalize),
      });
      return;
    }
    dispatch({ type: "load", bundle: { ...state } });
  }

  function save(request) {
    const model = window.LedgerBoardModel;
    if (!request || !request.base) {
      throw new Error("The harness received an empty save request.");
    }
    if (request.saveBoard && state.boardSource !== request.base.boardSource) {
      throw new Error("BOARD.md changed on disk. Reload before saving.");
    }
    if (request.saveConfig && state.configSource !== request.base.configSource) {
      throw new Error("KANBAN-CONFIG.md changed on disk. Reload before saving.");
    }

    const nextBoardSource = request.saveBoard ? request.nextBoardSource : state.boardSource;
    const nextConfigSource = request.saveConfig ? request.nextConfigSource : state.configSource;
    const events = request.saveBoard
      ? model.diffBoardEvents(
        model.parseBoard(state.boardSource),
        model.parseBoard(nextBoardSource),
        new Date().toISOString(),
        request.duplicateSources,
      )
      : [];
    model.parseConfig(nextConfigSource);
    const nextHistorySource = model.appendHistory(state.historySource, events);
    model.validateBundleSources(nextBoardSource, nextConfigSource, nextHistorySource);

    state.boardSource = nextBoardSource;
    state.configSource = nextConfigSource;
    state.historySource = nextHistorySource;
    return { ...state, events };
  }

  const vscode = {
    getState: () => null,
    setState: () => undefined,
    postMessage: (message) => {
      posted.push(message);
      if (message.type === "ready" || message.type === "reload" || message.type === "selectBoard") {
        load();
        return;
      }
      if (message.type === "normalize") {
        const model = window.LedgerBoardModel;
        try {
          state.boardSource = model.normalizeBoardSource(state.boardSource).source;
          load();
        } catch (error) {
          dispatch({ type: "loadError", message: error.message, canNormalize: false });
        }
        return;
      }
      if (message.type === "save") {
        try {
          dispatch({ type: "saveResult", result: save(message.request) });
        } catch (error) {
          dispatch({ type: "saveError", message: error.message });
        }
      }
    },
  };

  window.acquireVsCodeApi = () => vscode;

  window.ledgerboardHarness = {
    posted,
    lastPosted: (type) => posted.filter((message) => message.type === type).at(-1) ?? null,
    boardSource: () => state.boardSource,
    configSource: () => state.configSource,
    historySource: () => state.historySource,
    externalChange: (fileName) => dispatch({ type: "externalChange", fileName }),
    openNewCard: () => dispatch({ type: "openNewCard" }),
    loadError: (message, canNormalize) => dispatch({ type: "loadError", message, canNormalize }),
    saveError: (message) => dispatch({ type: "saveError", message }),
    corruptDisk: (boardSource) => { state.boardSource = boardSource; },
  };
})();
