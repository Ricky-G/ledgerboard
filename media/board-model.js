(function initBoardModel(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.LedgerBoardModel = api;
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
  const DETAIL_FIELDS = [
    { key: "description", label: "Description" },
    { key: "assignee", label: "Assignee" },
  ];
  const DETAIL_KEY_BY_LABEL = new Map(
    DETAIL_FIELDS.map((field) => [field.label.toLowerCase(), field.key]),
  );
  const HISTORY_EVENTS = new Set(["baseline", "created", "moved", "updated", "deleted"]);
  const SAFE_NORMALIZATION_CODES = new Set([
    "card-separator",
    "mixed-line-endings",
    "noncanonical-formatting",
  ]);

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

  function analyzeBoardSource(markdown) {
    if (typeof markdown !== "string") {
      throw new TypeError("Board content must be a string.");
    }

    const diagnostics = [];
    const lineEndings = inspectLineEndings(markdown);
    if (lineEndings.mixed) {
      diagnostics.push(createDiagnostic(
        "mixed-line-endings",
        "error",
        `BOARD.md uses mixed line endings near line ${lineEndings.firstMixedLine}. Run LedgerBoard: Normalize BOARD.md Formatting.`,
        lineEndings.firstMixedLine,
      ));
    }

    const parseSource = normalizeLineEndings(markdown, lineEndings.preferred);
    let board;
    try {
      board = parseBoard(parseSource);
    } catch (error) {
      diagnostics.push(createDiagnostic(
        "board-parse",
        "error",
        error.message || String(error),
      ));
      return buildAnalysis(markdown, null, null, diagnostics, lineEndings.preferred);
    }

    diagnostics.push(...inspectCardLayout(parseSource));
    const canonicalSource = serializeBoard(board);
    if (canonicalSource !== parseSource && !diagnostics.some((item) => item.severity === "error")) {
      const difference = firstLineDifference(parseSource, canonicalSource);
      diagnostics.push(createDiagnostic(
        "noncanonical-formatting",
        "error",
        `BOARD.md differs from canonical formatting near line ${difference.line}. Expected ${quoteLine(difference.expected)} but found ${quoteLine(difference.actual)}. Run LedgerBoard: Normalize BOARD.md Formatting.`,
        difference.line,
      ));
    }

    return buildAnalysis(markdown, board, canonicalSource, diagnostics, lineEndings.preferred);
  }

  function validateBundleSources(boardSource, configSource, historySource) {
    const analysis = analyzeBoardSource(boardSource);
    if (analysis.errors.length > 0) {
      throw diagnosticError(analysis);
    }

    const config = parseConfig(configSource);
    const history = parseHistory(historySource);
    const cards = analysis.board.columns.flatMap((column) => column.cards);
    const entityIds = new Set(config.entities.map((entity) => entity.id));
    const missing = [...new Set(cards.map((card) => card.area).filter((area) => !entityIds.has(area)))];
    if (missing.length > 0) {
      throw new Error(`Missing entity configuration: ${missing.join(", ")}.`);
    }
    const personIds = new Set(config.people.map((person) => person.id));
    const missingPeople = [...new Set(cards
      .map((card) => card.detailValues.assignee)
      .filter((assignee) => assignee && !personIds.has(assignee)))];
    if (missingPeople.length > 0) {
      throw new Error(`Missing person configuration: ${missingPeople.join(", ")}.`);
    }

    return {
      board: analysis.board,
      config,
      historyEvents: history.events,
      cardCount: cards.length,
      diagnostics: analysis.diagnostics,
      warnings: analysis.warnings,
    };
  }

  function normalizeBoardSource(markdown) {
    const analysis = analyzeBoardSource(markdown);
    if (!analysis.board || !analysis.canNormalize) {
      throw diagnosticError(analysis);
    }
    return {
      source: analysis.canonicalSource,
      diagnostics: analysis.diagnostics,
      changed: analysis.canonicalSource !== markdown,
    };
  }

  function inspectLineEndings(markdown) {
    const styles = [];
    let line = 1;
    for (let index = 0; index < markdown.length; index += 1) {
      if (markdown[index] === "\r" && markdown[index + 1] === "\n") {
        styles.push({ style: "crlf", line });
        index += 1;
        line += 1;
      } else if (markdown[index] === "\n") {
        styles.push({ style: "lf", line });
        line += 1;
      } else if (markdown[index] === "\r") {
        styles.push({ style: "cr", line });
        line += 1;
      }
    }

    const counts = styles.reduce((result, item) => {
      result[item.style] = (result[item.style] || 0) + 1;
      return result;
    }, {});
    const used = Object.keys(counts);
    const preferredStyle = (counts.crlf || 0) > (counts.lf || 0) ? "crlf" : "lf";
    const firstMixed = styles.find((item) => item.style !== preferredStyle);
    return {
      mixed: used.length > 1 || used.includes("cr"),
      preferred: preferredStyle === "crlf" ? "\r\n" : "\n",
      firstMixedLine: firstMixed?.line || 1,
    };
  }

  function normalizeLineEndings(markdown, newline) {
    return markdown.replace(/\r\n|\r|\n/g, "\n").replace(/\n/g, newline);
  }

  function inspectCardLayout(markdown) {
    const lines = markdown.split(/\r?\n/);
    const diagnostics = [];
    const headings = findColumnHeadings(lines);

    headings.forEach((heading, columnIndex) => {
      const nextHeading = headings[columnIndex + 1];
      const sectionLimit = nextHeading ? nextHeading.headingIndex : lines.length;
      const separatorIndex = findSeparator(lines, heading.headingIndex + 1, sectionLimit);
      const sectionEnd = separatorIndex === -1 ? sectionLimit : separatorIndex;
      const cardStarts = [];
      for (let lineIndex = heading.headingIndex + 1; lineIndex < sectionEnd; lineIndex += 1) {
        if (CARD_PATTERN.test(lines[lineIndex])) cardStarts.push(lineIndex);
      }

      for (let cardIndex = 0; cardIndex < cardStarts.length; cardIndex += 1) {
        const cardStart = cardStarts[cardIndex];
        const nextCardStart = cardStarts[cardIndex + 1] ?? sectionEnd;
        const cardId = lines[cardStart].match(CARD_PATTERN)?.[2] || "card";
        inspectCardDetails(lines, cardStart, nextCardStart, cardId, diagnostics);

        if (cardIndex > 0) {
          const previousId = lines[cardStarts[cardIndex - 1]].match(CARD_PATTERN)?.[2] || "previous card";
          let blankLines = 0;
          for (let lineIndex = cardStart - 1; lineIndex >= 0 && lines[lineIndex].trim() === ""; lineIndex -= 1) {
            blankLines += 1;
          }
          if (blankLines !== 1) {
            diagnostics.push(createDiagnostic(
              "card-separator",
              "error",
              `Cards ${previousId} and ${cardId} must be separated by exactly one blank physical line near line ${cardStart + 1}; found ${blankLines}. Run LedgerBoard: Normalize BOARD.md Formatting.`,
              cardStart + 1,
              { cards: [previousId, cardId], found: blankLines },
            ));
          }
        }
      }
    });
    return diagnostics;
  }

  function inspectCardDetails(lines, cardStart, nextCardStart, cardId, diagnostics) {
    let previousDetailLabel = "";
    for (let lineIndex = cardStart + 1; lineIndex < nextCardStart; lineIndex += 1) {
      const line = lines[lineIndex];
      if (line.trim() === "") {
        previousDetailLabel = "";
        continue;
      }
      const detailMatch = line.match(DETAIL_PATTERN);
      if (detailMatch) {
        const label = detailMatch[1].trim();
        previousDetailLabel = label;
        if (!DETAIL_KEY_BY_LABEL.has(label.toLowerCase())) {
          diagnostics.push(createDiagnostic(
            "unsupported-detail",
            "warning",
            `${cardId} has unsupported detail field "${label}" on line ${lineIndex + 1}. LedgerBoard preserves it but cannot edit it visually.`,
            lineIndex + 1,
            { card: cardId, field: label },
          ));
        }
        continue;
      }
      if (/^\s+\S/.test(line)) {
        const field = previousDetailLabel || "Detail";
        diagnostics.push(createDiagnostic(
          `multiline-${field.toLowerCase()}`,
          "error",
          `${field} for ${cardId} must stay on one physical line; continuation found on line ${lineIndex + 1}.`,
          lineIndex + 1,
          { card: cardId, field },
        ));
      } else if (previousDetailLabel || line.trim()) {
        diagnostics.push(createDiagnostic(
          "unsupported-card-content",
          "error",
          `${cardId} has unsupported content on line ${lineIndex + 1}. Card details must use indented Description or Assignee lines.`,
          lineIndex + 1,
          { card: cardId },
        ));
      }
      previousDetailLabel = "";
    }
  }

  function buildAnalysis(source, board, canonicalSource, diagnostics, newline) {
    const errors = diagnostics.filter((item) => item.severity === "error");
    const warnings = diagnostics.filter((item) => item.severity === "warning");
    return {
      source,
      board,
      canonicalSource,
      newline,
      diagnostics,
      errors,
      warnings,
      isCanonical: errors.length === 0 && canonicalSource === source,
      canNormalize: Boolean(board) && errors.every((item) => SAFE_NORMALIZATION_CODES.has(item.code)),
    };
  }

  function createDiagnostic(code, severity, message, line, data = {}) {
    return { code, severity, message, line: line || null, ...data };
  }

  function diagnosticError(analysis) {
    const first = analysis.errors[0];
    const error = new Error(first?.message || "BOARD.md is invalid.");
    error.code = first?.code || "board-invalid";
    error.line = first?.line || null;
    error.diagnostics = analysis.diagnostics;
    error.canNormalize = analysis.canNormalize;
    return error;
  }

  function firstLineDifference(actual, expected) {
    const actualLines = actual.split(/\r?\n/);
    const expectedLines = expected.split(/\r?\n/);
    const length = Math.max(actualLines.length, expectedLines.length);
    for (let index = 0; index < length; index += 1) {
      if (actualLines[index] !== expectedLines[index]) {
        return { line: index + 1, actual: actualLines[index], expected: expectedLines[index] };
      }
    }
    return { line: 1, actual: actualLines[0], expected: expectedLines[0] };
  }

  function quoteLine(line) {
    return line === undefined ? "end of file" : JSON.stringify(line);
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
      } else if (/^- \[[^\]]*\] AO-/.test(lines[lineIndex])) {
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
    return { description: "", assignee: "" };
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
      throw new Error("Doing already has three outcomes. Finish something before starting more.");
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
    ["assignee", "previousAssignee"].forEach((field) => {
      if (event[field] !== undefined && event[field] !== null
        && !/^[a-z0-9][a-z0-9-]*$/.test(event[field])) {
        throw new Error(`History event${location} has an invalid ${field}.`);
      }
    });
    if (event.actor !== undefined && (typeof event.actor !== "string" || !event.actor.trim())) {
      throw new Error(`History event${location} has an invalid actor.`);
    }
    if (event.event === "updated" && event.changes?.includes("assignee")
      && (!Object.hasOwn(event, "previousAssignee") || !Object.hasOwn(event, "assignee"))) {
      throw new Error(`Assignment history event${location} requires previousAssignee and assignee.`);
    }
    return true;
  }

  function createBaselineEvents(document, at) {
    validateBoard(document);
    return document.columns.flatMap((column) => column.cards.map((card) => historyEvent(
      at,
      card,
      "baseline",
      { to: column.id },
    )));
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
      const previousAssignee = previous.card.detailValues.assignee || null;
      const assignee = current.card.detailValues.assignee || null;
      if (previousAssignee !== assignee) changes.push("assignee");
      if (changes.length > 0) {
        events.push(historyEvent(at, current.card, "updated", {
          to: current.columnId,
          changes,
          ...(previousAssignee !== assignee ? { previousAssignee, assignee } : {}),
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
      ...(card.detailValues.assignee ? { assignee: card.detailValues.assignee } : {}),
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
    if (!Array.isArray(config.people)) {
      throw new Error("Configuration requires a people array.");
    }

    validateDirectory(config.entities, "entity", false);
    validateDirectory(config.people, "person", true);
    return true;
  }

  function validateDirectory(items, type, requireName) {
    const ids = new Set();
    items.forEach((item) => {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(item.id || "")) {
        throw new Error(`Invalid ${type} ID: ${item.id || "empty"}.`);
      }
      if (ids.has(item.id)) {
        throw new Error(`Duplicate ${type} ID: ${item.id}.`);
      }
      if (requireName && (typeof item.name !== "string" || !item.name.trim())) {
        throw new Error(`Invalid name for ${item.id}.`);
      }
      if (!/^#[0-9a-f]{6}$/i.test(item.color || "")) {
        throw new Error(`Invalid color for ${item.id}.`);
      }
      ids.add(item.id);
    });
  }

  function normalizeConfig(config) {
    if (!config || typeof config !== "object") {
      return config;
    }

    const normalized = { ...config };
    if (!Array.isArray(normalized.entities) && Array.isArray(normalized.customers)) {
      normalized.entities = normalized.customers;
    }
    if (!Array.isArray(normalized.people)) {
      normalized.people = [];
    }
    delete normalized.customers;
    return normalized;
  }

  function createDefaultConfig() {
    return {
      version: 1,
      workspace: {
        name: "My Workspace",
        boardTitle: "LedgerBoard",
        timezone: "Etc/UTC",
      },
      appearance: {
        accent: "#e24a35",
        density: "comfortable",
      },
      entities: [
        { id: "meta", name: "Internal", color: "#167d74" },
      ],
      people: [],
    };
  }

  return {
    COLUMNS,
    analyzeBoardSource,
    appendHistory,
    buildAnalytics,
    createCard,
    createBaselineEvents,
    createDefaultConfig,
    diffBoardEvents,
    findCard,
    moveCard,
    nextCardId,
    normalizeBoardSource,
    parseBoard,
    parseConfig,
    parseHistory,
    serializeBoard,
    serializeConfig,
    validateBundleSources,
    validateBoard,
    validateConfig,
  };
});