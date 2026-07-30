(function initializeStandaloneHost() {
  "use strict";

  if (typeof window.acquireVsCodeApi === "function") return;

  const FILES = {
    board: "BOARD.md",
    config: "KANBAN-CONFIG.md",
    history: "KANBAN-HISTORY.md",
  };
  let directoryHandle = null;
  let viewState = null;

  function dispatch(data) {
    window.dispatchEvent(new MessageEvent("message", { data }));
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  async function requiredFileHandle(directory, fileName) {
    try {
      return await directory.getFileHandle(fileName);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        throw new Error(`${fileName} is missing from the selected folder.`);
      }
      throw error;
    }
  }

  async function readText(handle) {
    return (await handle.getFile()).text();
  }

  async function readBundle(directory = directoryHandle) {
    if (!directory) {
      throw new Error("Choose a board folder before loading files.");
    }
    const [boardHandle, configHandle, historyHandle] = await Promise.all([
      requiredFileHandle(directory, FILES.board),
      requiredFileHandle(directory, FILES.config),
      requiredFileHandle(directory, FILES.history),
    ]);
    const [boardSource, configSource, historySource] = await Promise.all([
      readText(boardHandle),
      readText(configHandle),
      readText(historyHandle),
    ]);
    return {
      handles: { boardHandle, configHandle, historyHandle },
      bundle: {
        rootName: directory.name || "Local board",
        boardSource,
        configSource,
        historySource,
      },
    };
  }

  async function load(directory = directoryHandle) {
    const loaded = await readBundle(directory);
    directoryHandle = directory;
    window.LedgerBoardModel.validateBundleSources(
      loaded.bundle.boardSource,
      loaded.bundle.configSource,
      loaded.bundle.historySource,
    );
    dispatch({ type: "load", bundle: loaded.bundle });
  }

  async function selectBoard() {
    if (typeof window.showDirectoryPicker !== "function") {
      throw new Error(
        "This browser cannot open local folders. Use a current offline installation of Chrome or Edge.",
      );
    }
    const selected = await window.showDirectoryPicker({ mode: "readwrite" });
    await load(selected);
  }

  async function writeText(handle, content) {
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  async function save(request) {
    if (!request || !request.base) {
      throw new Error("LedgerBoard received an empty save request.");
    }

    const current = await readBundle();
    const model = window.LedgerBoardModel;
    const { bundle, handles } = current;
    if (request.saveBoard && bundle.boardSource !== request.base.boardSource) {
      throw new Error(`${FILES.board} changed outside LedgerBoard. Reload before saving.`);
    }
    if (request.saveConfig && bundle.configSource !== request.base.configSource) {
      throw new Error(`${FILES.config} changed outside LedgerBoard. Reload before saving.`);
    }

    const nextBoardSource = request.saveBoard ? request.nextBoardSource : bundle.boardSource;
    const nextConfigSource = request.saveConfig ? request.nextConfigSource : bundle.configSource;
    const events = request.saveBoard
      ? model.diffBoardEvents(
        model.parseBoard(bundle.boardSource),
        model.parseBoard(nextBoardSource),
        new Date().toISOString(),
        request.duplicateSources,
      )
      : [];
    if (events.length > 0 && bundle.historySource !== request.base.historySource) {
      throw new Error(`${FILES.history} changed outside LedgerBoard. Reload before saving.`);
    }
    const nextHistorySource = model.appendHistory(bundle.historySource, events);
    model.validateBundleSources(nextBoardSource, nextConfigSource, nextHistorySource);

    const writes = [];
    if (request.saveBoard) writes.push(writeText(handles.boardHandle, nextBoardSource));
    if (request.saveConfig) writes.push(writeText(handles.configHandle, nextConfigSource));
    if (events.length > 0) writes.push(writeText(handles.historyHandle, nextHistorySource));
    await Promise.all(writes);

    return {
      boardSource: nextBoardSource,
      configSource: nextConfigSource,
      historySource: nextHistorySource,
      events,
    };
  }

  async function normalize() {
    const current = await readBundle();
    const normalized = window.LedgerBoardModel.normalizeBoardSource(current.bundle.boardSource);
    if (normalized.changed) {
      await writeText(current.handles.boardHandle, normalized.source);
    }
    await load();
  }

  async function handleMessage(message) {
    switch (message.type) {
      case "ready":
        return;
      case "selectBoard":
        await selectBoard();
        return;
      case "reload":
        await load();
        return;
      case "normalize":
        await normalize();
        return;
      case "save":
        dispatch({ type: "saveResult", result: await save(message.request) });
        return;
    }
  }

  const api = {
    mode: "standalone",
    getState: () => viewState,
    setState: (nextState) => {
      viewState = nextState;
    },
    postMessage: (message) => {
      void handleMessage(message).catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const saveFailure = message.type === "save";
        dispatch({
          type: saveFailure ? "saveError" : "loadError",
          message: errorMessage(error),
          canNormalize: Boolean(error && typeof error === "object" && error.canNormalize),
        });
      });
    },
  };

  window.acquireVsCodeApi = () => api;
})();
