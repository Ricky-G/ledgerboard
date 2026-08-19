(function startKanbanApp() {
  "use strict";

  const model = window.LedgerBoardModel;
  const menuPosition = window.LedgerBoardMenuPosition;
  const vscode = acquireVsCodeApi();
  const standalone = vscode.mode === "standalone";
  const BOARD_FILE = "BOARD.md";
  const AUTOSAVE_DELAY_MS = 1000;
  const COLUMN_COLORS = ["#7d8890", "#2e6ea6", "#e24a35", "#a96912", "#167d74", "#7a5ca8"];

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
    duplicateSources: {},
    pendingDeletionCardId: null,
    deleteConfirmationFocusTarget: null,
    actionMenuCardId: null,
    actionMenuTrigger: null,
    currentView: "board",
    mobileColumn: "doing",
    editingCardId: null,
    draggedCardId: null,
    suppressCardClick: false,
    analytics: null,
    analyticsPendingPreset: vscode.getState()?.analytics || null,
    columnEditBaseline: null,
    pendingColumnRemoval: null,
    columnRemovalFocusTarget: null,
    pendingLabelRemovalId: null,
    labelRemovalFocusTarget: null,
  };

  const elements = collectElements();

  initialize();

  function collectElements() {
    const ids = [
      "appShell", "workspaceName", "boardTitle", "connectionState", "connectionLabel",
      "saveState", "saveStateIcon", "saveStateLabel", "saveStateDetail",
      "reloadButton", "connectButton", "saveButton", "boardView", "settingsView",
      "analyticsView", "analyticsCoverage", "analyticsTimeZone", "analyticsRangeSummary",
      "analyticsRange", "analyticsCustomRange", "analyticsStartDate", "analyticsEndDate",
      "analyticsSearch", "analyticsStatus", "analyticsPriority", "analyticsArea", "analyticsAssignee",
      "analyticsAggregation", "analyticsShowAssignees", "analyticsSavePreset", "analyticsRestorePreset",
      "analyticsExport", "analyticsForecastDate", "metricActive", "metricBlocked", "metricAging",
      "metricCompletedLabel", "metricCompletedRange", "metricNetWork", "metricRework", "metricCycle",
      "metricForecast", "metricForecastDetail", "analyticsHealthSummary", "analyticsDefinitions",
      "statusTotal", "statusChart", "priorityChart", "throughputChart", "completedWorkTotal",
      "completedWorkComparison", "entityChart", "cumulativeFlow",
      "agingWork", "workload", "timeInStatus", "qualityChecks", "insights", "forecast",
      "historyEventCount", "recentActivity", "analyticsDrilldown",
      "searchInput", "areaFilter", "assigneeFilter", "priorityFilter", "activeCount", "blockedCount",
      "doingCount", "addCardButton", "mobileColumnTabs", "boardCanvas", "welcomePanel",
      "welcomeTitle", "welcomeCopy",
      "welcomeConnectButton", "welcomeNormalizeButton", "browserNote", "kanbanBoard", "settingsSaveButton",
      "settingsContent", "configWorkspaceName", "configBoardTitle", "configTimezone",
      "configAccent", "configAccentValue", "peopleList", "addPersonButton", "entityList", "addEntityButton",
      "columnList", "addColumnButton", "discardColumnChangesButton", "columnsLimitMessage",
      "columnValidationMessage", "columnRemovalDialog", "columnRemovalMessage", "columnRemovalTargetField",
      "columnRemovalTarget", "cancelColumnRemovalButton", "confirmColumnRemovalButton",
      "labelRemovalDialog", "labelRemovalMessage", "cancelLabelRemovalButton", "confirmLabelRemovalButton",
      "statusMessage", "unsavedIndicator", "lastLoadedLabel", "cardDialog", "cardForm",
      "cardDialogEyebrow", "cardDialogTitle", "cardId", "cardTitle", "cardDescription",
      "cardArea", "cardAssignee", "cardColumn", "cardPriority", "deleteCardButton", "submitCardButton",
      "deleteConfirmationDialog", "deleteConfirmationMessage", "cancelDeleteCardButton", "confirmDeleteCardButton",
      "cardActionMenu", "cardActionMenuCardId", "cardActionMenuCardTitle", "cardActionMenuEntitySwatch",
      "cardActionMenuEntityName", "cardActionMenuAssignee", "cardActionMenuAvatar", "cardActionMenuAssigneeName",
      "duplicateCardActionButton", "deleteCardActionButton", "editCardActionButton",
      "toastRegion",
    ];
    return Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  }

  function initialize() {
    bindEvents();
    restoreAnalyticsPreset({ render: false });
    updateAnalyticsRangeVisibility();
    populateColumnSelect();
    applyConfig();
    renderSettings();
    configureHostCopy();
    window.addEventListener("message", handleExtensionMessage);
    vscode.postMessage({ type: "ready" });
  }

  function configureHostCopy() {
    if (!standalone) return;
    elements.saveStateDetail.textContent = "Choose a local board folder";
    elements.connectionLabel.textContent = "Folder not selected";
    elements.connectButton.textContent = "Open board folder";
    elements.welcomeTitle.textContent = "Open a local Markdown board.";
    elements.browserNote.textContent = "LedgerBoard reads and writes only the folder you choose. It makes no network requests.";
    elements.statusMessage.textContent = "Choose the folder containing the three LedgerBoard Markdown files.";
  }

  function bindEvents() {
    elements.connectButton.addEventListener("click", connectRepository);
    elements.welcomeConnectButton.addEventListener("click", connectRepository);
    elements.welcomeNormalizeButton.addEventListener("click", () => vscode.postMessage({ type: "normalize" }));
    elements.reloadButton.addEventListener("click", reloadRepository);
    elements.saveButton.addEventListener("click", () => persistChanges({ manual: true }));
    elements.settingsSaveButton.addEventListener("click", () => persistChanges({ manual: true }));
    elements.addCardButton.addEventListener("click", () => openCardDialog(null, firstColumnId()));
    elements.searchInput.addEventListener("input", renderBoard);
    elements.areaFilter.addEventListener("change", renderBoard);
    elements.assigneeFilter.addEventListener("change", renderBoard);
    elements.priorityFilter.addEventListener("change", renderBoard);
    [
      elements.analyticsRange,
      elements.analyticsStartDate,
      elements.analyticsEndDate,
      elements.analyticsStatus,
      elements.analyticsPriority,
      elements.analyticsArea,
      elements.analyticsAssignee,
      elements.analyticsAggregation,
      elements.analyticsShowAssignees,
      elements.analyticsForecastDate,
    ].forEach((control) => {
      control.addEventListener("change", () => {
        updateAnalyticsRangeVisibility();
        persistAnalyticsViewState();
        renderAnalytics();
      });
    });
    elements.analyticsSearch.addEventListener("input", () => {
      persistAnalyticsViewState();
      renderAnalytics();
    });
    elements.analyticsSavePreset.addEventListener("click", saveAnalyticsPreset);
    elements.analyticsRestorePreset.addEventListener("click", () => restoreAnalyticsPreset({ render: true }));
    elements.analyticsExport.addEventListener("click", exportAnalytics);
    elements.addPersonButton.addEventListener("click", addPerson);
    elements.addEntityButton.addEventListener("click", addEntity);
    elements.addColumnButton.addEventListener("click", addColumn);
    elements.discardColumnChangesButton.addEventListener("click", discardColumnChanges);
    elements.cancelColumnRemovalButton.addEventListener("click", cancelColumnRemoval);
    elements.confirmColumnRemovalButton.addEventListener("click", confirmColumnRemoval);
    elements.columnRemovalDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      cancelColumnRemoval();
    });
    elements.cancelLabelRemovalButton.addEventListener("click", cancelLabelRemoval);
    elements.confirmLabelRemovalButton.addEventListener("click", confirmLabelRemoval);
    elements.labelRemovalDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      cancelLabelRemoval();
    });

    document.querySelectorAll(".view-tab").forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.view));
    });

    elements.cardForm.addEventListener("submit", submitCard);
    elements.deleteCardButton.addEventListener("click", () => requestCardDeletion());
    elements.cancelDeleteCardButton.addEventListener("click", cancelCardDeletion);
    elements.confirmDeleteCardButton.addEventListener("click", confirmCardDeletion);
    elements.deleteConfirmationDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      cancelCardDeletion();
    });
    elements.editCardActionButton.addEventListener("click", editCardFromActionMenu);
    elements.duplicateCardActionButton.addEventListener("click", duplicateCardFromActionMenu);
    elements.deleteCardActionButton.addEventListener("click", deleteCardFromActionMenu);
    elements.cardActionMenu.addEventListener("keydown", handleCardActionMenuKeydown);
    document.addEventListener("pointerdown", dismissCardActionMenuOnOutsideClick);
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
      if (event.key === "Escape" && !elements.cardActionMenu.hidden) {
        event.preventDefault();
        closeCardActionMenu({ restoreFocus: true });
        return;
      }
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
    window.addEventListener("resize", closeCardActionMenu);
    document.addEventListener("scroll", closeCardActionMenu, true);
  }

  function populateColumnSelect() {
    elements.cardColumn.replaceChildren();
    currentColumns().forEach((column) => {
      const option = document.createElement("option");
      option.value = column.id;
      option.textContent = column.label;
      elements.cardColumn.append(option);
    });
  }

  function currentColumns() {
    if (state.board) {
      return state.board.columns.map(({ id, label }) => ({ id, label }));
    }
    return state.config.columns.map(({ id, name }) => ({ id, label: name }));
  }

  function firstColumnId() {
    return currentColumns()[0]?.id || "";
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
    const config = model.parseConfig(configSource);
    const board = model.parseBoard(boardSource);
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
    state.pendingSave = null;
    state.duplicateSources = {};
    state.columnEditBaseline = null;
    state.pendingColumnRemoval = null;
    state.pendingLabelRemovalId = null;
    state.labelRemovalFocusTarget = null;
    state.mobileColumn = board.columns.some((column) => column.id === state.mobileColumn)
      ? state.mobileColumn
      : board.columns[0].id;

    elements.welcomePanel.hidden = true;
    elements.welcomePanel.dataset.state = "ready";
    elements.welcomeTitle.textContent = standalone
      ? "Your local Markdown board."
      : "Your delivery board, directly on the repository.";
    elements.welcomeCopy.innerHTML = "Open a LedgerBoard bundle to load <strong>BOARD.md</strong>, <strong>KANBAN-CONFIG.md</strong>, and <strong>KANBAN-HISTORY.md</strong>.";
    elements.welcomeConnectButton.textContent = "Choose board folder";
    elements.welcomeNormalizeButton.hidden = true;
    elements.browserNote.textContent = standalone
      ? "Changes save directly to the selected Markdown files. LedgerBoard makes no network requests."
      : "Files stay in your workspace and remain readable without this extension.";
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
      showLoadError(message.message, message.canNormalize);
    } else if (message.type === "externalChange") {
      handleExternalChange(message.fileName);
    } else if (message.type === "openNewCard" && state.board) {
      openCardDialog(null, firstColumnId());
    }
  }

  function showLoadError(message, canNormalize = false) {
    clearAutosaveTimer();
    state.board = null;
    state.historyEvents = [];
    state.dirtyBoard = false;
    state.dirtyConfig = false;
    state.saveInFlight = false;
    state.pendingSave = null;
    state.duplicateSources = {};
    elements.kanbanBoard.replaceChildren();
    elements.mobileColumnTabs.replaceChildren();
    elements.kanbanBoard.style.removeProperty("grid-template-columns");
    elements.welcomePanel.hidden = false;
    elements.welcomePanel.dataset.state = "error";
    elements.welcomeTitle.textContent = "This board could not be loaded.";
    elements.welcomeCopy.textContent = message || "The Markdown bundle is invalid.";
    elements.welcomeConnectButton.textContent = "Choose another board";
    elements.welcomeNormalizeButton.hidden = !canNormalize;
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
    renderSettings();
    populateColumnSelect();
    populateAreaFilter();
    populateAssigneeFilter();
    populateEntityOptions();
    populatePersonOptions();
    renderBoard();
    renderAnalytics();
  }

  function renderBoard() {
    closeCardActionMenu();
    if (!state.board) {
      elements.kanbanBoard.replaceChildren();
      elements.mobileColumnTabs.replaceChildren();
      updateStats();
      return;
    }

    elements.kanbanBoard.replaceChildren();
    elements.mobileColumnTabs.replaceChildren();
    elements.kanbanBoard.style.gridTemplateColumns = `repeat(${state.board.columns.length}, minmax(var(--column-width), 1fr))`;
    const query = elements.searchInput.value.trim().toLowerCase();
    const area = elements.areaFilter.value;
    const assignee = elements.assigneeFilter.value;
    const priority = elements.priorityFilter.value;

    state.board.columns.forEach((column, columnIndex) => {
      const columnElement = document.createElement("section");
      columnElement.className = "kanban-column";
      columnElement.dataset.column = column.id;
      columnElement.style.setProperty("--column-color", columnColor(column.id, columnIndex));
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
      description.textContent = `Workflow stage ${columnIndex + 1} of ${state.board.columns.length}`;
      titleBlock.append(title, description);
      const count = document.createElement("span");
      count.className = "column-count";
      count.textContent = String(column.cards.length);
      const addButton = document.createElement("button");
      addButton.type = "button";
      addButton.className = "column-add-button";
      addButton.textContent = "+";
      addButton.title = `Add ticket to ${column.label}`;
      addButton.setAttribute("aria-label", `Add ticket to ${column.label}`);
      addButton.addEventListener("click", () => openCardDialog(null, column.id));
      header.append(index, titleBlock, count, addButton);

      const cardList = document.createElement("div");
      cardList.className = "card-list";
      cardList.dataset.column = column.id;
      bindDropZone(cardList, column);

      let visibleCount = 0;
      column.cards.forEach((card) => {
        const visible = cardMatches(card, query, area, assignee, priority);
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
        strong.textContent = "No matching tickets";
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
    const person = card.detailValues.assignee ? getPerson(card.detailValues.assignee) : null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "kanban-card";
    button.draggable = true;
    button.dataset.cardId = card.id;
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-controls", "cardActionMenu");
    button.setAttribute("aria-expanded", "false");
    button.style.setProperty("--entity-color", entity.color);
    button.setAttribute(
      "aria-label",
      `${card.id}, ${card.title}, ${entity.name}, ${person ? `assigned to ${person.name}` : "unassigned"}, ${card.priority}`,
    );

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
    if (person) {
      const assignee = document.createElement("span");
      assignee.className = "card-assignee";
      assignee.style.setProperty("--person-color", person.color);
      const avatar = document.createElement("span");
      avatar.className = "person-avatar";
      avatar.textContent = initials(person.name);
      const name = document.createElement("span");
      name.textContent = person.name;
      assignee.append(avatar, name);
      footer.append(assignee);
    }
    const customDetailCount = card.rawDetailLines.filter((line) => {
      const match = line.match(/^\s{4}- \*\*([^*]+):\*\*/);
      return match && !["description", "assignee"].includes(match[1].trim().toLowerCase());
    }).length;
    if (customDetailCount > 0) {
      const custom = document.createElement("span");
      custom.className = "card-custom-detail";
      custom.textContent = `${customDetailCount} custom`;
      custom.title = `${customDetailCount} custom detail field(s) are preserved in Markdown but not editable here.`;
      footer.append(custom);
    }
    button.append(footer);

    button.addEventListener("click", () => {
      if (!state.suppressCardClick) {
        openCardDialog(card.id, card.columnId);
      }
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (!state.suppressCardClick) {
        openCardActionMenu(card, button, { x: event.clientX, y: event.clientY });
      }
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
        event.preventDefault();
        openCardActionMenu(card, button);
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

  function openCardActionMenu(card, trigger, pointer = null) {
    closeCardActionMenu();
    state.actionMenuCardId = card.id;
    state.actionMenuTrigger = trigger;
    trigger.setAttribute("aria-expanded", "true");
    populateCardActionMenuContext(card);
    elements.cardActionMenu.hidden = false;
    positionCardActionMenu(trigger, pointer);
    elements.editCardActionButton.focus();
  }

  function closeCardActionMenu({ restoreFocus = false } = {}) {
    const trigger = state.actionMenuTrigger;
    if (trigger?.isConnected) {
      trigger.setAttribute("aria-expanded", "false");
    }
    state.actionMenuCardId = null;
    state.actionMenuTrigger = null;
    elements.cardActionMenu.hidden = true;
    if (restoreFocus && trigger?.isConnected) {
      trigger.focus();
    }
  }

  function populateCardActionMenuContext(card) {
    const entity = getEntity(card.area);
    const person = card.detailValues.assignee ? getPerson(card.detailValues.assignee) : null;
    elements.cardActionMenu.style.setProperty("--menu-entity-color", entity.color);
    elements.cardActionMenu.style.setProperty("--menu-person-color", person?.color || "");
    elements.cardActionMenu.setAttribute("aria-label", `Actions for ${card.id}: ${card.title}`);
    elements.cardActionMenuCardId.textContent = card.id;
    elements.cardActionMenuCardTitle.textContent = card.title;
    elements.cardActionMenuEntityName.textContent = entity.name;
    elements.cardActionMenuEntitySwatch.style.background = entity.color;
    elements.cardActionMenuAssignee.hidden = !person;
    if (person) {
      elements.cardActionMenuAvatar.textContent = initials(person.name);
      elements.cardActionMenuAvatar.style.background = person.color;
      elements.cardActionMenuAssigneeName.textContent = person.name;
    }
  }

  function positionCardActionMenu(trigger, pointer) {
    const menu = elements.cardActionMenu;
    const { left, top } = menuPosition.calculateContextMenuPosition({
      pointer,
      triggerBounds: trigger.getBoundingClientRect(),
      menuBounds: menu.getBoundingClientRect(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  function dismissCardActionMenuOnOutsideClick(event) {
    if (elements.cardActionMenu.hidden || !(event.target instanceof Node)) {
      return;
    }
    if (!elements.cardActionMenu.contains(event.target) && !state.actionMenuTrigger?.contains(event.target)) {
      closeCardActionMenu();
    }
  }

  function handleCardActionMenuKeydown(event) {
    const actions = [
      elements.editCardActionButton,
      elements.duplicateCardActionButton,
      elements.deleteCardActionButton,
    ];
    const current = actions.indexOf(document.activeElement);
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      actions[event.key === "Home" ? 0 : actions.length - 1].focus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const next = current === -1 ? 0 : (current + direction + actions.length) % actions.length;
      actions[next].focus();
    }
  }

  function editCardFromActionMenu() {
    const cardId = state.actionMenuCardId;
    closeCardActionMenu();
    if (cardId) {
      openCardDialog(cardId);
    }
  }

  function duplicateCardFromActionMenu() {
    const sourceCardId = state.actionMenuCardId;
    closeCardActionMenu();
    if (!sourceCardId) {
      showError(new Error("Choose a ticket to duplicate."));
      return;
    }

    try {
      const duplicate = model.duplicateCard(state.board, sourceCardId, state.historyEvents);
      state.duplicateSources[duplicate.id] = sourceCardId;
      markDirty("board");
      renderBoard();
      populateAreaFilter();
      openCardDialog(duplicate.id);
      elements.cardTitle.focus();
      elements.cardTitle.select();
      showToast(`${duplicate.id} duplicated.`, "success");
    } catch (error) {
      showError(error);
    }
  }

  function deleteCardFromActionMenu() {
    const cardId = state.actionMenuCardId;
    const trigger = state.actionMenuTrigger;
    closeCardActionMenu();
    requestCardDeletion(cardId, trigger);
  }

  function createEmptyColumn(column) {
    const empty = document.createElement("div");
    empty.className = "empty-column";
    const copy = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = `${column.label} is clear`;
    copy.append(strong, document.createTextNode("Add a ticket or move one here."));
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

  function cardMatches(card, query, area, assignee, priority) {
    if (area && card.area !== area) {
      return false;
    }
    if (assignee === "__unassigned__" && card.detailValues.assignee) {
      return false;
    }
    if (assignee && assignee !== "__unassigned__" && card.detailValues.assignee !== assignee) {
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
      card.detailValues.assignee ? getPerson(card.detailValues.assignee).name : "",
      ...Object.values(card.detailValues),
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  }

  function updateStats() {
    if (!state.board) {
      elements.activeCount.textContent = "0";
      elements.blockedCount.textContent = "0";
      elements.doingCount.textContent = "0";
      return;
    }
    const active = state.board.columns
      .filter((column) => column.id !== "done")
      .reduce((sum, column) => sum + column.cards.length, 0);
    const blocked = state.board.columns.find((column) => column.id === "blocked")?.cards.length || 0;
    const doing = state.board.columns.find((column) => column.id === "doing")?.cards.length || 0;
    elements.activeCount.textContent = String(active);
    elements.blockedCount.textContent = String(blocked);
    elements.doingCount.textContent = String(doing);
  }

  function columnColor(columnId, index) {
    if (columnId === "doing") return state.config.appearance.accent;
    return COLUMN_COLORS[index % COLUMN_COLORS.length];
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
    all.textContent = "All labels";
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

  function populateAssigneeFilter() {
    const selected = elements.assigneeFilter.value;
    const assignees = new Set(state.config.people.map((person) => person.id));
    if (state.board) {
      state.board.columns.flatMap((column) => column.cards).forEach((card) => {
        if (card.detailValues.assignee) assignees.add(card.detailValues.assignee);
      });
    }
    elements.assigneeFilter.replaceChildren();
    const anyone = document.createElement("option");
    anyone.value = "";
    anyone.textContent = "Anyone";
    const unassigned = document.createElement("option");
    unassigned.value = "__unassigned__";
    unassigned.textContent = "Unassigned";
    elements.assigneeFilter.append(anyone, unassigned);
    [...assignees]
      .sort((left, right) => getPerson(left).name.localeCompare(getPerson(right).name))
      .forEach((personId) => {
        const option = document.createElement("option");
        option.value = personId;
        option.textContent = getPerson(personId).name;
        elements.assigneeFilter.append(option);
      });
    elements.assigneeFilter.value = selected === "__unassigned__" || assignees.has(selected) ? selected : "";
  }

  function populatePersonOptions() {
    const selected = elements.cardAssignee.value;
    elements.cardAssignee.replaceChildren();
    const unassigned = document.createElement("option");
    unassigned.value = "";
    unassigned.textContent = "Unassigned";
    elements.cardAssignee.append(unassigned);
    state.config.people.forEach((person) => {
      const option = document.createElement("option");
      option.value = person.id;
      option.textContent = person.name;
      elements.cardAssignee.append(option);
    });
    if (selected && !state.config.people.some((person) => person.id === selected)) {
      const option = document.createElement("option");
      option.value = selected;
      option.textContent = `${humanizeArea(selected)} (not configured)`;
      elements.cardAssignee.append(option);
    }
    elements.cardAssignee.value = selected;
  }

  function getEntity(area) {
    return state.config.entities.find((entity) => entity.id === area) || {
      id: area,
      name: humanizeArea(area),
      color: "#7d8890",
    };
  }

  function getPerson(personId) {
    return state.config.people.find((person) => person.id === personId) || {
      id: personId,
      name: humanizeArea(personId),
      color: "#617078",
    };
  }

  function initials(name) {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?";
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
    state.pendingDeletionCardId = null;
    state.deleteConfirmationFocusTarget = null;

    elements.cardId.value = card?.id || "";
    elements.cardTitle.value = card?.title || "";
    elements.cardDescription.value = card?.detailValues.description || "";
    elements.cardArea.value = card?.area || state.config.entities[0]?.id || "meta";
    elements.cardAssignee.value = card?.detailValues.assignee || "";
    elements.cardColumn.value = card?.columnId || defaultColumn || firstColumnId();
    elements.cardPriority.value = card?.priority || "P2";
    elements.cardDialogEyebrow.textContent = card ? card.id : "New ticket";
    elements.cardDialogTitle.textContent = card ? "Edit ticket" : "Add a ticket";
    elements.submitCardButton.textContent = card ? "Apply changes" : "Add ticket";
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
      showToast(state.editingCardId ? "Ticket updated." : "Ticket added.", "success");
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
        assignee: elements.cardAssignee.value,
      },
    };
  }

  function validateCardForm(values) {
    if (!values.title) {
      throw new Error("Ticket title is required.");
    }
    if (!state.config.entities.some((entity) => entity.id === values.area)) {
      throw new Error("Choose a label from the saved label list.");
    }
    if (values.detailValues.assignee
      && !state.config.people.some((person) => person.id === values.detailValues.assignee)) {
      throw new Error("Choose an assignee from the saved people list.");
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

  function requestCardDeletion(cardId = state.editingCardId, focusTarget = elements.deleteCardButton) {
    const found = cardId ? model.findCard(state.board, cardId) : null;
    if (!found) {
      showError(new Error("Could not find the selected ticket. Reload the board and try again."));
      return;
    }
    state.pendingDeletionCardId = found.card.id;
    state.deleteConfirmationFocusTarget = focusTarget;
    elements.deleteConfirmationMessage.textContent = `Delete ${found.card.id}: ${found.card.title}? This cannot be undone.`;
    elements.deleteConfirmationDialog.showModal();
  }

  function cancelCardDeletion() {
    const focusTarget = state.deleteConfirmationFocusTarget;
    state.pendingDeletionCardId = null;
    state.deleteConfirmationFocusTarget = null;
    if (elements.deleteConfirmationDialog.open) {
      elements.deleteConfirmationDialog.close();
    }
    if (focusTarget?.isConnected) {
      focusTarget.focus();
    }
  }

  function confirmCardDeletion() {
    const cardId = state.pendingDeletionCardId;
    if (!cardId) {
      showError(new Error("Choose a ticket to delete."));
      return;
    }
    const found = model.findCard(state.board, cardId);
    if (!found) {
      state.pendingDeletionCardId = null;
      elements.deleteConfirmationDialog.close();
      showError(new Error(`Could not find ${cardId}. Reload the board and try again.`));
      return;
    }
    const { id: columnId } = found.column;
    const cardIndex = found.cardIndex;
    rebaseDuplicateSources(found.card.id);
    found.column.cards.splice(found.cardIndex, 1);
    state.pendingDeletionCardId = null;
    state.deleteConfirmationFocusTarget = null;
    elements.deleteConfirmationDialog.close();
    markDirty("board");
    renderBoard();
    if (elements.cardDialog.open) {
      elements.cardDialog.close();
    }
    state.editingCardId = null;
    focusCardAfterDeletion(columnId, cardIndex);
    showToast(`${found.card.id} deleted.`, "success");
  }

  function rebaseDuplicateSources(cardId) {
    const sourceCardId = state.duplicateSources[cardId];
    delete state.duplicateSources[cardId];
    if (!sourceCardId) {
      return;
    }
    Object.entries(state.duplicateSources).forEach(([duplicateId, duplicateSourceId]) => {
      if (duplicateSourceId === cardId) {
        state.duplicateSources[duplicateId] = sourceCardId;
      }
    });
  }

  function focusCardAfterDeletion(columnId, cardIndex) {
    const cards = [...document.querySelectorAll(`.card-list[data-column="${columnId}"] .kanban-card`)];
    const nextCard = cards[Math.min(cardIndex, cards.length - 1)];
    if (nextCard) {
      nextCard.focus();
      return;
    }
    document.querySelector(`.kanban-column[data-column="${columnId}"] .column-add-button`)?.focus();
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

    elements.peopleList.replaceChildren();
    config.people.forEach((person, index) => {
      elements.peopleList.append(createDirectoryRow(person, index, "person"));
    });
    elements.entityList.replaceChildren();
    config.entities.forEach((entity, index) => {
      elements.entityList.append(createDirectoryRow(entity, index, "entity"));
    });
    renderColumns();
  }

  function renderColumns() {
    const columns = state.config.columns;
    const atLimit = columns.length >= model.MAX_COLUMNS;
    elements.addColumnButton.disabled = atLimit;
    elements.columnsLimitMessage.hidden = !atLimit;
    elements.columnsLimitMessage.textContent = atLimit
      ? `A board can have a maximum of ${model.MAX_COLUMNS} columns.`
      : "";
    elements.discardColumnChangesButton.disabled = !state.columnEditBaseline;
    elements.columnList.replaceChildren();
    columns.forEach((column, index) => {
      elements.columnList.append(createColumnRow(column, index));
    });
  }

  function createColumnRow(column, index) {
    const row = document.createElement("div");
    row.className = "column-row";

    const order = document.createElement("div");
    order.className = "column-order-actions";
    const moveEarlier = document.createElement("button");
    moveEarlier.type = "button";
    moveEarlier.className = "column-order-button";
    moveEarlier.textContent = "↑";
    moveEarlier.title = `Move ${column.name} earlier`;
    moveEarlier.setAttribute("aria-label", `Move ${column.name} earlier`);
    moveEarlier.disabled = index === 0;
    moveEarlier.addEventListener("click", () => moveColumn(index, -1));
    const moveLater = document.createElement("button");
    moveLater.type = "button";
    moveLater.className = "column-order-button";
    moveLater.textContent = "↓";
    moveLater.title = `Move ${column.name} later`;
    moveLater.setAttribute("aria-label", `Move ${column.name} later`);
    moveLater.disabled = index === state.config.columns.length - 1;
    moveLater.addEventListener("click", () => moveColumn(index, 1));
    order.append(moveEarlier, moveLater);

    const name = document.createElement("input");
    name.type = "text";
    name.className = "column-name-input";
    name.value = column.name;
    name.maxLength = model.MAX_COLUMN_NAME_LENGTH;
    name.setAttribute("aria-label", `Column ${index + 1} name`);
    name.addEventListener("input", () => validateColumnNameInput(name, index));
    name.addEventListener("change", () => changeColumnName(column, index, name));
    name.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        name.value = column.name;
        clearColumnValidation();
        name.blur();
      }
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-column-button";
    remove.textContent = "×";
    remove.title = `Remove ${column.name}`;
    remove.setAttribute("aria-label", `Remove ${column.name}`);
    remove.disabled = state.config.columns.length <= model.MIN_COLUMNS;
    remove.addEventListener("click", () => requestColumnRemoval(index, remove));

    row.append(order, name, remove);
    return row;
  }

  function validateColumnNameInput(input, index) {
    const candidate = {
      ...state.config,
      columns: state.config.columns.map((column, columnIndex) => (
        columnIndex === index ? { ...column, name: input.value } : column
      )),
    };
    try {
      model.validateConfig(candidate);
      input.setAttribute("aria-invalid", "false");
      clearColumnValidation();
      return true;
    } catch (error) {
      input.setAttribute("aria-invalid", "true");
      showColumnValidation(error.message || String(error));
      return false;
    }
  }

  function changeColumnName(column, index, input) {
    if (!validateColumnNameInput(input, index)) {
      return;
    }
    const next = input.value.trim();
    if (next === column.name) {
      input.value = column.name;
      return;
    }
    beginColumnEdit();
    column.name = next;
    applyColumnChanges();
  }

  function moveColumn(index, direction) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= state.config.columns.length) {
      return;
    }
    beginColumnEdit();
    const [column] = state.config.columns.splice(index, 1);
    state.config.columns.splice(targetIndex, 0, column);
    applyColumnChanges();
    elements.columnList.children[targetIndex]?.querySelector(".column-order-button")?.focus();
  }

  function nextAvailableColumnName() {
    const names = new Set(state.config.columns.map((column) => column.name.toLocaleLowerCase()));
    let suffix = 1;
    let candidate = "New column";
    while (names.has(candidate.toLocaleLowerCase())) {
      suffix += 1;
      candidate = `New column ${suffix}`;
    }
    return candidate;
  }

  function addColumn() {
    if (state.config.columns.length >= model.MAX_COLUMNS) {
      showColumnValidation(`A board can have a maximum of ${model.MAX_COLUMNS} columns.`);
      return;
    }
    beginColumnEdit();
    let suffix = state.config.columns.length + 1;
    while (state.config.columns.some((column) => column.id === `column-${suffix}`)) {
      suffix += 1;
    }
    state.config.columns.push({ id: `column-${suffix}`, name: nextAvailableColumnName() });
    applyColumnChanges();
    elements.columnList.lastElementChild?.querySelector(".column-name-input")?.select();
  }

  function requestColumnRemoval(index, focusTarget) {
    if (state.config.columns.length <= model.MIN_COLUMNS) {
      showColumnValidation(`A board must have at least ${model.MIN_COLUMNS} column.`);
      return;
    }
    const column = state.config.columns[index];
    const current = state.board?.columns.find((item) => item.id === column.id);
    const cardCount = current?.cards.length || 0;
    state.pendingColumnRemoval = { id: column.id, index };
    state.columnRemovalFocusTarget = focusTarget;
    elements.columnRemovalMessage.textContent = cardCount > 0
      ? `${column.name} contains ${cardCount} ticket(s). Choose a destination before removing it.`
      : `Remove the empty ${column.name} column?`;
    elements.columnRemovalTargetField.hidden = cardCount === 0;
    elements.columnRemovalTarget.replaceChildren();
    state.config.columns
      .filter((item) => item.id !== column.id)
      .forEach((item) => {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.name;
        elements.columnRemovalTarget.append(option);
      });
    elements.columnRemovalDialog.showModal();
  }

  function cancelColumnRemoval() {
    const focusTarget = state.columnRemovalFocusTarget;
    state.pendingColumnRemoval = null;
    state.columnRemovalFocusTarget = null;
    if (elements.columnRemovalDialog.open) {
      elements.columnRemovalDialog.close();
    }
    if (focusTarget?.isConnected) {
      focusTarget.focus();
    }
  }

  function confirmColumnRemoval() {
    const pending = state.pendingColumnRemoval;
    if (!pending) {
      showColumnValidation("Choose a column to remove.");
      return;
    }
    const current = state.board?.columns.find((column) => column.id === pending.id);
    const targetId = elements.columnRemovalTarget.value;
    if (current?.cards.length > 0 && !targetId) {
      showColumnValidation("Choose a destination for the tickets in this column.");
      return;
    }

    beginColumnEdit();
    current?.cards.slice().forEach((card) => {
      model.moveCard(state.board, card.id, targetId);
    });
    state.config.columns = state.config.columns.filter((column) => column.id !== pending.id);
    state.pendingColumnRemoval = null;
    state.columnRemovalFocusTarget = null;
    elements.columnRemovalDialog.close();
    applyColumnChanges();
  }

  function beginColumnEdit() {
    if (state.columnEditBaseline) {
      return;
    }
    clearAutosaveTimer();
    state.columnEditBaseline = {
      columns: structuredClone(state.config.columns),
      board: structuredClone(state.board),
      dirtyBoard: state.dirtyBoard,
      dirtyConfig: state.dirtyConfig,
      boardRevision: state.boardRevision,
      configRevision: state.configRevision,
    };
  }

  function applyColumnChanges() {
    try {
      state.board = model.reconfigureColumns(state.board, state.config.columns);
      if (!state.board.columns.some((column) => column.id === state.mobileColumn)) {
        state.mobileColumn = state.board.columns[0].id;
      }
      clearColumnValidation();
      markDirty("board", { autosave: false });
      markDirty("config", { autosave: false });
      renderAll();
    } catch (error) {
      showColumnValidation(error.message || String(error));
    }
  }

  function discardColumnChanges() {
    const baseline = state.columnEditBaseline;
    if (!baseline) {
      return;
    }
    clearAutosaveTimer();
    state.config.columns = baseline.columns;
    state.board = baseline.board;
    state.dirtyBoard = baseline.dirtyBoard;
    state.dirtyConfig = baseline.dirtyConfig;
    state.boardRevision = baseline.boardRevision;
    state.configRevision = baseline.configRevision;
    state.columnEditBaseline = null;
    state.mobileColumn = state.board.columns.some((column) => column.id === state.mobileColumn)
      ? state.mobileColumn
      : state.board.columns[0].id;
    clearColumnValidation();
    renderAll();
    updateDirtyState();
    if (!state.dirtyBoard && !state.dirtyConfig) {
      updateSaveState("saved", "Up to date", "Column changes discarded");
    }
  }

  function showColumnValidation(message) {
    elements.columnValidationMessage.textContent = message;
    elements.columnValidationMessage.hidden = false;
  }

  function clearColumnValidation() {
    elements.columnValidationMessage.textContent = "";
    elements.columnValidationMessage.hidden = true;
  }

  function createDirectoryRow(item, index, type) {
    const isPerson = type === "person";
    const row = document.createElement("div");
    row.className = `${type}-row`;
    const color = document.createElement("input");
    color.type = "color";
    color.value = item.color;
    color.title = `${item.name} color`;
    color.setAttribute("aria-label", `${item.name} color`);
    const updateColor = () => {
      if (item.color === color.value) {
        return;
      }
      item.color = color.value;
      markDirty("config");
      renderBoard();
      renderAnalytics();
    };
    color.addEventListener("input", updateColor);
    color.addEventListener("change", updateColor);

    const name = document.createElement("input");
    name.type = "text";
    name.value = item.name;
    name.maxLength = 80;
    name.setAttribute("aria-label", isPerson ? "Person name" : "Label name");
    name.addEventListener("input", (event) => {
      item.name = event.target.value;
      markDirty("config");
      if (isPerson) {
        populateAssigneeFilter();
        populatePersonOptions();
      } else {
        populateAreaFilter();
        populateEntityOptions();
      }
      renderBoard();
    });

    const id = document.createElement("input");
    id.type = "text";
    id.value = item.id;
    id.maxLength = 50;
    id.pattern = "[a-z0-9][a-z0-9\\-]*";
    id.className = `${type}-id-input`;
    id.setAttribute("aria-label", isPerson ? "Person ID" : "Label ID");
    id.addEventListener("change", (event) => {
      if (isPerson) {
        changePersonId(item, event.target);
      } else {
        changeEntityId(item, event.target);
      }
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = `remove-${type}-button`;
    remove.textContent = "×";
    remove.title = `Remove ${item.name}`;
    remove.setAttribute("aria-label", `Remove ${item.name}`);
    remove.addEventListener("click", () => {
      if (isPerson) {
        removePerson(index);
      } else {
        requestLabelRemoval(item.id, remove);
      }
    });

    row.append(color, name, id, remove);
    return row;
  }

  function changePersonId(person, input) {
    const previous = person.id;
    const next = input.value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(next)) {
      input.value = previous;
      showError(new Error("Person IDs use lowercase letters, numbers, and hyphens."));
      return;
    }
    if (state.config.people.some((item) => item !== person && item.id === next)) {
      input.value = previous;
      showError(new Error(`The person ID ${next} already exists.`));
      return;
    }
    person.id = next;
    let updatedCards = 0;
    if (state.board) {
      state.board.columns.flatMap((column) => column.cards).forEach((card) => {
        if (card.detailValues.assignee === previous) {
          card.detailValues.assignee = next;
          updatedCards += 1;
        }
      });
    }
    markDirty("config");
    if (updatedCards > 0) markDirty("board");
    populateAssigneeFilter();
    populatePersonOptions();
    renderBoard();
  }

  function addPerson() {
    let suffix = state.config.people.length + 1;
    while (state.config.people.some((person) => person.id === `person-${suffix}`)) {
      suffix += 1;
    }
    state.config.people.push({
      id: `person-${suffix}`,
      name: "New person",
      color: "#7257b5",
    });
    markDirty("config");
    renderSettings();
    populateAssigneeFilter();
    populatePersonOptions();
    const lastRow = elements.peopleList.lastElementChild;
    lastRow?.querySelector("input[type='text']")?.select();
  }

  function removePerson(index) {
    const person = state.config.people[index];
    const usage = state.board
      ? state.board.columns.flatMap((column) => column.cards)
        .filter((card) => card.detailValues.assignee === person.id)
      : [];
    if (usage.length > 0) {
      showError(new Error(`${person.name} is assigned to ${usage.length} ticket(s). Reassign them before removing this person.`));
      return;
    }
    if (!window.confirm(`Remove ${person.name} from the people list?`)) {
      return;
    }
    state.config.people.splice(index, 1);
    markDirty("config");
    renderSettings();
    populateAssigneeFilter();
    populatePersonOptions();
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
    while (state.config.entities.some((entity) => entity.id === `label-${suffix}`)) {
      suffix += 1;
    }
    state.config.entities.push({
      id: `label-${suffix}`,
      name: "New label",
      color: "#2e6ea6",
    });
    markDirty("config");
    renderSettings();
    populateAreaFilter();
    populateEntityOptions();
    const lastRow = elements.entityList.lastElementChild;
    lastRow?.querySelector("input[type='text']")?.select();
  }

  function requestLabelRemoval(id, focusTarget) {
    const entity = state.config.entities.find((item) => item.id === id);
    if (!entity) {
      showError(new Error("Could not find the selected label. Reload the board and try again."));
      return;
    }
    const usage = state.board
      ? state.board.columns.flatMap((column) => column.cards).filter((card) => card.area === entity.id)
      : [];
    if (usage.length > 0) {
      showError(new Error(`${entity.name} is assigned to ${usage.length} ticket(s). Reassign them before removing it.`));
      return;
    }
    state.pendingLabelRemovalId = entity.id;
    state.labelRemovalFocusTarget = focusTarget;
    elements.labelRemovalMessage.textContent = `Remove ${entity.name} from the label palette? This does not change any tickets.`;
    elements.labelRemovalDialog.showModal();
  }

  function cancelLabelRemoval() {
    const focusTarget = state.labelRemovalFocusTarget;
    state.pendingLabelRemovalId = null;
    state.labelRemovalFocusTarget = null;
    if (elements.labelRemovalDialog.open) {
      elements.labelRemovalDialog.close();
    }
    if (focusTarget?.isConnected) {
      focusTarget.focus();
    }
  }

  function confirmLabelRemoval() {
    const id = state.pendingLabelRemovalId;
    const entity = state.config.entities.find((item) => item.id === id);
    if (!entity) {
      cancelLabelRemoval();
      showError(new Error("Could not find the selected label. Reload the board and try again."));
      return;
    }
    const usage = state.board
      ? state.board.columns.flatMap((column) => column.cards).filter((card) => card.area === entity.id)
      : [];
    if (usage.length > 0) {
      cancelLabelRemoval();
      showError(new Error(`${entity.name} is assigned to ${usage.length} ticket(s). Reassign them before removing it.`));
      return;
    }
    const index = state.config.entities.indexOf(entity);
    state.config.entities.splice(index, 1);
    if (elements.cardArea.value === entity.id) {
      elements.cardArea.value = "";
    }
    state.pendingLabelRemovalId = null;
    state.labelRemovalFocusTarget = null;
    elements.labelRemovalDialog.close();
    markDirty("config");
    renderSettings();
    populateAreaFilter();
    populateEntityOptions();
    renderBoard();
    renderAnalytics();
    const nextRemoveButton = elements.entityList.children[
      Math.min(index, elements.entityList.children.length - 1)
    ]?.querySelector(".remove-entity-button");
    (nextRemoveButton || elements.addEntityButton).focus();
    showToast(`${entity.name} removed from the label palette.`, "success");
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

    syncAnalyticsFilterOptions();
    const analytics = model.buildAnalytics(state.board, analyticsHistoryEvents(), analyticsOptions());
    state.analytics = analytics;
    elements.metricActive.textContent = String(analytics.active);
    elements.metricBlocked.textContent = String(analytics.blocked);
    elements.metricAging.textContent = String(analytics.aging.stale.length);
    elements.metricCompletedLabel.textContent = `${analytics.metadata.range.days} days, ${analytics.metadata.timeZone}`;
    elements.metricCompletedRange.textContent = String(analytics.completedInRange);
    elements.metricNetWork.textContent = formatSignedNumber(analytics.comparison.netWorkChange);
    elements.metricRework.textContent = String(analytics.reworkCount);
    elements.metricCycle.textContent = analytics.medianCycleDays === null
      ? "Unavailable"
      : `${analytics.medianCycleDays}d`;
    elements.metricForecast.textContent = formatForecastRange(analytics.forecast);
    elements.metricForecastDetail.textContent = analytics.forecast.available
      ? "Historical throughput range"
      : "Needs more recorded history";
    elements.statusTotal.textContent = `${analytics.wip.total} WIP tickets`;
    elements.completedWorkTotal.textContent = `${analytics.completedWork.total} completed`;
    const completionChange = analytics.completedWork.comparison.change;
    elements.completedWorkComparison.textContent = `${completionChange === 0
      ? "Matches"
      : `${Math.abs(completionChange)} ${completionChange > 0 ? "more" : "fewer"} than`} the preceding equivalent period. Grouped by ${elements.analyticsAggregation.value}.`;
    elements.historyEventCount.textContent = `${analytics.historyEvents} events`;
    elements.analyticsTimeZone.textContent = analytics.metadata.timeZone;
    elements.analyticsRangeSummary.textContent = `${formatShortDateKey(analytics.metadata.range.start)} to ${formatShortDateKey(analytics.metadata.range.end)}`;
    elements.analyticsCoverage.textContent = analytics.historySince
      ? `History tracked from ${formatShortDate(analytics.historySince)}. ${analytics.metadata.historyCoverage}`
      : analytics.metadata.historyCoverage;

    renderStatusChart(analytics);
    renderPriorityChart(analytics);
    renderCompletedWorkChart(analytics);
    renderEntityChart(analytics);
    renderCumulativeFlow(analytics);
    renderAgingWork(analytics);
    renderWorkload(analytics);
    renderTimeInStatus(analytics);
    renderQualityChecks(analytics);
    renderInsights(analytics);
    renderForecast(analytics);
    renderRecentActivity(analytics);
    renderAnalyticsContext(analytics);
  }

  function analyticsOptions() {
    const customRange = elements.analyticsRange.value === "custom";
    const selected = (element) => element.value ? [element.value] : [];
    return {
      days: customRange ? undefined : Number.parseInt(elements.analyticsRange.value, 10) || 30,
      startDate: customRange ? elements.analyticsStartDate.value : undefined,
      endDate: customRange ? elements.analyticsEndDate.value : undefined,
      timeZone: state.config.workspace.timezone,
      aggregation: elements.analyticsAggregation.value,
      forecastDate: elements.analyticsForecastDate.value,
      filters: {
        statuses: selected(elements.analyticsStatus),
        priorities: selected(elements.analyticsPriority),
        areas: selected(elements.analyticsArea),
        assignees: selected(elements.analyticsAssignee),
        search: elements.analyticsSearch.value,
      },
    };
  }

  function analyticsHistoryEvents() {
    if (!state.dirtyBoard) {
      return state.historyEvents;
    }

    const persistedBoard = model.parseBoard(state.boardSource);
    const pendingEvents = model.diffBoardEvents(
      persistedBoard,
      state.board,
      new Date().toISOString(),
      state.duplicateSources,
    );
    return [...state.historyEvents, ...pendingEvents];
  }

  function syncAnalyticsFilterOptions() {
    const cards = state.board.columns.flatMap((column) => column.cards);
    const statuses = state.board.columns.map((column) => ({ value: column.id, label: column.label }));
    const entities = state.config.entities
      .map((entity) => ({ value: entity.id, label: entity.name }))
      .sort((left, right) => left.label.localeCompare(right.label));
    const people = state.config.people
      .map((person) => ({ value: person.id, label: person.name }))
      .sort((left, right) => left.label.localeCompare(right.label));
    const assigned = new Set(cards.map((card) => card.detailValues.assignee).filter(Boolean));
    populateAnalyticsSelect(elements.analyticsStatus, "All statuses", statuses);
    populateAnalyticsSelect(elements.analyticsArea, "All labels", entities);
    populateAnalyticsSelect(elements.analyticsAssignee, "All assignees", [
      { value: "unassigned", label: "Unassigned" },
      ...people.filter((person) => assigned.has(person.value)),
    ]);
    if (state.analyticsPendingPreset) {
      elements.analyticsArea.value = state.analyticsPendingPreset.area || "";
      elements.analyticsAssignee.value = state.analyticsPendingPreset.assignee || "";
      state.analyticsPendingPreset = null;
    }
  }

  function populateAnalyticsSelect(select, allLabel, options) {
    const selected = select.value;
    const values = options.map((option) => option.value);
    select.replaceChildren();
    const all = document.createElement("option");
    all.value = "";
    all.textContent = allLabel;
    select.append(all);
    options.forEach((option) => {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      select.append(element);
    });
    select.value = values.includes(selected) ? selected : "";
  }

  function updateAnalyticsRangeVisibility() {
    const customRange = elements.analyticsRange.value === "custom";
    elements.analyticsCustomRange.hidden = !customRange;
    if (customRange && !elements.analyticsEndDate.value) {
      const end = new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - 29);
      elements.analyticsStartDate.value = localDateInputValue(start);
      elements.analyticsEndDate.value = localDateInputValue(end);
    }
  }

  function localDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function persistAnalyticsViewState() {
    const current = vscode.getState() || {};
    vscode.setState({
      ...current,
      analytics: {
        range: elements.analyticsRange.value,
        startDate: elements.analyticsStartDate.value,
        endDate: elements.analyticsEndDate.value,
        search: elements.analyticsSearch.value,
        status: elements.analyticsStatus.value,
        priority: elements.analyticsPriority.value,
        area: elements.analyticsArea.value,
        assignee: elements.analyticsAssignee.value,
        aggregation: elements.analyticsAggregation.value,
        showAssignees: elements.analyticsShowAssignees.checked,
        forecastDate: elements.analyticsForecastDate.value,
      },
    });
  }

  function restoreAnalyticsPreset({ render }) {
    const saved = vscode.getState()?.analytics;
    if (!saved) {
      if (render) showToast("No locally saved analytics filters yet.", "info");
      return;
    }
    elements.analyticsRange.value = saved.range || "30";
    elements.analyticsStartDate.value = saved.startDate || "";
    elements.analyticsEndDate.value = saved.endDate || "";
    elements.analyticsSearch.value = saved.search || "";
    elements.analyticsStatus.value = saved.status || "";
    elements.analyticsPriority.value = saved.priority || "";
    elements.analyticsArea.value = saved.area || "";
    elements.analyticsAssignee.value = saved.assignee || "";
    elements.analyticsAggregation.value = saved.aggregation || "day";
    elements.analyticsShowAssignees.checked = Boolean(saved.showAssignees);
    elements.analyticsForecastDate.value = saved.forecastDate || "";
    state.analyticsPendingPreset = saved;
    updateAnalyticsRangeVisibility();
    if (render) {
      renderAnalytics();
      showToast("Restored locally saved analytics filters.", "success");
    }
  }

  function saveAnalyticsPreset() {
    persistAnalyticsViewState();
    showToast("Saved analytics filters locally in this webview.", "success");
  }

  function exportAnalytics() {
    if (!state.board) return;
    renderAnalytics();
    const analytics = state.analytics;
    const includeAssignees = elements.analyticsShowAssignees.checked;
    const exportData = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      board: state.rootName,
      filters: exportAnalyticsMetadata(analytics.metadata, includeAssignees),
      definitions: analytics.definitions,
      boardHealth: {
        total: analytics.total,
        active: analytics.active,
        done: analytics.done,
        blocked: analytics.blocked,
        completionRate: analytics.completionRate,
        completedInRange: analytics.completedInRange,
        createdInRange: analytics.createdInRange,
        netWorkChange: analytics.comparison.netWorkChange,
        reopenedInRange: analytics.reworkCount,
      },
      distribution: {
        status: analytics.status,
        priority: analytics.priority,
        labels: analytics.labels,
        entities: analytics.labels,
      },
      throughput: exportThroughput(analytics.throughput),
      cumulativeFlow: analytics.cumulativeFlow,
      leadTime: analytics.leadTime,
      cycleTime: analytics.cycleTime,
      timeInStatus: analytics.timeInStatus,
      quality: analytics.quality.summary,
      workload: exportWorkload(analytics.workload, includeAssignees),
      forecast: analytics.forecast,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ledgerboard-analytics.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast("Downloaded filtered aggregate analytics. No board data was sent anywhere.", "success");
  }

  function exportWorkload(workload, includeAssignees) {
    if (includeAssignees) {
      return workload.map(({ assignee, active, blocked, completed }) => ({ assignee, active, blocked, completed }));
    }
    return aggregateHiddenWorkload(workload).map(({ assignee, active, blocked, completed }) => ({
      assignee,
      active,
      blocked,
      completed,
    }));
  }

  function exportAnalyticsMetadata(metadata, includeAssignees) {
    return {
      ...metadata,
      filters: {
        ...metadata.filters,
        assignees: includeAssignees
          ? metadata.filters.assignees
          : metadata.filters.assignees.map((assignee) => assignee === "unassigned" ? "unassigned" : "assigned"),
      },
    };
  }

  function exportThroughput(throughput) {
    return throughput.map((bucket) => ({
      key: bucket.key,
      activity: bucket.activity,
      created: bucket.created,
      completed: bucket.completed,
      reopened: bucket.reopened,
    }));
  }

  function renderAnalyticsContext(analytics) {
    const comparison = analytics.comparison;
    const direction = comparison.completionChange === 0
      ? "matched"
      : comparison.completionChange > 0 ? "increased by" : "decreased by";
    elements.analyticsHealthSummary.textContent = `${analytics.active} open, ${analytics.blocked} blocked, and `
      + `${analytics.completedInRange} recorded completions. Completion throughput ${direction} `
      + `${Math.abs(comparison.completionChange)} compared with the preceding equivalent period.`;
    elements.analyticsDefinitions.replaceChildren();
    Object.entries(analytics.definitions).forEach(([name, definition]) => {
      const item = document.createElement("p");
      const label = document.createElement("strong");
      label.textContent = `${titleCase(name)}: `;
      item.append(label, document.createTextNode(definition));
      elements.analyticsDefinitions.append(item);
    });
  }

  function renderStatusChart(analytics) {
    elements.statusChart.replaceChildren();
    const wip = analytics.wip;
    if (wip.total === 0) {
      elements.statusChart.append(createAnalyticsEmpty("No work in progress matches this filter."));
      return;
    }
    const track = document.createElement("div");
    track.className = "status-track";
    wip.columns.forEach((column, index) => {
      const count = wip.status[column.id];
      if (count === 0) return;
      const segment = createAnalyticsAction(
        `${column.label}: ${count} tickets`,
        "status-segment",
        wip.cards.filter((card) => card.columnId === column.id).map((card) => card.id),
      );
      segment.className = "status-segment";
      segment.dataset.status = column.id;
      segment.style.setProperty("--status-color", columnColor(column.id, index));
      segment.style.flexBasis = `${(count / Math.max(1, wip.total)) * 100}%`;
      segment.textContent = count;
      track.append(segment);
    });

    const legend = document.createElement("div");
    legend.className = "status-legend";
    wip.columns.forEach((column, index) => {
      const item = createAnalyticsAction(
        `${column.label}: ${wip.status[column.id]} tickets`,
        "status-legend-item",
        wip.cards.filter((card) => card.columnId === column.id).map((card) => card.id),
      );
      item.className = "status-legend-item";
      item.style.setProperty("--legend-color", columnColor(column.id, index));
      const swatch = document.createElement("i");
      const label = document.createElement("span");
      label.textContent = column.label;
      const count = document.createElement("strong");
      count.textContent = String(wip.status[column.id]);
      item.append(swatch, label, count);
      legend.append(item);
    });
    elements.statusChart.append(track, legend);
  }

  function renderPriorityChart(analytics) {
    elements.priorityChart.replaceChildren();
    const wip = analytics.wip;
    if (wip.total === 0) {
      elements.priorityChart.append(createAnalyticsEmpty("No work in progress matches this filter."));
      return;
    }
    const colors = { P1: "#b52f42", P2: "#c65d18", P3: "#2e6ea6", P4: "#617078" };
    const maximum = Math.max(1, ...Object.values(wip.priority));
    Object.entries(wip.priority).forEach(([priority, count]) => {
      elements.priorityChart.append(createAnalyticsBar(
        priority,
        count,
        maximum,
        colors[priority],
        wip.cards.filter((card) => card.priority === priority).map((card) => card.id),
      ));
    });
  }

  function renderEntityChart(analytics) {
    elements.entityChart.replaceChildren();
    const wip = analytics.wip;
    const entries = Object.entries(wip.labels)
      .sort((left, right) => right[1] - left[1] || getEntity(left[0]).name.localeCompare(getEntity(right[0]).name));
    if (entries.length === 0) {
      elements.entityChart.append(createAnalyticsEmpty("No active label work."));
      return;
    }
    const maximum = Math.max(1, ...entries.map(([, count]) => count));
    entries.forEach(([area, count]) => {
      const entity = getEntity(area);
      elements.entityChart.append(createAnalyticsBar(
        entity.name,
        count,
        maximum,
        entity.color,
        wip.cards.filter((card) => card.area === area).map((card) => card.id),
      ));
    });
  }

  function createAnalyticsBar(labelText, value, maximum, color, cardIds) {
    const row = createAnalyticsAction(`${labelText}: ${value} tickets`, "analytics-bar-row", cardIds);
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

  function createAnalyticsAction(label, className, cardIds) {
    if (!cardIds?.length) {
      const item = document.createElement("div");
      item.className = className;
      item.title = label;
      return item;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.title = `View supporting work: ${label}`;
    button.setAttribute("aria-label", `View supporting work: ${label}`);
    button.addEventListener("click", () => showAnalyticsDrilldown(label, cardIds));
    return button;
  }

  function renderCompletedWorkChart(analytics) {
    elements.throughputChart.replaceChildren();
    const { completedWork } = analytics;
    if (completedWork.total === 0) {
      elements.throughputChart.append(createAnalyticsEmpty(
        "No completed work matches this selected period and filter.",
      ));
      return;
    }
    const maximum = Math.max(1, ...completedWork.throughput.map((bucket) => bucket.completed));
    const labelEvery = completedWork.throughput.length <= 7
      ? 1
      : completedWork.throughput.length <= 30 ? 5 : 15;
    completedWork.throughput.forEach((bucket, index) => {
      const day = createAnalyticsAction(
        `${bucket.key}: ${bucket.completed} completed`,
        "activity-day completed-work-period",
        bucket.completedCardIds,
      );
      day.className = "activity-day completed-work-period";
      const completed = document.createElement("div");
      completed.className = "completed-bar";
      completed.style.height = `${(bucket.completed / maximum) * 100}%`;
      day.append(completed);
      if (index % labelEvery === 0 || index === analytics.throughput.length - 1) {
        const label = document.createElement("span");
        label.className = "activity-day-label";
        label.textContent = formatChartDate(bucket.key);
        day.append(label);
      }
      elements.throughputChart.append(day);
    });
  }

  function renderCumulativeFlow(analytics) {
    if (analytics.cumulativeFlow.every((row) => row.known === 0)) {
      elements.cumulativeFlow.replaceChildren(createAnalyticsEmpty(
        "No recorded state observations match this range and filter.",
      ));
      return;
    }
    const rows = sampleAnalyticsRows(analytics.cumulativeFlow, 12);
    renderAnalyticsTable(
      elements.cumulativeFlow,
      ["Date", ...currentColumns().map((column) => column.label), "Known"],
      rows.map((row) => [
        formatChartDate(row.date),
        ...currentColumns().map((column) => String(row[column.id])),
        String(row.known),
      ]),
      "No recorded state history matches this range.",
    );
  }

  function renderAgingWork(analytics) {
    elements.agingWork.replaceChildren();
    if (analytics.aging.items.length === 0) {
      elements.agingWork.append(createAnalyticsEmpty(
        analytics.aging.unknown.length > 0
          ? "Active tickets have no recorded entry into their current status yet."
          : "No active work matches this filter.",
      ));
      return;
    }
    analytics.aging.items.slice(0, 12).forEach((item) => {
      const row = createAnalyticsAction(
        `${item.id}: ${item.title}`,
        "analytics-record",
        [item.id],
      );
      const heading = document.createElement("strong");
      heading.textContent = `${item.id}: ${item.title}`;
      const detail = document.createElement("span");
      detail.textContent = `${statusLabel(item.columnId)} - ${item.priority} - ${item.area} - `
        + `${item.ageDays} recorded days${item.lowerBound ? " minimum" : ""}`;
      row.append(heading, detail);
      elements.agingWork.append(row);
    });
    if (analytics.aging.unknown.length > 0) {
      const unknown = document.createElement("p");
      unknown.className = "analytics-note";
      unknown.textContent = `${analytics.aging.unknown.length} active ticket(s) have an unknown age because history has no recorded entry into the current status.`;
      elements.agingWork.append(unknown);
    }
  }

  function renderWorkload(analytics) {
    const includeAssignees = elements.analyticsShowAssignees.checked;
    const rows = includeAssignees ? analytics.workload : aggregateHiddenWorkload(analytics.workload);
    renderAnalyticsTable(
      elements.workload,
      ["Workload", "Active", "Blocked", "Completed"],
      rows.map((item) => [item.assignee === "unassigned" ? "Unassigned" : displayAssignee(item.assignee, includeAssignees), String(item.active), String(item.blocked), String(item.completed)]),
      "No active workload matches this filter.",
      rows.map((item) => item.cardIds),
    );
  }

  function aggregateHiddenWorkload(workload) {
    const grouped = new Map();
    workload.forEach((item) => {
      const key = item.assignee === "unassigned" ? "unassigned" : "assigned";
      const target = grouped.get(key) || {
        assignee: key === "unassigned" ? "unassigned" : "Assigned work",
        active: 0,
        blocked: 0,
        completed: 0,
        cardIds: [],
      };
      target.active += item.active;
      target.blocked += item.blocked;
      target.completed += item.completed;
      target.cardIds.push(...item.cardIds);
      grouped.set(key, target);
    });
    return [...grouped.values()];
  }

  function displayAssignee(assignee, includeAssignees) {
    if (!includeAssignees) return "Assigned work";
    return getPerson(assignee).name;
  }

  function renderTimeInStatus(analytics) {
    renderAnalyticsTable(
      elements.timeInStatus,
      ["Status", "Intervals", "Median", "Average", "P85"],
      analytics.timeInStatus.map((item) => [
        statusLabel(item.status),
        String(item.count),
        formatDuration(item.medianDays),
        formatDuration(item.averageDays),
        formatDuration(item.p85Days),
      ]),
      "No completed, non-baseline status intervals match this history.",
    );
  }

  function renderQualityChecks(analytics) {
    elements.qualityChecks.replaceChildren();
    const checks = [
      {
        label: "Active tickets without a description",
        items: analytics.quality.missingDescriptions,
      },
      {
        label: "Unassigned active work",
        items: analytics.quality.unassigned,
      },
      {
        label: "No recent recorded activity",
        items: analytics.quality.stale,
      },
      {
        label: "Duplicate-looking active titles",
        items: analytics.quality.duplicates.flat(),
      },
      {
        label: "Inconsistent status history",
        items: analytics.quality.historyIssues,
      },
    ];
    const hasChecks = checks.some((check) => check.items.length > 0);
    if (!hasChecks) {
      elements.qualityChecks.append(createAnalyticsEmpty("No data-quality checks need attention in this filtered view."));
      return;
    }
    checks.forEach((check) => {
      if (check.items.length === 0) return;
      const ids = check.items.map((item) => item.id || item.card).filter(Boolean);
      const row = createAnalyticsAction(
        `${check.label}: ${check.items.length}`,
        "quality-check",
        ids,
      );
      const title = document.createElement("strong");
      title.textContent = check.label;
      const detail = document.createElement("span");
      detail.textContent = `${check.items.length} item${check.items.length === 1 ? "" : "s"} to review`;
      row.append(title, detail);
      elements.qualityChecks.append(row);
    });
  }

  function renderInsights(analytics) {
    elements.insights.replaceChildren();
    if (analytics.insights.length === 0) {
      elements.insights.append(createAnalyticsEmpty("No significant changes need attention in this filtered view."));
      return;
    }
    analytics.insights.forEach((insight) => {
      const row = createAnalyticsAction(insight.title, "analytics-insight", insight.cardIds);
      row.dataset.tone = insight.tone;
      const title = document.createElement("strong");
      title.textContent = insight.title;
      const detail = document.createElement("span");
      detail.textContent = insight.detail;
      const action = document.createElement("small");
      action.textContent = insight.action;
      row.append(title, detail, action);
      elements.insights.append(row);
    });
  }

  function renderForecast(analytics) {
    elements.forecast.replaceChildren();
    if (!analytics.forecast.available) {
      elements.forecast.append(createAnalyticsEmpty(analytics.forecast.reason));
      return;
    }
    const range = analytics.forecast.finishRangeWeeks;
    const summary = document.createElement("p");
    summary.textContent = range.latest === null
      ? `The current filtered open work could finish in about ${range.earliest} week(s) at the stronger observed weekly throughput. The slower range is too uneven to estimate.`
      : `Historical weekly throughput suggests a range of ${range.earliest} to ${range.latest} weeks for the current filtered open work. This is not a promised date.`;
    elements.forecast.append(summary);
    if (analytics.forecast.targetDate) {
      const target = document.createElement("p");
      target.textContent = `${analytics.forecast.whatCanFinish} tickets could finish by ${formatShortDateKey(analytics.forecast.targetDate)} at typical recorded throughput.`;
      elements.forecast.append(target);
    }
  }

  function renderRecentActivity(analytics) {
    elements.recentActivity.replaceChildren();
    if (analytics.recent.length === 0) {
      elements.recentActivity.append(createAnalyticsEmpty(
        "No recorded activity matches this range and filter.",
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

  function showAnalyticsDrilldown(title, cardIds) {
    elements.analyticsDrilldown.replaceChildren();
    const heading = document.createElement("p");
    heading.className = "analytics-drilldown-heading";
    heading.textContent = title;
    elements.analyticsDrilldown.append(heading);
    const ids = new Set(cardIds || []);
    const cards = state.analytics.cards.filter((card) => ids.has(card.id));
    if (cards.length === 0) {
      elements.analyticsDrilldown.append(createAnalyticsEmpty(
        "The supporting data has no current ticket to open. It may be historical or deleted work.",
      ));
      return;
    }
    cards.forEach((card) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "analytics-record";
      row.addEventListener("click", () => openCardDialog(card.id, card.columnId));
      const label = document.createElement("strong");
      label.textContent = `${card.id}: ${card.title}`;
      const detail = document.createElement("span");
      detail.textContent = `${statusLabel(card.columnId)} - ${card.priority} - ${getEntity(card.area).name}`;
      row.append(label, detail);
      elements.analyticsDrilldown.append(row);
    });
  }

  function renderAnalyticsTable(target, headers, rows, emptyCopy, cardIdsByRow) {
    target.replaceChildren();
    if (rows.length === 0) {
      target.append(createAnalyticsEmpty(emptyCopy));
      return;
    }
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    headers.forEach((header) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = header;
      headRow.append(cell);
    });
    head.append(headRow);
    const body = document.createElement("tbody");
    rows.forEach((cells, index) => {
      const row = document.createElement("tr");
      cells.forEach((value, cellIndex) => {
        const cell = document.createElement("td");
        if (cardIdsByRow?.[index]?.length && cellIndex === 0) {
          const action = createAnalyticsAction(value, "analytics-table-action", cardIdsByRow[index]);
          action.textContent = value;
          cell.append(action);
        } else {
          cell.textContent = value;
        }
        row.append(cell);
      });
      body.append(row);
    });
    table.append(head, body);
    target.append(table);
  }

  function sampleAnalyticsRows(rows, limit) {
    if (rows.length <= limit) return rows;
    return Array.from({ length: limit }, (_, index) => rows[Math.round((index * (rows.length - 1)) / (limit - 1))]);
  }

  function formatSignedNumber(value) {
    return value > 0 ? `+${value}` : String(value);
  }

  function formatForecastRange(forecast) {
    if (!forecast.available) return "Unavailable";
    const { earliest, latest } = forecast.finishRangeWeeks;
    return latest === null ? `${earliest}+w` : `${earliest}-${latest}w`;
  }

  function formatDuration(value) {
    return value === null ? "Unavailable" : `${value}d`;
  }

  function titleCase(value) {
    return value.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
  }

  function eventDescription(event) {
    const entity = getEntity(event.area).name;
    let description;
    if (event.event === "created") description = `Created in ${statusLabel(event.to)} · ${entity} · ${event.priority}`;
    if (event.event === "moved") description = `Moved ${statusLabel(event.from)} → ${statusLabel(event.to)} · ${entity}`;
    if (event.event === "updated" && event.changes.includes("assignee")) {
      const previous = event.previousAssignee ? getPerson(event.previousAssignee).name : "Unassigned";
      const current = event.assignee ? getPerson(event.assignee).name : "Unassigned";
      const otherChanges = event.changes.filter((change) => change !== "assignee");
      description = `Assignment: ${previous} → ${current}`;
      if (otherChanges.length > 0) description += ` · Updated ${otherChanges.join(", ")}`;
      description += ` · ${entity}`;
    } else if (event.event === "updated") {
      description = `Updated ${event.changes.join(", ")} · ${entity}`;
    }
    if (event.event === "deleted") description = `Deleted from ${statusLabel(event.from)} · ${entity}`;
    description ||= entity;
    return event.actor ? `${description} · by ${event.actor}` : description;
  }

  function statusLabel(status) {
    return currentColumns().find((column) => column.id === status)?.label || status;
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

  function formatShortDateKey(dateKey) {
    return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" })
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

  function markDirty(target, { autosave = true } = {}) {
    if (target === "board") {
      state.dirtyBoard = true;
      state.boardRevision += 1;
    } else {
      state.dirtyConfig = true;
      state.configRevision += 1;
    }
    updateDirtyState();
    if (!autosave) {
      updateSaveState("pending", "Unsaved changes", "Save column changes or discard them");
      return;
    }
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
      const duplicateSources = saveBoard && Object.keys(state.duplicateSources).length > 0
        ? { ...state.duplicateSources }
        : undefined;
      state.pendingSave = {
        saveBoard,
        saveConfig,
        boardRevision,
        configRevision,
        manual,
        duplicateSources,
      };
      if (duplicateSources) {
        state.duplicateSources = {};
      }
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
          duplicateSources,
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
    if (pending.saveConfig && state.configRevision === pending.configRevision) {
      state.dirtyConfig = false;
      state.columnEditBaseline = null;
    }
    state.pendingSave = null;
    state.saveInFlight = false;
    updateDirtyState();
    renderAnalytics();
    const savedAt = new Date();
    elements.lastLoadedLabel.textContent = `Saved ${formatTime(savedAt)}`;
    setStatus(
      standalone
        ? "Markdown files saved to the selected folder."
        : "Markdown files saved. Source control has the authoritative diff.",
      "online",
    );
    if (!state.dirtyBoard && !state.dirtyConfig) {
      updateSaveState("saved", "Saved", `Last saved ${formatTime(savedAt)}`);
    }
    if (pending.manual) showToast("Markdown changes saved.", "success");
    if (state.saveQueued || state.dirtyBoard || state.dirtyConfig) scheduleAutosave();
  }

  function failSave(message) {
    const pending = state.pendingSave;
    if (pending?.duplicateSources) {
      state.duplicateSources = { ...pending.duplicateSources, ...state.duplicateSources };
    }
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