(function initBoardModel(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.CsaBoardModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createBoardModel() {
  "use strict";

  const COLUMNS = [
    { id: "inbox", label: "Inbox", heading: /^## Inbox\s*$/ },
    { id: "next", label: "Next", heading: /^## Next\s*$/ },
    { id: "doing", label: "Doing", heading: /^## Doing(?:\s+`[^`]+`)?\s*$/ },
    { id: "blocked", label: "Review / Blocked", heading: /^## Review \/ Blocked\s*$/ },
    { id: "done", label: "Done", heading: /^## Done\s*$/ },
  ];

  const CARD_PATTERN = /^- \[([ xX])\] (AO-\d{3,}) — (.+) · (P[1-4]) · area:([a-z0-9][a-z0-9-]*)$/;
  const DETAIL_PATTERN = /^\s{4}- \*\*([^*]+):\*\*\s*(.*)$/;
  const DETAIL_FIELDS = [{ key: "description", label: "Description" }];
  const DETAIL_KEY_BY_LABEL = new Map(
    DETAIL_FIELDS.map((field) => [field.label.toLowerCase(), field.key]),
  );
  const HISTORY_EVENTS = new Set(["baseline", "created", "moved", "updated", "deleted"]);

  function parseBoard(markdown) {
    if (typeof markdown !== "string") {
      throw new TypeError("Board content must be a string.");
    }

    const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
    const lines = markdown.split(/\r?\n/);
    const headings = findColumnHeadings(lines);

    if (headings.length !== COLUMNS.length) {
      const found = headings.map((item) => item.id).join(", ") || "none";
      throw new Error(`Expected five board columns; found ${found}.`);
    }

    const columns = headings.map((heading, index) => {
      const nextHeading = headings[index + 1];
      const sectionLimit = nextHeading ? nextHeading.headingIndex : lines.length;
      const separatorIndex = findSeparator(lines, heading.headingIndex + 1, sectionLimit);
      const sectionEnd = separatorIndex === -1 ? sectionLimit : separatorIndex;
      return parseColumn(lines, heading, sectionEnd);
    });

    const document = { source: markdown, newline, lines, columns };
    validateBoard(document);
    return document;
  }

  function findColumnHeadings(lines) {
    const headings = [];
    let insideFence = false;

    lines.forEach((line, lineIndex) => {
      if (/^\s*```/.test(line)) {
        insideFence = !insideFence;
        return;
      }

      if (insideFence) {
        return;
      }

      const definition = COLUMNS.find((column) => column.heading.test(line));
      if (definition) {
        headings.push({ ...definition, headingIndex: lineIndex });
      }
    });

    return headings;
  }

  function findSeparator(lines, start, end) {
    for (let lineIndex = start; lineIndex < end; lineIndex += 1) {
      if (lines[lineIndex].trim() === "---") {
        return lineIndex;
      }
    }
    return -1;
  }

  function parseColumn(lines, heading, sectionEnd) {
    const cardStarts = [];
    let emptyMarkerIndex = -1;

    for (let lineIndex = heading.headingIndex + 1; lineIndex < sectionEnd; lineIndex += 1) {
      if (CARD_PATTERN.test(lines[lineIndex])) {
        cardStarts.push(lineIndex);
      } else if (lines[lineIndex].trim() === "<!-- empty -->") {
        emptyMarkerIndex = lineIndex;
      } else if (/^- \[[ xX]\] AO-/.test(lines[lineIndex])) {
        throw new Error(`Invalid card format on line ${lineIndex + 1}.`);
      }
    }

    let zoneStart;
    let zoneEnd;

    if (cardStarts.length > 0) {
      zoneStart = cardStarts[0];
      zoneEnd = trimTrailingBlankLines(lines, sectionEnd, zoneStart);
    } else if (emptyMarkerIndex !== -1) {
      zoneStart = emptyMarkerIndex;
      zoneEnd = emptyMarkerIndex + 1;
    } else {
      zoneStart = trimTrailingBlankLines(lines, sectionEnd, heading.headingIndex + 1);
      zoneEnd = zoneStart;
    }

    const cards = cardStarts.map((cardStart, cardIndex) => {
      const nextCardStart = cardStarts[cardIndex + 1] ?? zoneEnd;
      const cardEnd = trimTrailingBlankLines(lines, nextCardStart, cardStart + 1);
      return parseCard(lines.slice(cardStart, cardEnd), heading.id);
    });

    return {
      id: heading.id,
      label: heading.label,
      headingIndex: heading.headingIndex,
      sectionEnd,
      zoneStart,
      zoneEnd,
      cards,
    };
  }

  function trimTrailingBlankLines(lines, end, minimum) {
    let result = end;
    while (result > minimum && lines[result - 1].trim() === "") {
      result -= 1;
    }
    return result;
  }

  function parseCard(cardLines, columnId) {
    const match = cardLines[0].match(CARD_PATTERN);
    if (!match) {
      throw new Error(`Unable to parse card: ${cardLines[0]}`);
    }

    const detailValues = emptyDetailValues();
    const rawDetailLines = cardLines.slice(1);

    rawDetailLines.forEach((line) => {
      const detailMatch = line.match(DETAIL_PATTERN);
      if (!detailMatch) {
        return;
      }

      const key = DETAIL_KEY_BY_LABEL.get(detailMatch[1].trim().toLowerCase());
      if (key) {
        detailValues[key] = detailMatch[2].trim();
      }
    });

    return {
      checked: match[1].trim().toLowerCase() === "x",
      id: match[2],
      title: match[3],
      priority: match[4],
      area: match[5],
      columnId,
      detailValues,
      rawDetailLines,
    };
  }

  function emptyDetailValues() {
    return { description: "" };
  }

  function serializeBoard(document) {
    validateBoard(document);
    const lines = document.lines.slice();

    [...document.columns]
      .sort((left, right) => right.zoneStart - left.zoneStart)
      .forEach((column) => {
        const replacement = column.cards.length > 0
          ? serializeCards(column.cards)
          : ["<!-- empty -->"];
        lines.splice(column.zoneStart, column.zoneEnd - column.zoneStart, ...replacement);
      });

    return lines.join(document.newline);
  }

  function serializeCards(cards) {
    const lines = [];
    cards.forEach((card, index) => {
      if (index > 0) {
        lines.push("");
      }
      lines.push(...serializeCard(card));
    });
    return lines;
  }

  function serializeCard(card) {
    const checkbox = card.columnId === "done" || card.checked ? "x" : " ";
    const lines = [
      `- [${checkbox}] ${card.id} — ${card.title} · ${card.priority} · area:${card.area}`,
    ];
    const emittedFields = new Set();

    card.rawDetailLines.forEach((line) => {
      const detailMatch = line.match(DETAIL_PATTERN);
      if (!detailMatch) {
        lines.push(line);
        return;
      }

      const key = DETAIL_KEY_BY_LABEL.get(detailMatch[1].trim().toLowerCase());
      if (!key) {
        lines.push(line);
        return;
      }

      emittedFields.add(key);
      const field = DETAIL_FIELDS.find((item) => item.key === key);
      const value = String(card.detailValues[key] ?? "").trim();
      if (value) {
        lines.push(`    - **${field.label}:** ${value}`);
      }
    });

    DETAIL_FIELDS.forEach((field) => {
      const value = String(card.detailValues[field.key] ?? "").trim();
      if (value && !emittedFields.has(field.key)) {
        lines.push(`    - **${field.label}:** ${value}`);
      }
    });

    return lines;
  }

  function validateBoard(document) {
    const seenIds = new Set();
    const issues = [];

    document.columns.forEach((column) => {
      column.cards.forEach((card) => {
        if (seenIds.has(card.id)) {
          issues.push(`Duplicate card ID ${card.id}.`);
        }
        seenIds.add(card.id);

        if (card.columnId !== column.id) {
          card.columnId = column.id;
        }
        if (column.id === "done" && !card.checked) {
          issues.push(`${card.id} must use [x] in Done.`);
        }
        if (column.id !== "done" && card.checked) {
          issues.push(`${card.id} must use [ ] outside Done.`);
        }
      });
    });

    const doing = document.columns.find((column) => column.id === "doing");
    if (doing && doing.cards.length > 3) {
      issues.push(`Doing WIP is ${doing.cards.length}; the limit is 3.`);
    }

    if (issues.length > 0) {
      throw new Error(issues.join("\n"));
    }

    return true;
  }

  function nextCardId(document, historyEvents = []) {
    const boardHighest = document.columns
      .flatMap((column) => column.cards)
      .reduce((maximum, card) => {
        const value = Number.parseInt(card.id.slice(3), 10);
        return Number.isFinite(value) ? Math.max(maximum, value) : maximum;
      }, 0);
    const historyHighest = historyEvents.reduce((maximum, event) => {
      const value = Number.parseInt(String(event.card || "").slice(3), 10);
      return Number.isFinite(value) ? Math.max(maximum, value) : maximum;
    }, 0);
    const highest = Math.max(boardHighest, historyHighest);
    return `AO-${String(highest + 1).padStart(3, "0")}`;
  }

  function createCard(document, values = {}) {
    return {
      checked: false,
      id: nextCardId(document, values.historyEvents),
      title: values.title || "Untitled outcome",
      priority: values.priority || "P2",
      area: values.area || "meta",
      columnId: values.columnId || "inbox",
      detailValues: { ...emptyDetailValues(), ...(values.detailValues || {}) },
      rawDetailLines: [],
    };
  }

  function findCard(document, cardId) {
    for (const column of document.columns) {
      const cardIndex = column.cards.findIndex((card) => card.id === cardId);
      if (cardIndex !== -1) {
        return { column, card: column.cards[cardIndex], cardIndex };
      }
    }
    return null;
  }

  function moveCard(document, cardId, targetColumnId, targetIndex) {
    const source = findCard(document, cardId);
    const target = document.columns.find((column) => column.id === targetColumnId);

    if (!source || !target) {
      throw new Error("Card or target column was not found.");
    }
    if (target.id === "doing" && source.column.id !== "doing" && target.cards.length >= 3) {
      throw new Error("Doing already has three cards. Finish something before starting more.");
    }

    source.column.cards.splice(source.cardIndex, 1);
    source.card.columnId = target.id;
    source.card.checked = target.id === "done";
    const insertionIndex = Number.isInteger(targetIndex)
      ? Math.max(0, Math.min(targetIndex, target.cards.length))
      : target.cards.length;
    target.cards.splice(insertionIndex, 0, source.card);
    validateBoard(document);
    return source.card;
  }

  function parseHistory(markdown) {
    if (typeof markdown !== "string") {
      throw new TypeError("History content must be a string.");
    }

    const events = [];
    markdown.split(/\r?\n/).forEach((line, index) => {
      const match = line.match(/^ {4}(\{.*\})$/);
      if (!match) {
        return;
      }

      let event;
      try {
        event = JSON.parse(match[1]);
      } catch (error) {
        throw new Error(`Invalid history JSON on line ${index + 1}: ${error.message}`);
      }
      validateHistoryEvent(event, index + 1);
      events.push(event);
    });

    return {
      source: markdown,
      newline: markdown.includes("\r\n") ? "\r\n" : "\n",
      events,
    };
  }

  function appendHistory(markdown, events) {
    if (!Array.isArray(events) || events.length === 0) {
      return markdown;
    }
    events.forEach((event) => validateHistoryEvent(event));
    const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
    const separator = markdown.length > 0 && !markdown.endsWith(newline) ? newline : "";
    const lines = events.map((event) => `    ${JSON.stringify(event)}`).join(newline);
    return `${markdown}${separator}${lines}${newline}`;
  }

  function validateHistoryEvent(event, lineNumber) {
    const location = lineNumber ? ` on line ${lineNumber}` : "";
    if (!event || typeof event !== "object") {
      throw new Error(`History event${location} must be an object.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}T/.test(event.at || "")) {
      throw new Error(`History event${location} requires an ISO timestamp.`);
    }
    if (!/^AO-\d{3,}$/.test(event.card || "")) {
      throw new Error(`History event${location} requires a card ID.`);
    }
    if (!HISTORY_EVENTS.has(event.event)) {
      throw new Error(`History event${location} has an unsupported type.`);
    }
    return true;
  }

  function createBaselineEvents(document, at) {
    validateBoard(document);
    return document.columns.flatMap((column) => column.cards.map((card) => ({
      at,
      card: card.id,
      event: "baseline",
      to: column.id,
      area: card.area,
      priority: card.priority,
      title: card.title,
    })));
  }

  function diffBoardEvents(before, after, at) {
    validateBoard(before);
    validateBoard(after);
    const events = [];
    const beforeCards = boardCardMap(before);
    const afterCards = boardCardMap(after);

    afterCards.forEach((current, cardId) => {
      const previous = beforeCards.get(cardId);
      if (!previous) {
        events.push(historyEvent(at, current.card, "created", { to: current.columnId }));
        return;
      }

      if (previous.columnId !== current.columnId) {
        events.push(historyEvent(at, current.card, "moved", {
          from: previous.columnId,
          to: current.columnId,
        }));
      }

      const changes = [];
      if (previous.card.title !== current.card.title) changes.push("title");
      if (previous.card.detailValues.description !== current.card.detailValues.description) changes.push("description");
      if (previous.card.area !== current.card.area) changes.push("area");
      if (previous.card.priority !== current.card.priority) changes.push("priority");
      if (changes.length > 0) {
        events.push(historyEvent(at, current.card, "updated", {
          to: current.columnId,
          changes,
        }));
      }
    });

    beforeCards.forEach((previous, cardId) => {
      if (!afterCards.has(cardId)) {
        events.push(historyEvent(at, previous.card, "deleted", { from: previous.columnId }));
      }
    });

    return events;
  }

  function boardCardMap(document) {
    return new Map(document.columns.flatMap((column) => column.cards.map((card) => [
      card.id,
      { card, columnId: column.id },
    ])));
  }

  function historyEvent(at, card, event, extra) {
    return {
      at,
      card: card.id,
      event,
      ...extra,
      area: card.area,
      priority: card.priority,
      title: card.title,
    };
  }

  function buildAnalytics(document, historyEvents, options = {}) {
    validateBoard(document);
    const now = options.now ? new Date(options.now) : new Date();
    const days = Number.isInteger(options.days) ? options.days : 30;
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    const cards = document.columns.flatMap((column) => column.cards.map((card) => ({
      ...card,
      columnId: column.id,
    })));
    const activeCards = cards.filter((card) => card.columnId !== "done");
    const status = Object.fromEntries(COLUMNS.map((column) => [column.id, 0]));
    const priority = { P1: 0, P2: 0, P3: 0, P4: 0 };
    const entities = {};

    cards.forEach((card) => { status[card.columnId] += 1; });
    activeCards.forEach((card) => {
      priority[card.priority] += 1;
      entities[card.area] = (entities[card.area] || 0) + 1;
    });

    const daily = [];
    const dailyMap = new Map();
    for (let offset = 0; offset < days; offset += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + offset);
      const key = localDateKey(date);
      const bucket = { date: key, activity: 0, completed: 0 };
      daily.push(bucket);
      dailyMap.set(key, bucket);
    }

    const relevantEvents = historyEvents
      .filter((event) => event.event !== "baseline")
      .filter((event) => {
        const timestamp = new Date(event.at);
        return Number.isFinite(timestamp.valueOf()) && timestamp >= start && timestamp <= now;
      });
    relevantEvents.forEach((event) => {
      const bucket = dailyMap.get(event.at.slice(0, 10));
      if (!bucket) return;
      bucket.activity += 1;
      if ((event.event === "moved" || event.event === "created") && event.to === "done") {
        bucket.completed += 1;
      }
    });

    const cycleTimes = completedCycleTimes(historyEvents);
    const recent = [...historyEvents]
      .filter((event) => event.event !== "baseline")
      .sort((left, right) => right.at.localeCompare(left.at))
      .slice(0, 12);
    const historySince = historyEvents.length > 0
      ? [...historyEvents].sort((left, right) => left.at.localeCompare(right.at))[0].at
      : null;

    return {
      total: cards.length,
      active: activeCards.length,
      done: status.done,
      completionRate: cards.length === 0 ? 0 : Math.round((status.done / cards.length) * 100),
      activeEntities: Object.keys(entities).length,
      transitions: relevantEvents.filter((event) => event.event === "moved").length,
      completedInRange: daily.reduce((sum, bucket) => sum + bucket.completed, 0),
      medianCycleDays: median(cycleTimes),
      status,
      priority,
      entities,
      daily,
      recent,
      historySince,
      historyEvents: historyEvents.length,
      rangeDays: days,
    };
  }

  function completedCycleTimes(events) {
    const created = new Map();
    const durations = [];
    [...events].sort((left, right) => left.at.localeCompare(right.at)).forEach((event) => {
      if (event.event === "created") {
        created.set(event.card, new Date(event.at));
      }
      if ((event.event === "moved" || event.event === "created") && event.to === "done") {
        const started = created.get(event.card);
        const finished = new Date(event.at);
        if (started && Number.isFinite(started.valueOf()) && Number.isFinite(finished.valueOf())) {
          durations.push(Math.max(0, (finished - started) / 86400000));
        }
      }
    });
    return durations;
  }

  function median(values) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    const value = sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
    return Math.round(value * 10) / 10;
  }

  function localDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function parseConfig(markdown) {
    if (typeof markdown !== "string") {
      throw new TypeError("Configuration content must be a string.");
    }
    const match = markdown.match(/```json\s*([\s\S]*?)```/i);
    if (!match) {
      throw new Error("KANBAN-CONFIG.md must contain one fenced JSON block.");
    }
    const config = normalizeConfig(JSON.parse(match[1]));
    validateConfig(config);
    return config;
  }

  function serializeConfig(markdown, config) {
    const normalized = normalizeConfig(config);
    validateConfig(normalized);
    const json = JSON.stringify(normalized, null, 2);
    if (/```json\s*[\s\S]*?```/i.test(markdown)) {
      return markdown.replace(/```json\s*[\s\S]*?```/i, `\`\`\`json\n${json}\n\`\`\``);
    }
    return `# Kanban Configuration\n\nManaged by the local Kanban page.\n\n\`\`\`json\n${json}\n\`\`\`\n`;
  }

  function validateConfig(config) {
    if (!config || typeof config !== "object") {
      throw new Error("Kanban configuration must be an object.");
    }
    if (!config.workspace || typeof config.workspace.name !== "string") {
      throw new Error("Configuration requires workspace.name.");
    }
    if (!Array.isArray(config.entities)) {
      throw new Error("Configuration requires an entities array.");
    }

    const ids = new Set();
    config.entities.forEach((entity) => {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(entity.id || "")) {
        throw new Error(`Invalid entity ID: ${entity.id || "empty"}.`);
      }
      if (ids.has(entity.id)) {
        throw new Error(`Duplicate entity ID: ${entity.id}.`);
      }
      if (!/^#[0-9a-f]{6}$/i.test(entity.color || "")) {
        throw new Error(`Invalid color for ${entity.id}.`);
      }
      ids.add(entity.id);
    });
    return true;
  }

  function normalizeConfig(config) {
    if (!config || typeof config !== "object") {
      return config;
    }

    const normalized = { ...config };
    if (!Array.isArray(normalized.entities) && Array.isArray(normalized.customers)) {
      normalized.entities = normalized.customers;
    }
    delete normalized.customers;
    return normalized;
  }

  function createDefaultConfig() {
    return {
      version: 1,
      workspace: {
        name: "My Workspace",
        boardTitle: "Kanban Ledger",
        timezone: "Etc/UTC",
      },
      appearance: {
        accent: "#e24a35",
        density: "comfortable",
      },
      entities: [
        { id: "meta", name: "Internal", color: "#167d74" },
      ],
    };
  }

  return {
    COLUMNS,
    appendHistory,
    buildAnalytics,
    createCard,
    createBaselineEvents,
    createDefaultConfig,
    diffBoardEvents,
    findCard,
    moveCard,
    nextCardId,
    parseBoard,
    parseConfig,
    parseHistory,
    serializeBoard,
    serializeConfig,
    validateBoard,
    validateConfig,
  };
});