const assert = require('node:assert/strict');
const test = require('node:test');
const model = require('../../src/webview/board-model.js');
const {
  CONFIG,
  EMPTY_BOARD,
  HISTORY,
  boardWith,
  boardWithTwoCards,
  buildBoard,
  card,
  legacyBoardWithManyDoingCards,
} = require('../fixtures/board-fixtures.js');

test('empty board round-trips byte-for-byte', () => {
  const board = model.parseBoard(EMPTY_BOARD);
  assert.equal(model.serializeBoard(board), EMPTY_BOARD);
  assert.equal(board.columns.length, 5);
});

test('accepts, orders, and restores large legacy Doing columns', () => {
  const source = legacyBoardWithManyDoingCards(100);
  assert.doesNotThrow(() => model.validateBundleSources(source, CONFIG, HISTORY));

  const board = model.parseBoard(source);
  model.moveCard(board, 'AO-001', 'doing', 75);
  const doing = board.columns.find((column) => column.id === 'doing');
  assert.deepEqual(
    doing.cards.slice(73, 76).map((card) => card.id),
    ['AO-075', 'AO-001', 'AO-076'],
  );

  model.moveCard(board, 'AO-101', 'doing', 50);
  const created = model.createCard(board, {
    title: 'Created in a large column',
    columnId: 'doing',
    area: 'internal',
  });
  doing.cards.push(created);
  model.validateBoard(board);
  assert.equal(doing.cards.length, 102);
  assert.equal(doing.cards[50].id, 'AO-101');

  const saved = model.serializeBoard(board);
  const restored = model.parseBoard(saved);
  assert.deepEqual(
    restored.columns.find((column) => column.id === 'doing').cards.map((card) => card.id),
    doing.cards.map((card) => card.id),
  );
  assert.doesNotThrow(() => model.validateBundleSources(saved, CONFIG, HISTORY));
});

test('checkbox state must match status', () => {
  assert.throws(
    () => model.parseBoard(boardWith('- [x] AO-001 — Open work · P2 · area:internal')),
    /must use \[ \] outside Done/,
  );
  assert.throws(
    () => model.parseBoard(boardWith('- [ ] AO-001 — Closed work · P2 · area:internal', 'Done')),
    /must use \[x\] in Done/,
  );
});

test('historical card IDs remain reserved', () => {
  const board = model.parseBoard(boardWith('- [ ] AO-004 — Current work · P2 · area:internal'));
  const card = model.createCard(board, {
    title: 'New work',
    historyEvents: [{ card: 'AO-029' }],
  });
  assert.equal(card.id, 'AO-030');
});

test('legacy customer configuration migrates to the stable entities field', () => {
  const legacy = `# Config\n\n\`\`\`json\n${JSON.stringify({
    version: 1,
    workspace: { name: 'Legacy' },
    appearance: { accent: '#e24a35', density: 'comfortable' },
    customers: [{ id: 'internal', name: 'Internal', color: '#167d74' }],
  }, null, 2)}\n\`\`\`\n`;
  const parsed = model.parseConfig(legacy);
  const serialized = model.serializeConfig(legacy, parsed);

  assert.equal(parsed.entities[0].id, 'internal');
  assert.deepEqual(parsed.people, []);
  assert.equal(Object.hasOwn(parsed, 'customers'), false);
  assert.equal(serialized.includes('"customers"'), false);
});

test('configures, persists, and reloads renamed and reordered board columns without losing cards', () => {
  const source = buildBoard({
    Inbox: '- [ ] AO-001 — Capture evidence · P2 · area:internal',
    Doing: [
      '- [ ] AO-002 — Prepare review · P2 · area:internal',
      '- [ ] AO-003 — Publish decision · P1 · area:internal',
    ].join('\n\n'),
  });
  const board = model.parseBoard(source);
  const config = model.parseConfig(CONFIG);
  config.columns = [
    { id: 'doing', name: 'In delivery' },
    { id: 'inbox', name: 'Evidence queue' },
    { id: 'done', name: 'Accepted' },
    { id: 'release', name: 'Release follow-through' },
  ];

  const configured = model.reconfigureColumns(board, config.columns);
  const configuredSource = model.serializeBoard(configured);
  const configuredConfig = model.serializeConfig(CONFIG, config);
  const reloaded = model.parseBoard(configuredSource);

  assert.deepEqual(reloaded.columns.map((column) => [column.id, column.label]), [
    ['doing', 'In delivery'],
    ['inbox', 'Evidence queue'],
    ['done', 'Accepted'],
    ['release', 'Release follow-through'],
  ]);
  assert.deepEqual(reloaded.columns[0].cards.map((card) => card.id), ['AO-002', 'AO-003']);
  assert.deepEqual(reloaded.columns[1].cards.map((card) => card.id), ['AO-001']);
  assert.match(configuredSource, /## In delivery <!-- ledgerboard-column:doing -->/);
  assert.doesNotThrow(() => model.validateBundleSources(configuredSource, configuredConfig, HISTORY));
});

test('reconfiguring columns preserves trailing board notes', () => {
  const source = `${buildBoard()}
## Notes

Keep this operational context after the workflow.
`;
  const board = model.parseBoard(source);
  const config = model.parseConfig(CONFIG);
  config.columns[0].name = 'Capture';

  const configuredSource = model.serializeBoard(model.reconfigureColumns(board, config.columns));

  assert.match(configuredSource, /## Notes\n\nKeep this operational context after the workflow\./);
});

test('rejects invalid column configuration and unresolved non-empty column removal', () => {
  const board = model.parseBoard(buildBoard({
    Doing: '- [ ] AO-001 — Prepare review · P2 · area:internal',
  }));
  const config = model.parseConfig(CONFIG);
  config.columns = [
    { id: 'inbox', name: 'Inbox' },
    { id: 'done', name: 'Done' },
  ];

  assert.throws(
    () => model.reconfigureColumns(board, config.columns),
    /Doing still contains 1 ticket/,
  );
  assert.throws(
    () => model.validateConfig({
      ...config,
      columns: Array.from({ length: 11 }, (_, index) => ({
        id: `column-${index + 1}`,
        name: `Column ${index + 1}`,
      })),
    }),
    /A board can have a maximum of 10 columns/,
  );
  assert.throws(
    () => model.validateConfig({
      ...config,
      columns: [
        { id: 'one', name: ' Ready ' },
        { id: 'two', name: 'ready' },
      ],
    }),
    /Column names must be unique/,
  );
  assert.throws(
    () => model.validateConfig({
      ...config,
      columns: [{ id: 'one', name: 'x'.repeat(41) }],
    }),
    /40 characters or fewer/,
  );
  assert.throws(
    () => model.validateConfig({
      ...config,
      columns: [{ id: 'one', name: 'Ready\nNow' }],
    }),
    /control characters or Markdown markers/,
  );
});

test('rejects malformed custom column markers and mismatched board configuration', () => {
  assert.throws(() => model.parseBoard('# Board\n'), /Expected at least one board column/);
  assert.equal(
    model.parseBoard(`\`\`\`markdown\n## Ignored <!-- ledgerboard-column:ignored -->\n\`\`\`\n\n${buildBoard()}`).columns.length,
    5,
  );
  assert.throws(
    () => model.parseBoard(buildBoard().replace(
      '## Inbox',
      '## Inbox <!-- ledgerboard-column:inbox -->',
    )),
    /marker in every heading/,
  );
  assert.throws(
    () => model.parseBoard([
      '# Board',
      '',
      '## Intake <!-- ledgerboard-column:intake -->',
      '',
      '<!-- empty -->',
      '',
      '---',
      '',
      '## Duplicate intake <!-- ledgerboard-column:intake -->',
      '',
      '<!-- empty -->',
      '',
    ].join('\n')),
    /Duplicate board column ID: intake/,
  );

  const columns = [
    { id: 'intake', name: 'Intake' },
    { id: 'delivery', name: 'Delivery' },
    { id: 'accepted', name: 'Accepted' },
  ];
  const boardSource = model.serializeBoard(
    model.reconfigureColumns(model.parseBoard(buildBoard()), columns),
  );
  const configSource = (updatedColumns) => {
    const config = model.parseConfig(CONFIG);
    config.columns = updatedColumns;
    return model.serializeConfig(CONFIG, config);
  };

  assert.throws(
    () => model.validateBundleSources(boardSource, configSource(columns.slice(1)), HISTORY),
    /columns do not match the configured column count/,
  );
  assert.throws(
    () => model.validateBundleSources(boardSource, configSource([
      { ...columns[0], id: 'queued' },
      ...columns.slice(1),
    ]), HISTORY),
    /does not match configured column/,
  );
  assert.throws(
    () => model.validateBundleSources(boardSource, configSource([
      { ...columns[0], name: 'Queued work' },
      ...columns.slice(1),
    ]), HISTORY),
    /must be named Queued work/,
  );
});

test('validates configurable column input and repairs card column identifiers', () => {
  const config = model.parseConfig(CONFIG);

  assert.throws(() => model.validateConfig(null), /must be an object/);
  assert.throws(() => model.validateConfig({ ...config, columns: null }), /requires a columns array/);
  assert.throws(() => model.validateConfig({ ...config, columns: [] }), /at least 1 column/);
  assert.throws(
    () => model.validateConfig({ ...config, columns: [{ id: 'not valid', name: 'Ready' }] }),
    /Invalid column ID/,
  );
  assert.throws(
    () => model.validateConfig({
      ...config,
      columns: [{ id: 'ready', name: 'Ready' }, { id: 'ready', name: 'Delivery' }],
    }),
    /Duplicate column ID/,
  );
  assert.throws(
    () => model.validateConfig({ ...config, columns: [{ id: 'ready', name: '   ' }] }),
    /Column names cannot be blank/,
  );

  const serialized = model.serializeConfig('', {
    ...config,
    columns: [{ id: 'ready', name: ' Ready ' }],
  });
  assert.match(serialized, /"name": "Ready"/);
  assert.throws(
    () => model.serializeConfig('', { ...config, columns: [null] }),
    /Invalid column ID/,
  );
  assert.throws(() => model.validateBoard({ columns: [] }), /between 1 and 10 columns/);

  const invalidId = model.parseBoard(buildBoard());
  invalidId.columns[0].id = 'not valid';
  assert.throws(() => model.validateBoard(invalidId), /Invalid board column ID/);

  const duplicateId = model.parseBoard(buildBoard());
  duplicateId.columns[1].id = duplicateId.columns[0].id;
  assert.throws(() => model.validateBoard(duplicateId), /Duplicate board column ID/);

  const board = model.parseBoard(boardWith('- [ ] AO-001 — Prepare review · P2 · area:internal'));
  board.columns[0].cards[0].columnId = 'stale-column';
  assert.doesNotThrow(() => model.validateBoard(board));
  assert.equal(board.columns[0].cards[0].columnId, 'inbox');
});

test('semantic diff records movement and edits separately', () => {
  const source = boardWith('- [ ] AO-001 — Prepare review · P2 · area:internal');
  const before = model.parseBoard(source);
  const after = model.parseBoard(source);
  const found = model.findCard(after, 'AO-001');
  found.card.priority = 'P1';
  model.moveCard(after, 'AO-001', 'next');
  const events = model.diffBoardEvents(before, after, '2026-07-21T10:00:00+12:00');

  assert.deepEqual(events.map((event) => event.event), ['moved', 'updated']);
  assert.deepEqual(events[1].changes, ['priority']);
});

test('assignees round-trip through cards and validate against configured people', () => {
  const source = boardWith(
    '- [ ] AO-001 — Prepare review · P2 · area:internal\n'
      + '    - **Description:** Prepare the review pack.\n'
      + '    - **Assignee:** alex-smith',
  );
  const config = CONFIG.replace(
    '"entities":[{"id":"internal","name":"Internal","color":"#167d74"}]',
    '"entities":[{"id":"internal","name":"Internal","color":"#167d74"}],"people":[{"id":"alex-smith","name":"Alex Smith","color":"#7257b5"}]',
  );
  const board = model.parseBoard(source);

  assert.equal(board.columns[0].cards[0].detailValues.assignee, 'alex-smith');
  assert.equal(model.serializeBoard(board), source);
  assert.doesNotThrow(() => model.validateBundleSources(source, config, HISTORY));
});

test('bundle validation reports assignees missing from the people directory', () => {
  const source = boardWith(
    '- [ ] AO-001 — Prepare review · P2 · area:internal\n'
      + '    - **Assignee:** missing-person',
  );

  assert.throws(
    () => model.validateBundleSources(source, CONFIG, HISTORY),
    /Missing person configuration: missing-person/,
  );
});

test('assignment changes record previous and current values', () => {
  const source = boardWith(
    '- [ ] AO-001 — Prepare review · P2 · area:internal\n'
      + '    - **Assignee:** alex-smith',
  );
  const before = model.parseBoard(source);
  const reassigned = model.parseBoard(source);
  reassigned.columns[0].cards[0].detailValues.assignee = 'sam-lee';
  const reassignment = model.diffBoardEvents(before, reassigned, '2026-07-21T10:00:00+12:00');

  assert.deepEqual(reassignment[0].changes, ['assignee']);
  assert.equal(reassignment[0].previousAssignee, 'alex-smith');
  assert.equal(reassignment[0].assignee, 'sam-lee');

  const unassigned = model.parseBoard(source);
  unassigned.columns[0].cards[0].detailValues.assignee = '';
  const unassignment = model.diffBoardEvents(before, unassigned, '2026-07-21T11:00:00+12:00');
  assert.equal(unassignment[0].previousAssignee, 'alex-smith');
  assert.equal(unassignment[0].assignee, null);
});

test('assignment history preserves an available actor', () => {
  const event = {
    at: '2026-07-21T10:00:00+12:00',
    card: 'AO-001',
    event: 'updated',
    to: 'inbox',
    changes: ['assignee'],
    previousAssignee: null,
    assignee: 'alex-smith',
    actor: 'Local editor',
    area: 'internal',
    priority: 'P2',
    title: 'Prepare review',
  };
  const history = model.appendHistory(HISTORY, [event]);

  assert.deepEqual(model.parseHistory(history).events[0], event);
});

test('append-only history preserves its exact prefix', () => {
  const source = '# Kanban History\n\n## Events\n';
  const event = {
    at: '2026-07-21T10:00:00+12:00',
    card: 'AO-001',
    event: 'created',
    to: 'inbox',
    area: 'internal',
    priority: 'P2',
    title: 'Prepare review',
  };
  const result = model.appendHistory(source, [event]);

  assert.ok(result.startsWith(source));
  assert.equal(model.parseHistory(result).events.length, 1);
});

test('adjacent cards require exactly one blank physical line', () => {
  const report = model.analyzeBoardSource(boardWithTwoCards('\n'));

  assert.equal(report.errors[0].code, 'card-separator');
  assert.equal(report.errors[0].line, 9);
  assert.match(report.errors[0].message, /Cards AO-001 and AO-002 must be separated by exactly one blank physical line/);
  assert.equal(report.canNormalize, true);
});

test('cards separated by one blank physical line round-trip exactly', () => {
  const source = boardWithTwoCards('\n\n');
  const report = model.analyzeBoardSource(source);

  assert.deepEqual(report.errors, []);
  assert.equal(report.isCanonical, true);
  assert.equal(report.canonicalSource, source);
});

test('extra blank lines between cards are diagnosed and normalized', () => {
  const source = boardWithTwoCards('\n\n\n');
  const report = model.analyzeBoardSource(source);
  const normalized = model.normalizeBoardSource(source);

  assert.equal(report.errors[0].code, 'card-separator');
  assert.match(report.errors[0].message, /found 2/);
  assert.equal(normalized.source, boardWithTwoCards('\n\n'));
  assert.equal(normalized.changed, true);
});

test('LF input round-trips as LF', () => {
  const source = boardWithTwoCards('\n\n');
  const report = model.analyzeBoardSource(source);

  assert.equal(report.newline, '\n');
  assert.equal(report.canonicalSource, source);
  assert.equal(report.canonicalSource.includes('\r\n'), false);
});

test('CRLF input round-trips as CRLF', () => {
  const source = boardWithTwoCards('\n\n').replace(/\n/g, '\r\n');
  const report = model.analyzeBoardSource(source);

  assert.equal(report.newline, '\r\n');
  assert.equal(report.canonicalSource, source);
  assert.equal(report.canonicalSource.replace(/\r\n/g, '').includes('\n'), false);
});

test('mixed line endings produce a specific normalizable error', () => {
  const source = boardWithTwoCards('\n\n').replace('\n', '\r\n');
  const report = model.analyzeBoardSource(source);

  assert.equal(report.errors[0].code, 'mixed-line-endings');
  assert.match(report.errors[0].message, /mixed line endings/);
  assert.equal(report.canNormalize, true);
  assert.equal(model.normalizeBoardSource(source).source.includes('\r\n'), false);
});

test('multiline descriptions normalize mixed input line endings before serializing', () => {
  const board = model.parseBoard(
    boardWith('- [ ] AO-001 — First ticket · P1 · area:internal'),
  );
  board.columns[0].cards[0].detailValues.description = 'First line.\r\nSecond line.\n\nFourth line.';

  const serialized = model.serializeBoard(board);
  const report = model.analyzeBoardSource(serialized);

  assert.match(
    serialized,
    /    - \*\*Description:\*\* First line\.\n      Second line\.\n      \n      Fourth line\./,
  );
  assert.equal(serialized.includes('\r'), false);
  assert.deepEqual(report.errors, []);
  assert.equal(
    model.parseBoard(serialized).columns[0].cards[0].detailValues.description,
    'First line.\nSecond line.\n\nFourth line.',
  );
});

test('rejects description continuations without six-space indentation', () => {
  const source = boardWith(
    '- [ ] AO-001 — First ticket · P1 · area:internal\n'
      + '    - **Description:** First line.\n'
      + '     Second physical line.',
  );
  const report = model.analyzeBoardSource(source);

  assert.equal(report.errors[0].code, 'description-continuation');
  assert.match(report.errors[0].message, /must use exactly six spaces/);
  assert.equal(report.canNormalize, false);
});

test('unsupported detail fields are preserved and warned', () => {
  const source = boardWith(
    '- [ ] AO-001 — First ticket · P1 · area:internal\n'
      + '    - **Description:** First description.\n'
      + '    - **Custom:** Preserved value.',
  );
  const report = model.analyzeBoardSource(source);

  assert.deepEqual(report.errors, []);
  assert.equal(report.warnings[0].code, 'unsupported-detail');
  assert.equal(report.canonicalSource, source);
});

test('duplicate card IDs are rejected without dropping either card', () => {
  const source = boardWithTwoCards('\n\n').replace('AO-002', 'AO-001');
  assert.throws(() => model.parseBoard(source), /Duplicate card ID AO-001/);
});

test('invalid checkbox markers report the source line', () => {
  const source = boardWith('- [o] AO-001 — Work in progress · P2 · area:internal');
  assert.throws(() => model.parseBoard(source), /Invalid card format on line 7/);
});

test('bundle validation reports missing labels', () => {
  const source = boardWith('- [ ] AO-001 — External ticket · P2 · area:missing');
  assert.throws(
    () => model.validateBundleSources(source, CONFIG, HISTORY),
    /Missing label configuration: missing/,
  );
});

test('duplicate label IDs are rejected', () => {
  const duplicate = CONFIG.replace(
    '"entities":[{"id":"internal","name":"Internal","color":"#167d74"}]',
    '"entities":[{"id":"internal","name":"Internal","color":"#167d74"},{"id":"internal","name":"Duplicate","color":"#7257b5"}]',
  );
  assert.throws(() => model.parseConfig(duplicate), /Duplicate label ID: internal/);
});

test('duplicate person IDs are rejected', () => {
  const duplicate = CONFIG.replace(
    '"entities":[{"id":"internal","name":"Internal","color":"#167d74"}]',
    '"entities":[{"id":"internal","name":"Internal","color":"#167d74"}],"people":['
      + '{"id":"alex-smith","name":"Alex Smith","color":"#7257b5"},'
      + '{"id":"alex-smith","name":"Duplicate","color":"#2e6ea6"}]',
  );
  assert.throws(() => model.parseConfig(duplicate), /Duplicate person ID: alex-smith/);
});

test('invalid label colors are rejected', () => {
  assert.throws(() => model.parseConfig(CONFIG.replace('#167d74', 'blue')), /Invalid color for internal/);
});

test('malformed history events report their line', () => {
  const history = `${HISTORY}    {"at":"not-a-date","card":"AO-001","event":"created"}\n`;
  assert.throws(() => model.parseHistory(history), /History event on line 4 requires an ISO timestamp/);
});

test('history rejects malformed recorded statuses', () => {
  const history = `${HISTORY}    {"at":"2026-01-01T10:00:00Z","card":"AO-001","event":"created","to":"not valid","area":"internal","priority":"P2","title":"Ticket"}\n`;
  assert.throws(() => model.parseHistory(history), /History event on line 4 has an invalid to status/);
});

test('normalization is idempotent for canonical boards', () => {
  const source = boardWithTwoCards('\n\n');
  const result = model.normalizeBoardSource(source);
  assert.equal(result.changed, false);
  assert.equal(result.source, source);
});

test('noncanonical formatting reports the first differing line', () => {
  const source = boardWith(
    '- [ ] AO-001 — First ticket · P1 · area:internal\n'
      + '    - **Description:** First description.   ',
  );
  const report = model.analyzeBoardSource(source);

  assert.equal(report.errors[0].code, 'noncanonical-formatting');
  assert.match(report.errors[0].message, /near line 8/);
  assert.match(report.errors[0].message, /Expected/);
  assert.equal(report.canNormalize, true);
});

test('analytics handles an empty board', () => {
  const analytics = model.buildAnalytics(model.parseBoard(EMPTY_BOARD), [], { now: '2026-01-15T12:00:00Z' });
  assert.equal(analytics.total, 0);
  assert.equal(analytics.completionRate, 0);
  assert.equal(analytics.medianCycleDays, null);
});

test('analytics handles an all-done board', () => {
  const source = boardWith('- [x] AO-001 — Finished ticket · P2 · area:internal', 'Done');
  const analytics = model.buildAnalytics(model.parseBoard(source), [], { now: '2026-01-15T12:00:00Z' });
  assert.equal(analytics.total, 1);
  assert.equal(analytics.done, 1);
  assert.equal(analytics.active, 0);
  assert.equal(analytics.completionRate, 100);
});

test('analytics derives explainable health, flow, aging, quality, and workload metrics', () => {
  const source = buildBoard({
    Inbox: '- [ ] AO-001 — Clarify scope · P3 · area:internal',
    Doing: '- [ ] AO-002 — Prepare review · P2 · area:internal\n'
      + '    - **Description:** Prepare the decision record.\n'
      + '    - **Assignee:** alex-smith',
    'Review / Blocked': '- [ ] AO-003 — Await dependency · P1 · area:internal',
    Done: '- [x] AO-004 — Publish ticket · P3 · area:internal\n'
      + '    - **Assignee:** alex-smith',
  });
  const event = (at, card, eventType, extra = {}) => ({
    at,
    card,
    event: eventType,
    area: 'internal',
    priority: 'P2',
    title: card,
    ...extra,
  });
  const events = [
    event('2026-01-01T10:00:00Z', 'AO-001', 'created', { to: 'inbox' }),
    event('2026-01-02T10:00:00Z', 'AO-002', 'created', { to: 'inbox', assignee: 'alex-smith' }),
    event('2026-01-03T10:00:00Z', 'AO-002', 'moved', { from: 'inbox', to: 'next', assignee: 'alex-smith' }),
    event('2026-01-05T10:00:00Z', 'AO-002', 'moved', { from: 'next', to: 'doing', assignee: 'alex-smith' }),
    event('2026-01-04T10:00:00Z', 'AO-003', 'created', { to: 'inbox' }),
    event('2026-01-06T10:00:00Z', 'AO-003', 'moved', { from: 'inbox', to: 'blocked' }),
    event('2026-01-01T10:00:00Z', 'AO-004', 'created', { to: 'inbox', assignee: 'alex-smith' }),
    event('2026-01-02T10:00:00Z', 'AO-004', 'moved', { from: 'inbox', to: 'doing', assignee: 'alex-smith' }),
    event('2026-01-07T10:00:00Z', 'AO-004', 'moved', { from: 'doing', to: 'done', assignee: 'alex-smith' }),
    event('2026-01-01T10:00:00Z', 'AO-005', 'created', { to: 'inbox' }),
    event('2026-01-02T10:00:00Z', 'AO-005', 'moved', { from: 'inbox', to: 'done' }),
    event('2026-01-04T10:00:00Z', 'AO-005', 'moved', { from: 'done', to: 'next' }),
  ];

  const analytics = model.buildAnalytics(model.parseBoard(source), events, {
    now: '2026-01-15T12:00:00Z',
    startDate: '2026-01-01',
    endDate: '2026-01-15',
    timeZone: 'Etc/UTC',
    aggregation: 'week',
  });

  assert.equal(analytics.total, 4);
  assert.equal(analytics.active, 3);
  assert.equal(analytics.status.doing, 1);
  assert.equal(analytics.status.blocked, 1);
  assert.equal(analytics.createdInRange, 5);
  assert.equal(analytics.completedInRange, 2);
  assert.equal(analytics.reworkCount, 1);
  assert.equal(analytics.leadTime.medianDays, 3.5);
  assert.equal(analytics.cycleTime.medianDays, 5);
  assert.equal(analytics.aging.items[0].id, 'AO-001');
  assert.equal(analytics.quality.summary.missingDescriptions, 2);
  assert.equal(analytics.quality.summary.unassigned, 2);
  assert.equal(analytics.workload.find((item) => item.assignee === 'alex-smith').active, 1);
  assert.equal(analytics.cumulativeFlow.at(-1).done, 1);
  assert.equal(analytics.throughput.length, 3);
  assert.equal(analytics.metadata.timeZone, 'Etc/UTC');
});

test('analytics filters current cards and their supporting history consistently', () => {
  const source = buildBoard({
    Doing: '- [ ] AO-001 — Prepare review · P2 · area:internal\n'
      + '    - **Assignee:** alex-smith',
    'Review / Blocked': '- [ ] AO-002 — Await dependency · P1 · area:internal',
  });
  const events = [
    { at: '2026-01-01T10:00:00Z', card: 'AO-001', event: 'created', to: 'doing', area: 'internal', priority: 'P2', title: 'Prepare review', assignee: 'alex-smith' },
    { at: '2026-01-02T10:00:00Z', card: 'AO-001', event: 'updated', to: 'doing', changes: ['title'], area: 'internal', priority: 'P2', title: 'Prepare review', assignee: 'alex-smith' },
    { at: '2026-01-01T10:00:00Z', card: 'AO-002', event: 'created', to: 'blocked', area: 'internal', priority: 'P1', title: 'Await dependency' },
  ];

  const analytics = model.buildAnalytics(model.parseBoard(source), events, {
    now: '2026-01-03T12:00:00Z',
    days: 3,
    timeZone: 'Etc/UTC',
    filters: {
      statuses: ['doing'],
      assignees: ['alex-smith'],
      search: 'prepare',
    },
  });

  assert.equal(analytics.total, 1);
  assert.equal(analytics.status.doing, 1);
  assert.equal(analytics.historyEvents, 2);
  assert.equal(analytics.recent.length, 2);
  assert.equal(analytics.cards[0].id, 'AO-001');
});

test('analytics offers a throughput range only after sufficient recorded history', () => {
  const source = boardWith('- [ ] AO-001 — Remaining work · P2 · area:internal');
  const events = Array.from({ length: 5 }, (_, index) => {
    const day = String((index * 7) + 1).padStart(2, '0');
    const card = `AO-${String(index + 2).padStart(3, '0')}`;
    return [
      { at: `2026-01-${day}T09:00:00Z`, card, event: 'created', to: 'inbox', area: 'internal', priority: 'P2', title: card },
      { at: `2026-01-${day}T17:00:00Z`, card, event: 'moved', from: 'inbox', to: 'done', area: 'internal', priority: 'P2', title: card },
    ];
  }).flat();

  const analytics = model.buildAnalytics(model.parseBoard(source), events, {
    now: '2026-02-01T12:00:00Z',
    days: 32,
    timeZone: 'Etc/UTC',
    forecastDate: '2026-02-15',
  });

  assert.equal(analytics.forecast.available, true);
  assert.ok(analytics.forecast.finishRangeWeeks.earliest >= 1);
  assert.ok(analytics.forecast.whatCanFinish >= 0);
});

test('analytics adapts to custom columns and flags growing operational risk', () => {
  const customBoard = model.reconfigureColumns(
    model.parseBoard(boardWith('- [ ] AO-001 — Prepare review · P2 · area:internal')),
    [{ id: 'inbox', name: 'Ready' }, { id: 'delivery', name: 'Delivery' }],
  );
  const customAnalytics = model.buildAnalytics(customBoard, [], {
    now: '2026-01-14T12:00:00Z',
    startDate: '2026-01-08',
    endDate: '2026-01-14',
    timeZone: 'Etc/UTC',
  });
  assert.equal(customAnalytics.done, 0);
  assert.equal(customAnalytics.status.inbox, 1);
  assert.match(customAnalytics.definitions.completion, /unavailable until the board contains a completion column/);

  const overloadedBoard = model.parseBoard(buildBoard({
    Doing: [
      card({ id: 'AO-001', title: 'One' }),
      card({ id: 'AO-002', title: 'Two' }),
      card({ id: 'AO-003', title: 'Three' }),
      card({ id: 'AO-004', title: 'Four' }),
    ].join('\n\n'),
  }));
  const analytics = model.buildAnalytics(overloadedBoard, [
    { at: '2026-01-01T09:00:00Z', card: 'AO-001', event: 'created', to: 'inbox', area: 'internal', priority: 'P2', title: 'One' },
    { at: '2026-01-02T09:00:00Z', card: 'AO-001', event: 'moved', from: 'next', to: 'done', area: 'internal', priority: 'P2', title: 'One' },
  ], {
    now: '2026-01-14T12:00:00Z',
    startDate: '2026-01-08',
    endDate: '2026-01-14',
    timeZone: 'Etc/UTC',
  });

  assert.ok(analytics.insights.some((insight) => insight.id === 'wip-limit'));
  assert.ok(analytics.insights.some((insight) => insight.id === 'throughput-change'));
  assert.equal(analytics.comparison.previous.completed, 1);
});
