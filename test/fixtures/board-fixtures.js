'use strict';

/**
 * Deterministic board fixtures shared by every test layer.
 *
 * Every helper that rewrites a section fails loudly when its anchor is missing.
 * A silent `String.prototype.replace` no-op previously let two analytics tests
 * assert against a board that never received the cards they described, so the
 * suite stayed green while the fixtures were wrong and then failed only after an
 * unrelated heading change. Anchors are contract, not convenience.
 */

const COLUMN_HEADINGS = ['Inbox', 'Next', 'Doing', 'Review / Blocked', 'Done'];

const EMPTY_MARKER = '<!-- empty -->';

const CONFIG = `# Config

\`\`\`json
{"version":1,"workspace":{"name":"Test"},"appearance":{"accent":"#e24a35","density":"comfortable"},"entities":[{"id":"internal","name":"Internal","color":"#167d74"}]}
\`\`\`
`;

const HISTORY = '# History\n\n## Events\n';

const EMPTY_BOARD = `# Test Board\n\n${COLUMN_HEADINGS
  .map((heading) => `---\n\n## ${heading}\n\n${EMPTY_MARKER}\n`)
  .join('\n')}`;

/**
 * Replace the body of one board column.
 *
 * @throws {Error} when the column heading is absent, so a renamed or removed
 *   column can never produce a fixture that silently keeps its default body.
 */
function withColumn(source, heading, body) {
  const anchor = `## ${heading}\n\n${EMPTY_MARKER}`;
  if (!source.includes(anchor)) {
    throw new Error(
      `Board fixture anchor "${anchor.replace(/\n/g, '\\n')}" is missing. `
        + `Known columns: ${COLUMN_HEADINGS.join(', ')}.`,
    );
  }
  return source.replace(anchor, `## ${heading}\n\n${body}`);
}

/** Build a board from a map of column heading to Markdown body. */
function buildBoard(columns = {}) {
  return Object.entries(columns).reduce(
    (source, [heading, body]) => withColumn(source, heading, body),
    EMPTY_BOARD,
  );
}

/** Place one Markdown card body in a single column. */
function boardWith(cardLine, column = 'Inbox') {
  return buildBoard({ [column]: cardLine });
}

/** Two Inbox cards joined by the supplied separator, for blank-line diagnostics. */
function boardWithTwoCards(separator = '\n') {
  return boardWith([
    '- [ ] AO-001 — First outcome · P1 · area:internal\n    - **Description:** First description.',
    '- [ ] AO-002 — Second outcome · P2 · area:internal\n    - **Description:** Second description.',
  ].join(separator));
}

/**
 * A board whose Doing heading still carries the legacy `(WIP <= 3)` suffix.
 * Existing boards keep that heading, so parsing must continue to accept it.
 */
function legacyBoardWithManyDoingCards(cardCount) {
  const doingCards = Array.from({ length: cardCount }, (_, index) => (
    `- [ ] AO-${String(index + 1).padStart(3, '0')} — Doing outcome ${index + 1} · P2 · area:internal`
  )).join('\n\n');
  return buildBoard({
    Inbox: '- [ ] AO-101 — Inbox outcome · P2 · area:internal',
    Doing: `${doingCards}`,
  }).replace('## Doing\n', '## Doing `(WIP <= 3)`\n');
}

/** Render a card line without needing to remember the separator characters. */
function card({ id, title, priority = 'P2', area = 'internal', done = false, details = [] }) {
  const checkbox = done ? 'x' : ' ';
  const lines = [`- [${checkbox}] ${id} — ${title} · ${priority} · area:${area}`];
  for (const [label, value] of details) {
    lines.push(`    - **${label}:** ${value}`);
  }
  return lines.join('\n');
}

module.exports = {
  CONFIG,
  COLUMN_HEADINGS,
  EMPTY_BOARD,
  EMPTY_MARKER,
  HISTORY,
  boardWith,
  boardWithTwoCards,
  buildBoard,
  card,
  legacyBoardWithManyDoingCards,
  withColumn,
};
