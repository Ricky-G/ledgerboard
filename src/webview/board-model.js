// Shared by the extension host and the generated self-contained web app.
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
    const isReorder = source.column === target;
    if (isReorder && targetIndex === source.cardIndex) {
      validateBoard(document);
      return source.card;
    }

    // `targetIndex` is expressed against the column as the caller sees it, before
    // the card is lifted out. Clamp against that length so an out-of-range index
    // is not reduced twice by the reorder adjustment below.
    const hasTargetIndex = Number.isInteger(targetIndex);
    const requestedIndex = hasTargetIndex
      ? Math.max(0, Math.min(targetIndex, target.cards.length))
      : target.cards.length;

    source.column.cards.splice(source.cardIndex, 1);
    source.card.columnId = target.id;
    source.card.checked = target.id === "done";
    let insertionIndex = requestedIndex;
    if (isReorder && hasTargetIndex && source.cardIndex < requestedIndex) {
      insertionIndex -= 1;
    }
    insertionIndex = Math.min(insertionIndex, target.cards.length);
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
    const timestamp = new Date(event.at || "");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(event.at || "")
      || !Number.isFinite(timestamp.valueOf())) {
      throw new Error(`History event${location} requires an ISO timestamp.`);
    }
    if (!/^AO-\d{3,}$/.test(event.card || "")) {
      throw new Error(`History event${location} requires a card ID.`);
    }
    if (!HISTORY_EVENTS.has(event.event)) {
      throw new Error(`History event${location} has an unsupported type.`);
    }
    ["from", "to"].forEach((field) => {
      if (event[field] !== undefined && !COLUMNS.some((column) => column.id === event[field])) {
        throw new Error(`History event${location} has an invalid ${field} status.`);
      }
    });
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
    if (!Number.isFinite(now.valueOf())) {
      throw new Error("Analytics requires a valid current timestamp.");
    }

    const timeZone = resolveAnalyticsTimeZone(options.timeZone);
    const dateFormatter = createDateKeyFormatter(timeZone);
    const range = resolveAnalyticsRange(options, now, dateFormatter);
    const filters = normalizeAnalyticsFilters(options.filters);
    const allCards = document.columns.flatMap((column) => column.cards.map((card) => ({
      ...card,
      columnId: column.id,
      assignee: card.detailValues.assignee || null,
    })));
    const cards = allCards.filter((card) => cardMatchesFilters(card, filters));
    const cardsById = new Map(cards.map((card) => [card.id, card]));
    const indexedEvents = indexAnalyticsEvents(historyEvents, dateFormatter)
      .filter((item) => eventMatchesFilters(item.record, cardsById, filters));
    const history = analyzeHistory(indexedEvents, cardsById, now);
    const activeCards = cards.filter((card) => card.columnId !== "done");
    const status = Object.fromEntries(COLUMNS.map((column) => [column.id, 0]));
    const priority = { P1: 0, P2: 0, P3: 0, P4: 0 };
    const entities = {};
    const assignees = {};

    cards.forEach((card) => {
      status[card.columnId] += 1;
      priority[card.priority] += 1;
      entities[card.area] = (entities[card.area] || 0) + 1;
      const key = card.assignee || "unassigned";
      assignees[key] = (assignees[key] || 0) + 1;
    });

    const daily = range.dateKeys.map((date) => ({
      date,
      activity: 0,
      created: 0,
      completed: 0,
      reopened: 0,
      activityCardIds: [],
      createdCardIds: [],
      completedCardIds: [],
      reopenedCardIds: [],
    }));
    const dailyByDate = new Map(daily.map((bucket) => [bucket.date, bucket]));
    const previous = { activity: 0, created: 0, completed: 0, reopened: 0 };
    const rangeEvents = [];

    indexedEvents.forEach((item) => {
      if (item.record.event === "baseline") {
        return;
      }
      const bucket = dailyByDate.get(item.date);
      const counters = bucket || (isDateInRange(item.date, range.previousStart, range.previousEnd) ? previous : null);
      if (!counters) {
        return;
      }
      if (bucket) {
        rangeEvents.push(item);
      }
      counters.activity += 1;
      if (counters.activityCardIds) counters.activityCardIds.push(item.record.card);
      if (isCreated(item.record)) {
        counters.created += 1;
        if (counters.createdCardIds) counters.createdCardIds.push(item.record.card);
      }
      if (isCompletion(item.record)) {
        counters.completed += 1;
        if (counters.completedCardIds) counters.completedCardIds.push(item.record.card);
      }
      if (isReopen(item.record)) {
        counters.reopened += 1;
        if (counters.reopenedCardIds) counters.reopenedCardIds.push(item.record.card);
      }
    });

    const cycleTimes = completedFlowTimes(history.eventsByCard);
    const aging = buildAging(activeCards, history.cardStates, history.lastMeaningfulEventByCard, now);
    const quality = buildDataQuality(activeCards, history, now);
    const workload = buildWorkload(activeCards, rangeEvents, cardsById);
    const cumulativeFlow = buildCumulativeFlow(indexedEvents, range);
    const completedInRange = daily.reduce((sum, bucket) => sum + bucket.completed, 0);
    const createdInRange = daily.reduce((sum, bucket) => sum + bucket.created, 0);
    const activityInRange = daily.reduce((sum, bucket) => sum + bucket.activity, 0);
    const reworkCount = daily.reduce((sum, bucket) => sum + bucket.reopened, 0);
    const periodComparison = {
      current: { activity: activityInRange, created: createdInRange, completed: completedInRange, reopened: reworkCount },
      previous,
      completionChange: completedInRange - previous.completed,
      netWorkChange: createdInRange - completedInRange,
    };
    const insights = buildInsights({
      activeCards,
      status,
      aging,
      quality,
      cumulativeFlow,
      periodComparison,
      reworkCount,
    });
    const forecast = buildForecast(activeCards.length, daily, range, options.forecastDate);
    const historySince = indexedEvents.length > 0
      ? indexedEvents.reduce((earliest, item) => item.timestamp < earliest.timestamp ? item : earliest).record.at
      : null;
    const recent = [...rangeEvents]
      .sort((left, right) => right.timestamp - left.timestamp || right.index - left.index)
      .slice(0, 12)
      .map((item) => item.record);

    return {
      total: cards.length,
      active: activeCards.length,
      done: status.done,
      blocked: status.blocked,
      completionRate: cards.length === 0 ? 0 : Math.round((status.done / cards.length) * 100),
      activeEntities: new Set(activeCards.map((card) => card.area)).size,
      transitions: rangeEvents.filter((item) => item.record.event === "moved").length,
      completedInRange,
      createdInRange,
      activityInRange,
      reworkCount,
      medianCycleDays: cycleTimes.cycle.medianDays,
      status,
      priority,
      entities,
      assignees,
      daily,
      throughput: aggregateAnalyticsBuckets(daily, options.aggregation),
      cumulativeFlow,
      leadTime: cycleTimes.lead,
      cycleTime: cycleTimes.cycle,
      timeInStatus: history.timeInStatus,
      aging,
      quality,
      workload,
      insights,
      forecast,
      comparison: periodComparison,
      recent,
      cards: cards.map((card) => analyticsCard(card)),
      historySince,
      historyEvents: indexedEvents.length,
      rangeDays: range.days,
      metadata: {
        timeZone,
        range,
        filters,
        historyCoverage: historySince
          ? "History-derived metrics exclude unrecorded activity before the first ledger event."
          : "No history is available yet. Time-based metrics need future recorded changes.",
      },
      definitions: {
        completion: "A completion is a created or moved event whose destination is Done.",
        leadTime: "Lead time runs from a recorded creation to the first recorded completion. Baselines are excluded.",
        cycleTime: "Cycle time runs from the first recorded move to Doing to the first recorded completion. Baselines are excluded.",
        aging: "Age runs from the latest recorded entry into the current status. A baseline is an observed lower bound, not a start date.",
        timeInStatus: "Only intervals with a recorded non-baseline entry and exit are included.",
        forecast: "Forecasts use observed completion throughput and describe a range, not a delivery promise.",
      },
    };
  }

  function resolveAnalyticsTimeZone(timeZone) {
    const candidate = typeof timeZone === "string" && timeZone.trim()
      ? timeZone
      : Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
      return candidate;
    } catch {
      return "Etc/UTC";
    }
  }

  function createDateKeyFormatter(timeZone) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  function analyticsDateKey(date, formatter) {
    const parts = Object.fromEntries(formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function resolveAnalyticsRange(options, now, formatter) {
    const end = normalizeDateKey(options.endDate) || analyticsDateKey(now, formatter);
    const requestedStart = normalizeDateKey(options.startDate);
    const requestedDays = Number.isInteger(options.days) && options.days > 0 ? options.days : 30;
    const start = requestedStart || addDaysToDateKey(end, -(requestedDays - 1));
    if (start > end) {
      throw new Error("Analytics start date must not be after its end date.");
    }
    const days = dateKeyDistance(start, end) + 1;
    if (days > 3660) {
      throw new Error("Analytics date ranges cannot exceed ten years.");
    }
    return {
      start,
      end,
      days,
      dateKeys: Array.from({ length: days }, (_, index) => addDaysToDateKey(start, index)),
      previousStart: addDaysToDateKey(start, -days),
      previousEnd: addDaysToDateKey(start, -1),
    };
  }

  function normalizeDateKey(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value : null;
  }

  function addDaysToDateKey(dateKey, days) {
    const date = new Date(`${dateKey}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function dateKeyDistance(start, end) {
    return Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000);
  }

  function normalizeAnalyticsFilters(filters = {}) {
    return {
      statuses: normalizeFilterValues(filters.statuses, COLUMNS.map((column) => column.id)),
      priorities: normalizeFilterValues(filters.priorities, ["P1", "P2", "P3", "P4"]),
      areas: normalizeFilterValues(filters.areas),
      assignees: normalizeFilterValues(filters.assignees, undefined, true),
      search: typeof filters.search === "string" ? filters.search.trim().toLocaleLowerCase() : "",
    };
  }

  function normalizeFilterValues(values, allowed, allowUnassigned = false) {
    if (!Array.isArray(values) || values.length === 0) {
      return [];
    }
    return [...new Set(values.filter((value) => typeof value === "string"
      && (allowUnassigned ? value === "unassigned" || value : true)
      && (!allowed || allowed.includes(value))))];
  }

  function cardMatchesFilters(card, filters) {
    if (filters.statuses.length > 0 && !filters.statuses.includes(card.columnId)) return false;
    if (filters.priorities.length > 0 && !filters.priorities.includes(card.priority)) return false;
    if (filters.areas.length > 0 && !filters.areas.includes(card.area)) return false;
    const assignee = card.assignee || "unassigned";
    if (filters.assignees.length > 0 && !filters.assignees.includes(assignee)) return false;
    if (filters.search) {
      const value = [card.id, card.title, card.area, card.assignee, card.detailValues.description]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      if (!value.includes(filters.search)) return false;
    }
    return true;
  }

  function eventMatchesFilters(event, cardsById, filters) {
    if (cardsById.has(event.card)) {
      return true;
    }
    if (filters.statuses.length > 0 && !filters.statuses.includes(event.to || event.from || "")) return false;
    if (filters.priorities.length > 0 && !filters.priorities.includes(event.priority)) return false;
    if (filters.areas.length > 0 && !filters.areas.includes(event.area)) return false;
    const assignee = event.assignee || "unassigned";
    if (filters.assignees.length > 0 && !filters.assignees.includes(assignee)) return false;
    if (filters.search) {
      const value = [event.card, event.title, event.area, event.assignee].filter(Boolean).join(" ").toLocaleLowerCase();
      if (!value.includes(filters.search)) return false;
    }
    return true;
  }

  function indexAnalyticsEvents(historyEvents, formatter) {
    return historyEvents.map((record, index) => {
      const timestamp = new Date(record.at);
      return {
        record,
        index,
        timestamp,
        date: Number.isFinite(timestamp.valueOf()) ? analyticsDateKey(timestamp, formatter) : null,
      };
    }).filter((item) => item.date);
  }

  function isDateInRange(date, start, end) {
    return date >= start && date <= end;
  }

  function isCreated(event) {
    return event.event === "created";
  }

  function isCompletion(event) {
    return (event.event === "created" || event.event === "moved") && event.to === "done";
  }

  function isReopen(event) {
    return event.event === "moved" && event.from === "done" && event.to && event.to !== "done";
  }

  function analyzeHistory(indexedEvents, cardsById, now) {
    const eventsByCard = new Map();
    indexedEvents.forEach((item) => {
      const events = eventsByCard.get(item.record.card) || [];
      events.push(item);
      eventsByCard.set(item.record.card, events);
    });

    const cardStates = new Map();
    const timeSamples = Object.fromEntries(COLUMNS.map((column) => [column.id, []]));
    const issues = [];
    const lastMeaningfulEventByCard = new Map();
    eventsByCard.forEach((events, cardId) => {
      events.sort((left, right) => left.timestamp - right.timestamp || left.index - right.index);
      let state = null;
      let startedAt = null;
      let startType = null;
      events.forEach((item) => {
        const event = item.record;
        if (event.event !== "baseline") {
          lastMeaningfulEventByCard.set(cardId, item);
        }
        if (event.from && state && event.from !== state) {
          issues.push({
            card: cardId,
            message: `Recorded from ${event.from}, but the prior known state is ${state}.`,
          });
        }
        const nextState = event.event === "deleted" ? null : event.to || state;
        if (nextState === state) {
          return;
        }
        addStatusDuration(timeSamples, state, startedAt, startType, item.timestamp);
        state = nextState;
        startedAt = nextState ? item.timestamp : null;
        startType = nextState ? event.event : null;
      });
      if (cardsById.has(cardId) && state === cardsById.get(cardId).columnId) {
        addStatusDuration(timeSamples, state, startedAt, startType, now);
        cardStates.set(cardId, { state, startedAt, startType, lastAt: events.at(-1)?.timestamp || null });
      }
    });

    return {
      eventsByCard,
      cardStates,
      issues,
      lastMeaningfulEventByCard,
      timeInStatus: COLUMNS.map((column) => ({
        status: column.id,
        ...durationStatistics(timeSamples[column.id]),
      })),
    };
  }

  function addStatusDuration(samples, status, startedAt, startType, endedAt) {
    if (!status || !startedAt || startType === "baseline") {
      return;
    }
    const durationDays = Math.max(0, (endedAt - startedAt) / 86400000);
    if (Number.isFinite(durationDays)) {
      samples[status].push(durationDays);
    }
  }

  function completedFlowTimes(eventsByCard) {
    const lead = [];
    const cycle = [];
    eventsByCard.forEach((events) => {
      let createdAt = null;
      let doingAt = null;
      let completed = false;
      events.forEach((item) => {
        const event = item.record;
        if (event.event === "created" && !createdAt) {
          createdAt = item.timestamp;
        }
        if (event.to === "doing" && event.event !== "baseline" && !doingAt) {
          doingAt = item.timestamp;
        }
        if (!completed && isCompletion(event)) {
          if (createdAt) {
            lead.push(Math.max(0, (item.timestamp - createdAt) / 86400000));
          }
          if (doingAt) {
            cycle.push(Math.max(0, (item.timestamp - doingAt) / 86400000));
          }
          completed = true;
        }
      });
    });
    return { lead: durationStatistics(lead), cycle: durationStatistics(cycle) };
  }

  function durationStatistics(values) {
    if (values.length === 0) {
      return { count: 0, averageDays: null, medianDays: null, p85Days: null };
    }
    return {
      count: values.length,
      averageDays: roundOne(values.reduce((sum, value) => sum + value, 0) / values.length),
      medianDays: percentile(values, 50),
      p85Days: percentile(values, 85),
    };
  }

  function percentile(values, percent) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const position = (percent / 100) * (sorted.length - 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return roundOne(sorted[lower] + ((sorted[upper] - sorted[lower]) * (position - lower)));
  }

  function roundOne(value) {
    return Math.round(value * 10) / 10;
  }

  function buildAging(activeCards, cardStates, lastMeaningfulEventByCard, now) {
    const known = [];
    const unknown = [];
    activeCards.forEach((card) => {
      const state = cardStates.get(card.id);
      if (!state || !state.startedAt) {
        unknown.push({ ...analyticsCard(card), reason: "No recorded entry into the current status." });
        return;
      }
      known.push({
        ...analyticsCard(card),
        ageDays: roundOne(Math.max(0, (now - state.startedAt) / 86400000)),
        lowerBound: state.startType === "baseline",
        basis: state.startType === "baseline" ? "Observed baseline" : `Entered ${card.columnId}`,
        lastActivityAt: lastMeaningfulEventByCard.get(card.id)?.record.at || null,
      });
    });
    known.sort((left, right) => right.ageDays - left.ageDays || left.id.localeCompare(right.id));
    return {
      items: known,
      unknown,
      stale: known.filter((item) => item.ageDays >= 14),
      byStatus: Object.fromEntries(COLUMNS
        .filter((column) => column.id !== "done")
        .map((column) => [column.id, known.filter((item) => item.columnId === column.id)])),
    };
  }

  function buildDataQuality(activeCards, history, now) {
    const missingDescriptions = activeCards
      .filter((card) => !card.detailValues.description.trim())
      .map(analyticsCard);
    const unassigned = activeCards
      .filter((card) => !card.assignee)
      .map(analyticsCard);
    const stale = activeCards
      .map((card) => {
        const item = history.lastMeaningfulEventByCard.get(card.id);
        return item
          ? { ...analyticsCard(card), staleDays: roundOne(Math.max(0, (now - item.timestamp) / 86400000)) }
          : { ...analyticsCard(card), staleDays: null, reason: "No recorded activity." };
      })
      .filter((item) => item.staleDays === null || item.staleDays >= 14);
    const titleGroups = new Map();
    activeCards.forEach((card) => {
      const key = card.title.trim().replace(/\s+/g, " ").toLocaleLowerCase();
      const group = titleGroups.get(key) || [];
      group.push(analyticsCard(card));
      titleGroups.set(key, group);
    });
    const duplicates = [...titleGroups.values()].filter((group) => group.length > 1);
    return {
      missingDescriptions,
      unassigned,
      stale,
      duplicates,
      historyIssues: history.issues,
      summary: {
        missingDescriptions: missingDescriptions.length,
        unassigned: unassigned.length,
        stale: stale.length,
        duplicateGroups: duplicates.length,
        historyIssues: history.issues.length,
      },
    };
  }

  function buildWorkload(activeCards, rangeEvents, cardsById) {
    const entries = new Map();
    const include = (assignee) => {
      const key = assignee || "unassigned";
      if (!entries.has(key)) {
        entries.set(key, { assignee: key, active: 0, blocked: 0, completed: 0, cardIds: [] });
      }
      return entries.get(key);
    };
    activeCards.forEach((card) => {
      const item = include(card.assignee);
      item.active += 1;
      if (card.columnId === "blocked") item.blocked += 1;
      item.cardIds.push(card.id);
    });
    rangeEvents.filter((item) => isCompletion(item.record)).forEach((item) => {
      const card = cardsById.get(item.record.card);
      include(item.record.assignee || card?.assignee).completed += 1;
    });
    return [...entries.values()].sort((left, right) => right.active - left.active || left.assignee.localeCompare(right.assignee));
  }

  function buildCumulativeFlow(indexedEvents, range) {
    const states = new Map();
    const byDate = new Map();
    indexedEvents.forEach((item) => {
      const events = byDate.get(item.date) || [];
      events.push(item);
      byDate.set(item.date, events);
    });
    [...byDate.entries()]
      .filter(([date]) => date < range.start)
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([, events]) => events.forEach((item) => applyStateEvent(states, item.record)));

    return range.dateKeys.map((date) => {
      (byDate.get(date) || [])
        .sort((left, right) => left.timestamp - right.timestamp || left.index - right.index)
        .forEach((item) => applyStateEvent(states, item.record));
      const counts = Object.fromEntries(COLUMNS.map((column) => [column.id, 0]));
      states.forEach((status) => {
        if (status) counts[status] += 1;
      });
      return { date, ...counts, known: [...states.values()].filter(Boolean).length };
    });
  }

  function applyStateEvent(states, event) {
    if (event.event === "deleted") {
      states.delete(event.card);
    } else if (event.to && COLUMNS.some((column) => column.id === event.to)) {
      states.set(event.card, event.to);
    }
  }

  function aggregateAnalyticsBuckets(daily, aggregation) {
    const mode = ["day", "week", "month"].includes(aggregation) ? aggregation : "day";
    if (mode === "day") {
      return daily.map((bucket) => ({ key: bucket.date, ...bucket }));
    }
    const buckets = new Map();
    daily.forEach((bucket) => {
      const key = mode === "week" ? startOfWeek(bucket.date) : bucket.date.slice(0, 7);
      const target = buckets.get(key) || {
        key,
        activity: 0,
        created: 0,
        completed: 0,
        reopened: 0,
        activityCardIds: [],
        createdCardIds: [],
        completedCardIds: [],
        reopenedCardIds: [],
      };
      target.activity += bucket.activity;
      target.created += bucket.created;
      target.completed += bucket.completed;
      target.reopened += bucket.reopened;
      target.activityCardIds.push(...bucket.activityCardIds);
      target.createdCardIds.push(...bucket.createdCardIds);
      target.completedCardIds.push(...bucket.completedCardIds);
      target.reopenedCardIds.push(...bucket.reopenedCardIds);
      buckets.set(key, target);
    });
    return [...buckets.values()];
  }

  function startOfWeek(dateKey) {
    const date = new Date(`${dateKey}T00:00:00Z`);
    const offset = (date.getUTCDay() + 6) % 7;
    return addDaysToDateKey(dateKey, -offset);
  }

  function buildInsights({ activeCards, status, aging, quality, cumulativeFlow, periodComparison, reworkCount }) {
    const insights = [];
    if (status.doing > 3) {
      insights.push({
        id: "wip-limit",
        tone: "warning",
        title: "Doing exceeds its WIP limit",
        detail: `${status.doing} items are in Doing; the board limit is 3.`,
        action: "Review active work and return or finish an item before pulling more.",
        cardIds: activeCards.filter((card) => card.columnId === "doing").map((card) => card.id),
      });
    }
    if (status.blocked > 0) {
      insights.push({
        id: "blocked-work",
        tone: "warning",
        title: "Blocked work needs attention",
        detail: status.blocked === 1
          ? "1 active item is waiting for review or a dependency."
          : `${status.blocked} active items are waiting for review or dependencies.`,
        action: "Review blocked work and identify the next unblocker.",
        cardIds: activeCards.filter((card) => card.columnId === "blocked").map((card) => card.id),
      });
    }
    if (aging.stale.length > 0) {
      insights.push({
        id: "aging-work",
        tone: "warning",
        title: "Aging work is accumulating",
        detail: `${aging.stale.length} active item${aging.stale.length === 1 ? "" : "s"} have been in their current state for at least 14 recorded days.`,
        action: "Review aging work and decide whether to unblock, split, or return it to the queue.",
        cardIds: aging.stale.map((item) => item.id),
      });
    }
    if (quality.summary.unassigned > 0) {
      insights.push({
        id: "unassigned-work",
        tone: "info",
        title: "Active work is unassigned",
        detail: quality.summary.unassigned === 1
          ? "1 active item has no assignee."
          : `${quality.summary.unassigned} active items have no assignee.`,
        action: "Assign ownership where that will help work move.",
        cardIds: quality.unassigned.map((item) => item.id),
      });
    }
    if (reworkCount > 0) {
      insights.push({
        id: "rework",
        tone: "info",
        title: "Completed work returned to the board",
        detail: `${reworkCount} recorded reopen${reworkCount === 1 ? "" : "s"} occurred in the selected period.`,
        action: "Review reopened items for acceptance or handoff patterns.",
        cardIds: [],
      });
    }
    if (cumulativeFlow.length > 1) {
      const start = cumulativeFlow[0];
      const end = cumulativeFlow.at(-1);
      if (end.next > start.next) {
        insights.push({
          id: "growing-queue",
          tone: "info",
          title: "The ready queue grew",
          detail: `Next increased from ${start.next} to ${end.next} recorded items during the selected period.`,
          action: "Confirm whether the queue reflects useful options or too much committed work.",
          cardIds: activeCards.filter((card) => card.columnId === "next").map((card) => card.id),
        });
      }
    }
    if (periodComparison.previous.completed > 0 && periodComparison.completionChange < 0) {
      insights.push({
        id: "throughput-change",
        tone: "info",
        title: "Completion throughput decreased",
        detail: `${Math.abs(periodComparison.completionChange)} fewer recorded completion${Math.abs(periodComparison.completionChange) === 1 ? "" : "s"} than the preceding equivalent period.`,
        action: "Review aging and blocked work before changing individual commitments.",
        cardIds: [],
      });
    }
    return insights;
  }

  function buildForecast(activeCount, daily, range, forecastDate) {
    const completed = daily.reduce((sum, bucket) => sum + bucket.completed, 0);
    if (range.days < 14 || completed < 5) {
      return {
        available: false,
        reason: "At least 14 days and 5 recorded completions are required for a cautious throughput forecast.",
      };
    }
    const weekly = aggregateAnalyticsBuckets(daily, "week").map((bucket) => bucket.completed);
    const slow = percentile(weekly, 25);
    const typical = percentile(weekly, 50);
    const fast = percentile(weekly, 75);
    const target = normalizeDateKey(forecastDate);
    const targetDays = target ? Math.max(0, dateKeyDistance(range.end, target)) : null;
    return {
      available: typical !== null && typical > 0,
      reason: typical !== null && typical > 0 ? null : "Recorded throughput is too uneven to form a useful range.",
      weeklyThroughput: { slow, typical, fast },
      finishRangeWeeks: {
        earliest: fast > 0 ? Math.ceil(activeCount / fast) : null,
        latest: slow > 0 ? Math.ceil(activeCount / slow) : null,
      },
      whatCanFinish: targetDays === null || typical === null
        ? null
        : Math.floor((typical / 7) * targetDays),
      targetDate: target,
    };
  }

  function analyticsCard(card) {
    return {
      id: card.id,
      title: card.title,
      columnId: card.columnId,
      priority: card.priority,
      area: card.area,
      assignee: card.assignee || card.detailValues.assignee || null,
    };
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