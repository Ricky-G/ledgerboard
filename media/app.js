(function startKanbanApp() {
  "use strict";

  const model = window.CsaBoardModel;
  const vscode = acquireVsCodeApi();
  const BOARD_FILE = "BOARD.md";
  const CONFIG_FILE = "KANBAN-CONFIG.md";
  const HISTORY_FILE = "KANBAN-HISTORY.md";
  const AUTOSAVE_DELAY_MS = 1000;
  const COLUMN_DESCRIPTIONS = {
    inbox: "Awaiting triage",
    next: "Accepted and ready",
    doing: "Actively moving",
    blocked: "Waiting or reviewing",
    done: "Delivered and evidenced",
  };
  const COLUMN_EMPTY_COPY = {
    inbox: ["Inbox is clear", "New evidence-backed candidates land here."],
    next: ["Nothing queued", "Accepted outcomes ready to pull appear here."],
    doing: ["No active outcome", "Pull one clear finish when capacity allows."],
    blocked: ["Nothing waiting", "Dependencies and review states appear here."],
    done: ["Nothing closed yet", "Delivered outcomes appear here until weekly reset."],
  };

  const state = {
    rootName: "",
    boardSource: "",
    configSource: "",
    historySource: "",
    board: null,
    config: model.createDefaultConfig(),
    historyEvents: [],
    dirtyBoard: false,
    dirtyConfig: false,
    boardRevision: 0,
    configRevision: 0,
    autosaveTimer: null,
    saveInFlight: false,
    saveQueued: false,
    pendingSave: null,
    currentView: "board",
    mobileColumn: "doing",
    editingCardId: null,
    draggedCardId: null,
    suppressCardClick: false,
  };

  const elements = collectElements();

  initialize();

  function collectElements() {
    const ids = [
      "appShell", "workspaceName", "boardTitle", "connectionState", "connectionLabel",
      "saveState", "saveStateIcon", "saveStateLabel", "saveStateDetail",
      "reloadButton", "connectButton", "saveButton", "boardView", "settingsView",
      "analyticsView", "analyticsCoverage", "analyticsRange", "metricActive", "metricDone",
      "metricCompletion", "metricEntities", "metricCompletedLabel", "metricCompletedRange",
      "metricCycle", "statusTotal", "statusChart", "priorityChart", "activityChart",
      "entityChart", "historyEventCount", "recentActivity",
      "searchInput", "areaFilter", "priorityFilter", "activeCount", "blockedCount",
      "doingCount", "addCardButton", "mobileColumnTabs", "boardCanvas", "welcomePanel",
      "welcomeTitle", "welcomeCopy",
      "welcomeConnectButton", "browserNote", "kanbanBoard", "settingsSaveButton",
      "settingsContent", "configWorkspaceName", "configBoardTitle", "configTimezone",
      "configAccent", "configAccentValue", "entityList", "addEntityButton",
      "statusMessage", "unsavedIndicator", "lastLoadedLabel", "cardDialog", "cardForm",
      "cardDialogEyebrow", "cardDialogTitle", "cardId", "cardTitle", "cardDescription",
      "cardArea", "cardColumn", "cardPriority", "deleteCardButton", "submitCardButton", "toastRegion",
    ];
    return Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  }

  function initialize() {
    bindEvents();
    populateColumnSelect();
    applyConfig();
    renderSettings();
    window.addEventListener("message", handleExtensionMessage);
    vscode.postMessage({ type: "ready" });
  }

  function bindEvents() {
    elements.connectButton.addEventListener("click", connectRepository);
    elements.welcomeConnectButton.addEventListener("click", connectRepository);
    elements.reloadButton.addEventListener("click", reloadRepository);
    elements.saveButton.addEventListener("click", () => persistChanges({ manual: true }));
    elements.settingsSaveButton.addEventListener("click", () => persistChanges({ manual: true }));
    elements.addCardButton.addEventListener("click", () => openCardDialog(null, "inbox"));
    elements.searchInput.addEventListener("input", renderBoard);
    elements.areaFilter.addEventListener("change", renderBoard);
    elements.priorityFilter.addEventListener("change", renderBoard);
    elements.analyticsRange.addEventListener("change", renderAnalytics);
    elements.addEntityButton.addEventListener("click", addEntity);

    document.querySelectorAll(".view-tab").forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.view));
    });

    elements.cardForm.addEventListener("submit", submitCard);
    elements.deleteCardButton.addEventListener("click", deleteCurrentCard);
    document.querySelectorAll("[data-close-dialog]").forEach((button) => {
      button.addEventListener("click", () => button.closest("dialog").close());
    });

    elements.configWorkspaceName.addEventListener("input", (event) => {
      state.config.workspace.name = event.target.value;
      markDirty("config");
      applyConfig();
    });
    elements.configBoardTitle.addEventListener("input", (event) => {
      state.config.workspace.boardTitle = event.target.value;
      markDirty("config");
      applyConfig();
    });
    elements.configTimezone.addEventListener("input", (event) => {
      state.config.workspace.timezone = event.target.value;
      markDirty("config");
    });
    elements.configAccent.addEventListener("input", (event) => {
      state.config.appearance.accent = event.target.value;
      elements.configAccentValue.value = event.target.value;
      markDirty("config");
      applyConfig();
    });
    document.querySelectorAll("input[name='density']").forEach((input) => {
      input.addEventListener("change", (event) => {
        if (event.target.checked) {
          state.config.appearance.density = event.target.value;
          markDirty("config");
          applyConfig();
        }
      });
    });

    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (state.dirtyBoard || state.dirtyConfig) {
          persistChanges({ manual: true });
        }
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && (state.dirtyBoard || state.dirtyConfig)) {
        persistChanges();
      }
    });

    window.addEventListener("beforeunload", (event) => {
      if (state.dirtyBoard || state.dirtyConfig) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
  }

  function populateColumnSelect() {
    elements.cardColumn.replaceChildren();
    model.COLUMNS.forEach((column) => {
      const option = document.createElement("option");
      option.value = column.id;
      option.textContent = column.label;
      elements.cardColumn.append(option);
    });
  }

  function connectRepository() {
    vscode.postMessage({ type: "selectBoard" });
  }

  function reloadRepository() {
    if ((state.dirtyBoard || state.dirtyConfig) && !window.confirm("Discard unsaved board and configuration changes?")) {
      return;
    }
    vscode.postMessage({ type: "reload" });
  }

  function loadRepository(payload) {
    clearAutosaveTimer();
    const { rootName, boardSource, configSource, historySource } = payload;
    const board = model.parseBoard(boardSource);
    const config = model.parseConfig(configSource);
    const history = model.parseHistory(historySource);

    state.rootName = rootName;
    state.boardSource = boardSource;
    state.configSource = configSource;
    state.historySource = historySource;
    state.board = board;
    state.config = config;
    state.historyEvents = history.events;
    state.dirtyBoard = false;
    state.dirtyConfig = false;
    state.boardRevision = 0;
    state.configRevision = 0;
    state.saveInFlight = false;
    state.saveQueued = false;

    elements.welcomePanel.hidden = true;
    elements.connectButton.textContent = rootName;
    elements.connectionState.dataset.state = "online";
    elements.connectionLabel.textContent = `${BOARD_FILE} connected`;
    elements.reloadButton.disabled = false;
    elements.addCardButton.disabled = false;
    elements.settingsSaveButton.disabled = true;
    elements.lastLoadedLabel.textContent = `Loaded ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date())}`;

    applyConfig();
    renderAll();
    updateDirtyState();
    updateSaveState("saved", "Up to date", `Loaded ${formatTime(new Date())}`);
    setStatus(`Reading board, configuration, and history from ${rootName}.`, "online");
    showToast("Markdown files loaded.", "success");
  }

  function handleExtensionMessage(event) {
    const message = event.data;
    if (message.type === "load") {
      try {
        loadRepository(message.bundle);
      } catch (error) {
        showError(error);
      }
    } else if (message.type === "saveResult") {
      completeSave(message.result);
    } else if (message.type === "saveError") {
      failSave(message.message);
    } else if (message.type === "loadError") {
      showLoadError(message.message);
    } else if (message.type === "externalChange") {
      handleExternalChange(message.fileName);
    } else if (message.type === "openNewCard" && state.board) {
      openCardDialog(null, "inbox");
    }
  }

  function showLoadError(message) {
    clearAutosaveTimer();
    state.board = null;
    state.historyEvents = [];
    state.dirtyBoard = false;
    state.dirtyConfig = false;
    state.saveInFlight = false;
    state.pendingSave = null;
    elements.kanbanBoard.replaceChildren();
    elements.mobileColumnTabs.replaceChildren();
    elements.welcomePanel.hidden = false;
    elements.welcomePanel.dataset.state = "error";
    elements.welcomeTitle.textContent = "This board could not be loaded.";
    elements.welcomeCopy.textContent = message || "The Markdown bundle is invalid.";
    elements.welcomeConnectButton.textContent = "Choose another board";
    elements.browserNote.textContent = "Fix the reported Markdown issue, then reload, or choose a different board folder.";
    elements.reloadButton.disabled = false;
    elements.addCardButton.disabled = true;
    setView("board");
    updateStats();
    updateDirtyState();
    updateSaveState("error", "Load blocked", message || "Invalid Markdown bundle");
    setStatus(message || "The Markdown bundle is invalid.", "warning");
    showToast(message || "The Markdown bundle is invalid.", "error");
  }

  function handleExternalChange(fileName) {
    if (state.dirtyBoard || state.dirtyConfig || state.saveInFlight) {
      updateSaveState("error", "External change", `${fileName} changed. Reload before saving.`);
      setStatus(`${fileName} changed outside LedgerBoard. Reload to reconcile.`, "warning");
      return;
    }
    vscode.postMessage({ type: "reload" });
  }

  function renderAll() {
    renderBoard();
    renderSettings();
    renderAnalytics();
    populateAreaFilter();
    populateEntityOptions();
  }

  function renderBoard() {
    if (!state.board) {
      elements.kanbanBoard.replaceChildren();
      elements.mobileColumnTabs.replaceChildren();
      updateStats();
      return;
    }

    elements.kanbanBoard.replaceChildren();
    elements.mobileColumnTabs.replaceChildren();
    const query = elements.searchInput.value.trim().toLowerCase();
    const area = elements.areaFilter.value;
    const priority = elements.priorityFilter.value;

    state.board.columns.forEach((column, columnIndex) => {
      const columnElement = document.createElement("section");
      columnElement.className = "kanban-column";
      columnElement.dataset.column = column.id;
      if (column.id === state.mobileColumn) {
        columnElement.classList.add("is-mobile-active");
      }

      const header = document.createElement("header");
      header.className = "column-header";
      const index = document.createElement("span");
      index.className = "column-index";
      index.textContent = String(columnIndex + 1).padStart(2, "0");
      const titleBlock = document.createElement("div");
      titleBlock.className = "column-title-block";
      const title = document.createElement("h2");
      title.textContent = column.label;
      const description = document.createElement("p");
      description.textContent = COLUMN_DESCRIPTIONS[column.id];
      titleBlock.append(title, description);
      const count = document.createElement("span");
      count.className = "column-count";
      count.textContent = String(column.cards.length);
      const addButton = document.createElement("button");
      addButton.type = "button";
      addButton.className = "column-add-button";
      addButton.textContent = "+";
      addButton.title = `Add outcome to ${column.label}`;
      addButton.setAttribute("aria-label", `Add outcome to ${column.label}`);
      addButton.addEventListener("click", () => openCardDialog(null, column.id));
      header.append(index, titleBlock, count, addButton);

      const cardList = document.createElement("div");
      cardList.className = "card-list";
      cardList.dataset.column = column.id;
      bindDropZone(cardList, column);

      let visibleCount = 0;
      column.cards.forEach((card) => {
        const visible = cardMatches(card, query, area, priority);
        const cardElement = createCardElement(card);
        if (!visible) {
          cardElement.classList.add("is-filtered-out");
        } else {
          visibleCount += 1;
        }
        cardList.append(cardElement);
      });

      if (column.cards.length === 0) {
        cardList.append(createEmptyColumn(column));
      } else if (visibleCount === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-column";
        const copy = document.createElement("div");
        const strong = document.createElement("strong");
        strong.textContent = "No matching outcomes";
        copy.append(strong, document.createTextNode("Adjust the search or filters."));
        empty.append(copy);
        cardList.append(empty);
      }

      columnElement.append(header, cardList);
      elements.kanbanBoard.append(columnElement);
      elements.mobileColumnTabs.append(createMobileColumnTab(column));
    });

    updateStats();
  }

  function createCardElement(card) {
    const entity = getEntity(card.area);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "kanban-card";
    button.draggable = true;
    button.dataset.cardId = card.id;
    button.style.setProperty("--entity-color", entity.color);
    button.setAttribute("aria-label", `${card.id}, ${card.title}, ${entity.name}, ${card.priority}`);

    const topline = document.createElement("div");
    topline.className = "card-topline";
    const entityLabel = document.createElement("span");
    entityLabel.className = "card-entity";
    const swatch = document.createElement("span");
    swatch.className = "entity-swatch";
    const entityName = document.createElement("span");
    entityName.textContent = entity.name;
    entityLabel.append(swatch, entityName);
    const id = document.createElement("span");
    id.className = "card-id";
    id.textContent = card.id;
    topline.append(entityLabel, id);

    const title = document.createElement("h3");
    title.textContent = card.title;
    button.append(topline, title);

    if (card.detailValues.description) {
      const description = document.createElement("p");
      description.className = "card-description";
      description.textContent = card.detailValues.description;
      button.append(description);
    }

    const footer = document.createElement("div");
    footer.className = "card-footer";
    const priority = document.createElement("span");
    priority.className = "card-priority";
    priority.dataset.priority = card.priority;
    priority.textContent = card.priority;
    footer.append(priority);
    button.append(footer);

    button.addEventListener("click", () => {
      if (!state.suppressCardClick) {
        openCardDialog(card.id, card.columnId);
      }
    });
    button.addEventListener("dragstart", (event) => {
      state.draggedCardId = card.id;
      state.suppressCardClick = true;
      button.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", card.id);
    });
    button.addEventListener("dragend", () => {
      state.draggedCardId = null;
      button.classList.remove("is-dragging");
      document.querySelectorAll(".kanban-column").forEach((column) => column.classList.remove("is-drag-target"));
      window.setTimeout(() => { state.suppressCardClick = false; }, 0);
    });

    return button;
  }

  function createEmptyColumn(column) {
    const empty = document.createElement("div");
    empty.className = "empty-column";
    const copy = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = COLUMN_EMPTY_COPY[column.id][0];
    copy.append(strong, document.createTextNode(COLUMN_EMPTY_COPY[column.id][1]));
    empty.append(copy);
    return empty;
  }

  function createMobileColumnTab(column) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mobile-column-tab";
    if (column.id === state.mobileColumn) {
      button.classList.add("is-active");
    }
    button.append(document.createTextNode(column.label));
    const count = document.createElement("span");
    count.textContent = String(column.cards.length);
    button.append(count);
    button.addEventListener("click", () => {
      state.mobileColumn = column.id;
      renderBoard();
    });
    return button;
  }

  function bindDropZone(cardList, column) {
    cardList.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      cardList.closest(".kanban-column").classList.add("is-drag-target");
    });
    cardList.addEventListener("dragleave", (event) => {
      if (!cardList.contains(event.relatedTarget)) {
        cardList.closest(".kanban-column").classList.remove("is-drag-target");
      }
    });
    cardList.addEventListener("drop", (event) => {
      event.preventDefault();
      const cardId = event.dataTransfer.getData("text/plain") || state.draggedCardId;
      const visibleCards = [...cardList.querySelectorAll(".kanban-card:not(.is-filtered-out)")];
      const targetCard = visibleCards.find((card) => event.clientY < card.getBoundingClientRect().top + card.offsetHeight / 2);
      const targetIndex = targetCard
        ? column.cards.findIndex((card) => card.id === targetCard.dataset.cardId)
        : column.cards.length;
      try {
        model.moveCard(state.board, cardId, column.id, targetIndex);
        markDirty("board");
        renderBoard();
      } catch (error) {
        showError(error);
      }
    });
  }

  function cardMatches(card, query, area, priority) {
    if (area && card.area !== area) {
      return false;
    }
    if (priority && card.priority !== priority) {
      return false;
    }
    if (!query) {
      return true;
    }
    const haystack = [
      card.id, card.title, card.area, card.priority,
      ...Object.values(card.detailValues),
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  }

  function updateStats() {
    if (!state.board) {
      elements.activeCount.textContent = "0";
      elements.blockedCount.textContent = "0";
      elements.doingCount.textContent = "0/3";
      return;
    }
    const active = state.board.columns
      .filter((column) => column.id !== "done")
      .reduce((sum, column) => sum + column.cards.length, 0);
    const blocked = state.board.columns.find((column) => column.id === "blocked").cards.length;
    const doing = state.board.columns.find((column) => column.id === "doing").cards.length;
    elements.activeCount.textContent = String(active);
    elements.blockedCount.textContent = String(blocked);
    elements.doingCount.textContent = `${doing}/3`;
  }

  function populateAreaFilter() {
    const selected = elements.areaFilter.value;
    const areas = new Set(state.config.entities.map((entity) => entity.id));
    if (state.board) {
      state.board.columns.flatMap((column) => column.cards).forEach((card) => areas.add(card.area));
    }
    elements.areaFilter.replaceChildren();
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "All entities";
    elements.areaFilter.append(all);
    [...areas].sort().forEach((area) => {
      const option = document.createElement("option");
      option.value = area;
      option.textContent = getEntity(area).name;
      elements.areaFilter.append(option);
    });
    elements.areaFilter.value = areas.has(selected) ? selected : "";
  }

  function populateEntityOptions() {
    const selected = elements.cardArea.value;
    elements.cardArea.replaceChildren();
    state.config.entities.forEach((entity) => {
      const option = document.createElement("option");
      option.value = entity.id;
      option.textContent = entity.name;
      elements.cardArea.append(option);
    });
    if (selected && !state.config.entities.some((entity) => entity.id === selected)) {
      const option = document.createElement("option");
      option.value = selected;
      option.textContent = `${humanizeArea(selected)} (not configured)`;
      elements.cardArea.append(option);
    }
    elements.cardArea.value = selected || state.config.entities[0]?.id || "";
  }

  function getEntity(area) {
    return state.config.entities.find((entity) => entity.id === area) || {
      id: area,
      name: humanizeArea(area),
      color: "#7d8890",
    };
  }

  function humanizeArea(value) {
    return value
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Unassigned";
  }

  function openCardDialog(cardId, defaultColumn) {
    if (!state.board) {
      return;
    }
    const found = cardId ? model.findCard(state.board, cardId) : null;
    const card = found?.card;
    state.editingCardId = cardId;

    elements.cardId.value = card?.id || "";
    elements.cardTitle.value = card?.title || "";
    elements.cardDescription.value = card?.detailValues.description || "";
    elements.cardArea.value = card?.area || state.config.entities[0]?.id || "meta";
    elements.cardColumn.value = card?.columnId || defaultColumn || "inbox";
    elements.cardPriority.value = card?.priority || "P2";
    elements.cardDialogEyebrow.textContent = card ? card.id : "New outcome";
    elements.cardDialogTitle.textContent = card ? "Edit outcome" : "Add an outcome";
    elements.submitCardButton.textContent = card ? "Apply changes" : "Add outcome";
    elements.deleteCardButton.hidden = !card;
    elements.cardDialog.showModal();
  }

  function submitCard(event) {
    event.preventDefault();
    const values = readCardForm();
    try {
      validateCardForm(values);
      if (state.editingCardId) {
        updateExistingCard(state.editingCardId, values);
      } else {
        addNewCard(values);
      }
      model.validateBoard(state.board);
      markDirty("board");
      renderBoard();
      populateAreaFilter();
      elements.cardDialog.close();
      showToast(state.editingCardId ? "Outcome updated." : "Outcome added.", "success");
    } catch (error) {
      showError(error);
    }
  }

  function readCardForm() {
    return {
      title: elements.cardTitle.value.trim(),
      area: elements.cardArea.value.trim().toLowerCase(),
      columnId: elements.cardColumn.value,
      priority: elements.cardPriority.value,
      detailValues: {
        description: elements.cardDescription.value.trim(),
      },
    };
  }

  function validateCardForm(values) {
    if (!values.title) {
      throw new Error("Outcome title is required.");
    }
    if (!state.config.entities.some((entity) => entity.id === values.area)) {
      throw new Error("Choose an entity from the saved entity list.");
    }
    if (values.columnId === "doing") {
      const doing = state.board.columns.find((column) => column.id === "doing");
      const alreadyDoing = state.editingCardId && model.findCard(state.board, state.editingCardId).column.id === "doing";
      if (!alreadyDoing && doing.cards.length >= 3) {
        throw new Error("Doing already has three outcomes. Finish something before starting more.");
      }
    }
  }

  function updateExistingCard(cardId, values) {
    const found = model.findCard(state.board, cardId);
    if (!found) {
      throw new Error(`Could not find ${cardId}. Reload the board and try again.`);
    }
    const originalColumn = found.column.id;
    found.card.priority = values.priority;
    if (originalColumn !== values.columnId) {
      model.moveCard(state.board, cardId, values.columnId);
    }
    const card = model.findCard(state.board, cardId).card;
    card.title = values.title;
    card.area = values.area;
    card.detailValues = { ...card.detailValues, ...values.detailValues };
    card.checked = values.columnId === "done";
  }

  function addNewCard(values) {
    const card = model.createCard(state.board, { ...values, historyEvents: state.historyEvents });
    card.priority = values.priority;
    card.detailValues = values.detailValues;
    card.columnId = values.columnId;
    card.checked = values.columnId === "done";
    const column = state.board.columns.find((item) => item.id === values.columnId);
    column.cards.push(card);
  }

  function deleteCurrentCard() {
    const found = model.findCard(state.board, state.editingCardId);
    if (!found) {
      return;
    }
    if (!window.confirm(`Delete ${found.card.id} — ${found.card.title}?`)) {
      return;
    }
    found.column.cards.splice(found.cardIndex, 1);
    markDirty("board");
    renderBoard();
    elements.cardDialog.close();
    showToast(`${found.card.id} deleted.`, "success");
  }

  function renderSettings() {
    const config = state.config;
    elements.configWorkspaceName.value = config.workspace.name || "";
    elements.configBoardTitle.value = config.workspace.boardTitle || "";
    elements.configTimezone.value = config.workspace.timezone || "";
    elements.configAccent.value = config.appearance.accent || "#e24a35";
    elements.configAccentValue.value = config.appearance.accent || "#e24a35";
    const density = config.appearance.density || "comfortable";
    const densityInput = document.querySelector(`input[name='density'][value='${density}']`);
    if (densityInput) {
      densityInput.checked = true;
    }

    elements.entityList.replaceChildren();
    config.entities.forEach((entity, index) => {
      elements.entityList.append(createEntityRow(entity, index));
    });
  }

  function createEntityRow(entity, index) {
    const row = document.createElement("div");
    row.className = "entity-row";
    const color = document.createElement("input");
    color.type = "color";
    color.value = entity.color;
    color.title = `${entity.name} color`;
    color.setAttribute("aria-label", `${entity.name} color`);
    color.addEventListener("input", (event) => {
      entity.color = event.target.value;
      markDirty("config");
      applyConfig();
      renderBoard();
    });

    const name = document.createElement("input");
    name.type = "text";
    name.value = entity.name;
    name.maxLength = 80;
    name.setAttribute("aria-label", "Entity name");
    name.addEventListener("input", (event) => {
      entity.name = event.target.value;
      markDirty("config");
      populateAreaFilter();
      populateEntityOptions();
      renderBoard();
    });

    const id = document.createElement("input");
    id.type = "text";
    id.value = entity.id;
    id.maxLength = 50;
    id.pattern = "[a-z0-9][a-z0-9\\-]*";
    id.className = "entity-id-input";
    id.setAttribute("aria-label", "Entity area ID");
    id.addEventListener("change", (event) => changeEntityId(entity, event.target));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-entity-button";
    remove.textContent = "×";
    remove.title = `Remove ${entity.name}`;
    remove.setAttribute("aria-label", `Remove ${entity.name}`);
    remove.addEventListener("click", () => removeEntity(index));

    row.append(color, name, id, remove);
    return row;
  }

  function changeEntityId(entity, input) {
    const previous = entity.id;
    const next = input.value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(next)) {
      input.value = previous;
      showError(new Error("Area IDs use lowercase letters, numbers, and hyphens."));
      return;
    }
    if (state.config.entities.some((item) => item !== entity && item.id === next)) {
      input.value = previous;
      showError(new Error(`The area ID ${next} already exists.`));
      return;
    }
    entity.id = next;
    let updatedCards = 0;
    if (state.board) {
      state.board.columns.flatMap((column) => column.cards).forEach((card) => {
        if (card.area === previous) {
          card.area = next;
          updatedCards += 1;
        }
      });
    }
    markDirty("config");
    if (updatedCards > 0) {
      markDirty("board");
    }
    populateAreaFilter();
    populateEntityOptions();
    renderBoard();
  }

  function addEntity() {
    let suffix = state.config.entities.length + 1;
    while (state.config.entities.some((entity) => entity.id === `entity-${suffix}`)) {
      suffix += 1;
    }
    state.config.entities.push({
      id: `entity-${suffix}`,
      name: "New entity",
      color: "#2e6ea6",
    });
    markDirty("config");
    renderSettings();
    populateAreaFilter();
    populateEntityOptions();
    const lastRow = elements.entityList.lastElementChild;
    lastRow?.querySelector("input[type='text']")?.select();
  }

  function removeEntity(index) {
    const entity = state.config.entities[index];
    const usage = state.board
      ? state.board.columns.flatMap((column) => column.cards).filter((card) => card.area === entity.id)
      : [];
    if (usage.length > 0) {
      showError(new Error(`${entity.name} is assigned to ${usage.length} outcome(s). Reassign them before removing it.`));
      return;
    }
    if (!window.confirm(`Remove ${entity.name} from the entity palette?`)) {
      return;
    }
    state.config.entities.splice(index, 1);
    markDirty("config");
    renderSettings();
    populateAreaFilter();
    populateEntityOptions();
  }

  function applyConfig() {
    const accent = state.config.appearance?.accent || "#e24a35";
    const density = state.config.appearance?.density || "comfortable";
    document.documentElement.style.setProperty("--accent", accent);
    document.documentElement.style.setProperty("--accent-dark", shadeColor(accent, -24));
    elements.appShell.dataset.density = density;
    elements.workspaceName.textContent = state.config.workspace?.name || "My Workspace";
    elements.boardTitle.textContent = state.config.workspace?.boardTitle || "LedgerBoard";
    document.title = `${elements.boardTitle.textContent} · ${elements.workspaceName.textContent}`;
  }

  function shadeColor(hex, amount) {
    const value = Number.parseInt(hex.slice(1), 16);
    const red = Math.max(0, Math.min(255, (value >> 16) + amount));
    const green = Math.max(0, Math.min(255, ((value >> 8) & 0xff) + amount));
    const blue = Math.max(0, Math.min(255, (value & 0xff) + amount));
    return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  }

  function setView(view) {
    state.currentView = view;
    elements.boardView.hidden = view !== "board";
    elements.settingsView.hidden = view !== "settings";
    elements.analyticsView.hidden = view !== "analytics";
    document.querySelectorAll(".view-tab").forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (view === "settings") {
      renderSettings();
    }
    if (view === "analytics") {
      renderAnalytics();
    }
  }

  function renderAnalytics() {
    if (!state.board) {
      return;
    }

    const days = Number.parseInt(elements.analyticsRange.value, 10) || 30;
    const analytics = model.buildAnalytics(state.board, state.historyEvents, { days });
    elements.metricActive.textContent = String(analytics.active);
    elements.metricDone.textContent = String(analytics.done);
    elements.metricCompletion.textContent = `${analytics.completionRate}%`;
    elements.metricEntities.textContent = String(analytics.activeEntities);
    elements.metricCompletedLabel.textContent = `Completed · ${days}d`;
    elements.metricCompletedRange.textContent = String(analytics.completedInRange);
    elements.metricCycle.textContent = analytics.medianCycleDays === null
      ? "—"
      : `${analytics.medianCycleDays}d`;
    elements.statusTotal.textContent = `${analytics.total} outcomes`;
    elements.historyEventCount.textContent = `${analytics.historyEvents} events`;

    if (analytics.historySince) {
      const baselineCount = state.historyEvents.filter((event) => event.event === "baseline").length;
      elements.analyticsCoverage.textContent = `History tracked from ${formatShortDate(analytics.historySince)}`
        + ` · ${baselineCount} baseline observations · exact transitions recorded from that point.`;
    } else {
      elements.analyticsCoverage.textContent = "Current board state; transition history has not started yet.";
    }

    renderStatusChart(analytics);
    renderPriorityChart(analytics);
    renderActivityChart(analytics);
    renderEntityChart(analytics);
    renderRecentActivity(analytics);
  }

  function renderStatusChart(analytics) {
    elements.statusChart.replaceChildren();
    const colors = {
      inbox: "#7d8890",
      next: "#2e6ea6",
      doing: state.config.appearance.accent,
      blocked: "#a96912",
      done: "#167d74",
    };
    const track = document.createElement("div");
    track.className = "status-track";
    model.COLUMNS.forEach((column) => {
      const count = analytics.status[column.id];
      if (count === 0) return;
      const segment = document.createElement("div");
      segment.className = "status-segment";
      segment.dataset.status = column.id;
      segment.style.flexBasis = `${(count / Math.max(1, analytics.total)) * 100}%`;
      segment.title = `${column.label}: ${count}`;
      segment.textContent = count;
      track.append(segment);
    });

    const legend = document.createElement("div");
    legend.className = "status-legend";
    model.COLUMNS.forEach((column) => {
      const item = document.createElement("div");
      item.className = "status-legend-item";
      item.style.setProperty("--legend-color", colors[column.id]);
      const swatch = document.createElement("i");
      const label = document.createElement("span");
      label.textContent = column.label;
      const count = document.createElement("strong");
      count.textContent = String(analytics.status[column.id]);
      item.append(swatch, label, count);
      legend.append(item);
    });
    elements.statusChart.append(track, legend);
  }

  function renderPriorityChart(analytics) {
    elements.priorityChart.replaceChildren();
    const colors = { P1: "#b52f42", P2: "#c65d18", P3: "#2e6ea6", P4: "#617078" };
    const maximum = Math.max(1, ...Object.values(analytics.priority));
    Object.entries(analytics.priority).forEach(([priority, count]) => {
      elements.priorityChart.append(createAnalyticsBar(priority, count, maximum, colors[priority]));
    });
  }

  function renderEntityChart(analytics) {
    elements.entityChart.replaceChildren();
    const entries = Object.entries(analytics.entities)
      .sort((left, right) => right[1] - left[1] || getEntity(left[0]).name.localeCompare(getEntity(right[0]).name));
    if (entries.length === 0) {
      elements.entityChart.append(createAnalyticsEmpty("No active entity work."));
      return;
    }
    const maximum = Math.max(1, ...entries.map(([, count]) => count));
    entries.forEach(([area, count]) => {
      const entity = getEntity(area);
      elements.entityChart.append(createAnalyticsBar(entity.name, count, maximum, entity.color));
    });
  }

  function createAnalyticsBar(labelText, value, maximum, color) {
    const row = document.createElement("div");
    row.className = "analytics-bar-row";
    const label = document.createElement("span");
    label.textContent = labelText;
    label.title = labelText;
    const track = document.createElement("div");
    track.className = "analytics-bar-track";
    const fill = document.createElement("div");
    fill.className = "analytics-bar-fill";
    fill.style.width = `${(value / maximum) * 100}%`;
    fill.style.setProperty("--bar-color", color);
    track.append(fill);
    const count = document.createElement("strong");
    count.textContent = String(value);
    row.append(label, track, count);
    return row;
  }

  function renderActivityChart(analytics) {
    elements.activityChart.replaceChildren();
    const activityTotal = analytics.daily.reduce((sum, bucket) => sum + bucket.activity, 0);
    if (activityTotal === 0) {
      elements.activityChart.append(createAnalyticsEmpty(
        "Transition tracking starts with this baseline. Activity and throughput bars will appear after the next saved board change.",
      ));
      return;
    }
    const maximum = Math.max(1, ...analytics.daily.flatMap((bucket) => [bucket.activity, bucket.completed]));
    const labelEvery = analytics.rangeDays <= 7 ? 1 : analytics.rangeDays <= 30 ? 5 : 15;
    analytics.daily.forEach((bucket, index) => {
      const day = document.createElement("div");
      day.className = "activity-day";
      day.title = `${bucket.date}: ${bucket.activity} events, ${bucket.completed} completed`;
      const activity = document.createElement("div");
      activity.className = "activity-bar";
      activity.style.height = `${(bucket.activity / maximum) * 100}%`;
      const completed = document.createElement("div");
      completed.className = "completed-bar";
      completed.style.height = `${(bucket.completed / maximum) * 100}%`;
      day.append(activity, completed);
      if (index % labelEvery === 0 || index === analytics.daily.length - 1) {
        const label = document.createElement("span");
        label.className = "activity-day-label";
        label.textContent = formatChartDate(bucket.date);
        day.append(label);
      }
      elements.activityChart.append(day);
    });
  }

  function renderRecentActivity(analytics) {
    elements.recentActivity.replaceChildren();
    if (analytics.recent.length === 0) {
      elements.recentActivity.append(createAnalyticsEmpty(
        "No transitions recorded yet. The current board is baselined; future changes will appear here.",
      ));
      return;
    }

    const symbols = { created: "+", moved: "→", updated: "~", deleted: "×" };
    const colors = { created: "#2e6ea6", moved: "#a96912", updated: "#7a5ca8", deleted: "#b52f42" };
    analytics.recent.forEach((event) => {
      const row = document.createElement("article");
      row.className = "activity-event";
      const time = document.createElement("time");
      time.dateTime = event.at;
      time.textContent = formatEventTime(event.at);
      const symbol = document.createElement("span");
      symbol.className = "event-symbol";
      symbol.style.setProperty("--event-color", colors[event.event]);
      symbol.textContent = symbols[event.event];
      const copy = document.createElement("div");
      copy.className = "activity-event-copy";
      const title = document.createElement("strong");
      title.textContent = `${event.card} · ${event.title}`;
      const detail = document.createElement("span");
      detail.textContent = eventDescription(event);
      copy.append(title, detail);
      row.append(time, symbol, copy);
      elements.recentActivity.append(row);
    });
  }

  function eventDescription(event) {
    const entity = getEntity(event.area).name;
    if (event.event === "created") return `Created in ${statusLabel(event.to)} · ${entity} · ${event.priority}`;
    if (event.event === "moved") return `Moved ${statusLabel(event.from)} → ${statusLabel(event.to)} · ${entity}`;
    if (event.event === "updated") return `Updated ${event.changes.join(", ")} · ${entity}`;
    if (event.event === "deleted") return `Deleted from ${statusLabel(event.from)} · ${entity}`;
    return entity;
  }

  function statusLabel(status) {
    return model.COLUMNS.find((column) => column.id === status)?.label || status;
  }

  function createAnalyticsEmpty(message) {
    const empty = document.createElement("div");
    empty.className = "analytics-empty";
    empty.textContent = message;
    return empty;
  }

  function formatShortDate(timestamp) {
    return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" })
      .format(new Date(timestamp));
  }

  function formatChartDate(dateKey) {
    return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" })
      .format(new Date(`${dateKey}T00:00:00`));
  }

  function formatEventTime(timestamp) {
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(timestamp));
  }

  function markDirty(target) {
    if (target === "board") {
      state.dirtyBoard = true;
      state.boardRevision += 1;
    } else {
      state.dirtyConfig = true;
      state.configRevision += 1;
    }
    updateDirtyState();
    if (state.saveInFlight) {
      state.saveQueued = true;
      return;
    }
    scheduleAutosave();
  }

  function updateDirtyState() {
    const dirty = state.dirtyBoard || state.dirtyConfig;
    elements.saveButton.disabled = !dirty || state.saveInFlight;
    elements.settingsSaveButton.disabled = !dirty || state.saveInFlight;
    elements.unsavedIndicator.hidden = !dirty;
    if (state.board) {
      elements.connectionState.dataset.state = "online";
      elements.connectionLabel.textContent = `${BOARD_FILE} connected`;
    }
  }

  function clearAutosaveTimer() {
    if (state.autosaveTimer !== null) {
      window.clearTimeout(state.autosaveTimer);
      state.autosaveTimer = null;
    }
  }

  function scheduleAutosave() {
    if (!state.board || (!state.dirtyBoard && !state.dirtyConfig)) {
      return;
    }
    clearAutosaveTimer();
    updateSaveState("pending", "Unsaved changes", "Saving shortly");
    state.autosaveTimer = window.setTimeout(() => {
      state.autosaveTimer = null;
      persistChanges();
    }, AUTOSAVE_DELAY_MS);
  }

  function persistChanges({ manual = false } = {}) {
    if (!state.board || (!state.dirtyBoard && !state.dirtyConfig)) {
      return;
    }
    if (state.saveInFlight) {
      state.saveQueued = true;
      return;
    }

    clearAutosaveTimer();
    state.saveInFlight = true;
    state.saveQueued = false;
    const saveBoard = state.dirtyBoard;
    const saveConfig = state.dirtyConfig;
    const boardRevision = state.boardRevision;
    const configRevision = state.configRevision;
    updateDirtyState();
    updateSaveState("saving", "Saving…", "Checking Markdown files");

    try {
      model.validateBoard(state.board);
      model.validateConfig(state.config);
      const nextBoardSource = saveBoard ? model.serializeBoard(state.board) : state.boardSource;
      const nextConfigSource = saveConfig
        ? model.serializeConfig(state.configSource, state.config)
        : state.configSource;
      state.pendingSave = { saveBoard, saveConfig, boardRevision, configRevision, manual };
      vscode.postMessage({
        type: "save",
        request: {
          base: {
            boardSource: state.boardSource,
            configSource: state.configSource,
            historySource: state.historySource,
          },
          nextBoardSource,
          nextConfigSource,
          saveBoard,
          saveConfig,
        },
      });
    } catch (error) {
      failSave(error.message || String(error));
    }
  }

  function completeSave(result) {
    const pending = state.pendingSave;
    if (!pending) return;

    state.boardSource = result.boardSource;
    state.configSource = result.configSource;
    state.historySource = result.historySource;
    state.historyEvents.push(...result.events);
    if (pending.saveBoard && state.boardRevision === pending.boardRevision) state.dirtyBoard = false;
    if (pending.saveConfig && state.configRevision === pending.configRevision) state.dirtyConfig = false;
    state.pendingSave = null;
    state.saveInFlight = false;
    updateDirtyState();
    renderAnalytics();
    const savedAt = new Date();
    elements.lastLoadedLabel.textContent = `Saved ${formatTime(savedAt)}`;
    setStatus("Markdown files saved. Source control has the authoritative diff.", "online");
    if (!state.dirtyBoard && !state.dirtyConfig) {
      updateSaveState("saved", "Saved", `Last saved ${formatTime(savedAt)}`);
    }
    if (pending.manual) showToast("Markdown changes saved.", "success");
    if (state.saveQueued || state.dirtyBoard || state.dirtyConfig) scheduleAutosave();
  }

  function failSave(message) {
    state.pendingSave = null;
    state.saveInFlight = false;
    updateDirtyState();
    updateSaveState("error", "Save blocked", message || "Could not save");
    showError(new Error(message || "Could not save"));
  }

  function updateSaveState(status, label, detail) {
    const icons = { idle: "•", pending: "•", saving: "", saved: "✓", error: "!" };
    elements.saveState.dataset.state = status;
    elements.saveStateIcon.textContent = icons[status] ?? "•";
    elements.saveStateLabel.textContent = label;
    elements.saveStateDetail.textContent = detail;
  }

  function formatTime(date) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
  }

  function setStatus(message, stateName) {
    elements.statusMessage.textContent = message;
    if (stateName) {
      elements.connectionState.dataset.state = stateName;
    }
  }

  function showError(error) {
    console.warn(error);
    showToast(error.message || String(error), "error");
    setStatus(error.message || String(error), "warning");
  }

  function showToast(message, tone = "info") {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.dataset.tone = tone;
    toast.textContent = message;
    elements.toastRegion.append(toast);
    window.setTimeout(() => toast.remove(), 4600);
  }

})();