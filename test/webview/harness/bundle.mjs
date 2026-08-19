/**
 * Deterministic webview fixture bundle.
 *
 * The harness serves this instead of a real workspace so every webview test
 * starts from identical Markdown. Timestamps are fixed, so analytics and
 * history assertions never depend on the clock.
 */

const BOARD_SOURCE = `# Harness Board

> Deterministic fixture for the webview test layer.

---

## Inbox

- [ ] AO-001 — Confirm research themes · P2 · area:northstar
    - **Description:** Consolidate interview findings into three launch themes.
    - **Assignee:** maya-chen

- [ ] AO-002 — Define reporting signal · P3 · area:ledgerboard
    - **Description:** Decide which assignee metrics belong in analytics.

---

## Next

- [ ] AO-003 — Finalize readiness checklist · P2 · area:northstar
    - **Description:** Confirm product, support, and documentation owners.
    - **Assignee:** jordan-lee

---

## Doing

- [ ] AO-004 — Ship assignment history · P1 · area:ledgerboard
    - **Description:** Add people, assignment controls, and audit values.
    - **Assignee:** alex-smith

---

## Review / Blocked

- [ ] AO-005 — Approve the visual system · P2 · area:northstar
    - **Description:** Review colour, typography, and illustration direction.
    - **Assignee:** jordan-lee

---

## Done

- [x] AO-006 — Publish the validation standard · P2 · area:ledgerboard
    - **Description:** Document canonical formatting and safe normalization.
    - **Assignee:** priya-shah
`;

const EMPTY_BOARD_SOURCE = `# Harness Board

> Deterministic fixture for the webview test layer.

---

## Inbox

<!-- empty -->

---

## Next

<!-- empty -->

---

## Doing

<!-- empty -->

---

## Review / Blocked

<!-- empty -->

---

## Done

<!-- empty -->
`;

const INVALID_BOARD_SOURCE = `# Harness Board

---

## Inbox

- [ ] AO-001 — Missing the rest of the columns · P2 · area:ledgerboard
`;

const CONFIG = {
  version: 1,
  workspace: {
    name: 'Harness workspace',
    boardTitle: 'Harness board',
    timezone: 'Etc/UTC',
  },
  appearance: {
    accent: '#e24a35',
    density: 'comfortable',
  },
  entities: [
    { id: 'ledgerboard', name: 'LedgerBoard', color: '#2e6ea6' },
    { id: 'northstar', name: 'Northstar launch', color: '#7257b5' },
    { id: 'internal', name: 'Internal', color: '#167d74' },
  ],
  people: [
    { id: 'alex-smith', name: 'Alex Smith', color: '#2e6ea6' },
    { id: 'maya-chen', name: 'Maya Chen', color: '#b52f42' },
    { id: 'jordan-lee', name: 'Jordan Lee', color: '#7257b5' },
    { id: 'priya-shah', name: 'Priya Shah', color: '#167d74' },
  ],
};

const EVENTS = [
  {
    at: '2026-03-01T09:00:00.000Z',
    card: 'AO-004',
    event: 'created',
    to: 'inbox',
    assignee: 'maya-chen',
    area: 'ledgerboard',
    priority: 'P1',
    title: 'Ship assignment history',
  },
  {
    at: '2026-03-03T09:00:00.000Z',
    card: 'AO-004',
    event: 'moved',
    from: 'inbox',
    to: 'doing',
    assignee: 'alex-smith',
    area: 'ledgerboard',
    priority: 'P1',
    title: 'Ship assignment history',
  },
  {
    at: '2026-03-05T09:00:00.000Z',
    card: 'AO-006',
    event: 'moved',
    from: 'blocked',
    to: 'done',
    assignee: 'priya-shah',
    area: 'ledgerboard',
    priority: 'P2',
    title: 'Publish the validation standard',
  },
];

const HISTORY_HEADER = '# Kanban History\n\nAppend-only fixture ledger.\n\n## Events\n';

export const SCENARIOS = ['default', 'empty', 'invalid', 'label-id-collision', 'duplicate-labels'];

/** Build the bundle a scenario should serve, validating it through the model. */
export function createBundle(model, scenario = 'default') {
  const config = structuredClone(CONFIG);
  if (scenario === 'label-id-collision') {
    config.entities.push({ id: 'label-4', name: 'Release planning', color: '#b52f42' });
  }
  if (scenario === 'duplicate-labels') {
    config.entities.push({ id: 'release', name: '  northstar launch  ', color: '#b52f42' });
    return {
      rootName: 'harness',
      boardSource: BOARD_SOURCE,
      configSource: `# Kanban Configuration\n\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\`\n`,
      historySource: HISTORY_HEADER,
    };
  }
  const configSource = model.serializeConfig('', config);

  if (scenario === 'invalid') {
    return {
      rootName: 'harness',
      boardSource: INVALID_BOARD_SOURCE,
      configSource,
      historySource: HISTORY_HEADER,
    };
  }

  const boardSource = scenario === 'empty' ? EMPTY_BOARD_SOURCE : BOARD_SOURCE;
  const historySource = scenario === 'empty'
    ? HISTORY_HEADER
    : model.appendHistory(HISTORY_HEADER, structuredClone(EVENTS));

  model.validateBundleSources(boardSource, configSource, historySource);
  return { rootName: 'harness', boardSource, configSource, historySource };
}
