const SAMPLE_BOARD_SOURCE = `# LedgerBoard Preview

> Sandbox data for testing the complete local webview.

---

## Inbox
_Captured outcomes awaiting triage and commitment._

- [ ] AO-001 — Confirm customer research themes · P2 · area:northstar
    - **Description:** Consolidate interview findings into the three themes that should shape launch scope.
    - **Assignee:** maya-chen

- [ ] AO-002 — Define assignment reporting signal · P3 · area:ledgerboard
    - **Description:** Decide which assignee metrics should appear in a future analytics view.

---

## Next
_Accepted and ready to pull._

- [ ] AO-003 — Finalize the launch readiness checklist · P2 · area:northstar
    - **Description:** Confirm product, support, documentation, and communication owners are ready.
    - **Assignee:** jordan-lee

- [ ] AO-004 — Review local-first privacy guidance · P3 · area:internal
    - **Description:** Ensure examples explain what remains local and what may be committed to Git.
    - **Assignee:** priya-shah

---

## Doing \`(WIP <= 3)\`
_Actively receiving attention._

- [ ] AO-005 — Ship task assignment with history · P1 · area:ledgerboard
    - **Description:** Add people, assignment controls, filters, avatars, and previous-to-new audit values.
    - **Assignee:** alex-smith

- [ ] AO-006 — Validate keyboard and narrow-layout behavior · P2 · area:ledgerboard
    - **Description:** Exercise task editing, filters, settings, drag and drop, and responsive layouts.
    - **Assignee:** maya-chen

---

## Review / Blocked
_Waiting for review or an external dependency._

- [ ] AO-007 — Approve the campaign visual system · P2 · area:northstar
    - **Description:** Review the final color, typography, and illustration direction with stakeholders.
    - **Assignee:** jordan-lee

---

## Done
_Delivered or conclusively closed._

- [x] AO-008 — Publish the board validation standard · P2 · area:ledgerboard
    - **Description:** Document canonical card formatting, bundle validation, and safe normalization.
    - **Assignee:** priya-shah

- [x] AO-009 — Establish the local preview fixture · P3 · area:internal
    - **Description:** Provide representative data across every status, priority, entity, and assignee.
    - **Assignee:** alex-smith
`;

const CONFIG = {
    version: 1,
    workspace: {
        name: "Product delivery",
        boardTitle: "LedgerBoard preview",
        timezone: "Etc/UTC",
    },
    appearance: {
        accent: "#e24a35",
        density: "comfortable",
    },
    entities: [
        { id: "ledgerboard", name: "LedgerBoard", color: "#2e6ea6" },
        { id: "northstar", name: "Northstar launch", color: "#7257b5" },
        { id: "internal", name: "Internal", color: "#167d74" },
    ],
    people: [
        { id: "alex-smith", name: "Alex Smith", color: "#2e6ea6" },
        { id: "maya-chen", name: "Maya Chen", color: "#b52f42" },
        { id: "jordan-lee", name: "Jordan Lee", color: "#7257b5" },
        { id: "priya-shah", name: "Priya Shah", color: "#167d74" },
    ],
};

const EVENTS = [
    {
        at: "2026-07-18T09:15:00+12:00",
        card: "AO-005",
        event: "created",
        to: "inbox",
        assignee: "maya-chen",
        area: "ledgerboard",
        priority: "P1",
        title: "Ship task assignment with history",
    },
    {
        at: "2026-07-19T11:30:00+12:00",
        card: "AO-005",
        event: "moved",
        from: "inbox",
        to: "doing",
        assignee: "maya-chen",
        area: "ledgerboard",
        priority: "P1",
        title: "Ship task assignment with history",
    },
    {
        at: "2026-07-20T14:05:00+12:00",
        card: "AO-005",
        event: "updated",
        to: "doing",
        changes: ["assignee"],
        previousAssignee: "maya-chen",
        assignee: "alex-smith",
        actor: "Local editor",
        area: "ledgerboard",
        priority: "P1",
        title: "Ship task assignment with history",
    },
    {
        at: "2026-07-21T10:40:00+12:00",
        card: "AO-008",
        event: "moved",
        from: "blocked",
        to: "done",
        assignee: "priya-shah",
        area: "ledgerboard",
        priority: "P2",
        title: "Publish the board validation standard",
    },
    {
        at: "2026-07-22T16:20:00+12:00",
        card: "AO-009",
        event: "created",
        to: "done",
        assignee: "alex-smith",
        area: "internal",
        priority: "P3",
        title: "Establish the local preview fixture",
    },
];

export function createSampleBundle(model) {
    const configSource = model.serializeConfig("", structuredClone(CONFIG));
    const historySource = model.appendHistory(
        "# Kanban History\n\nAppend-only sandbox event ledger.\n\n## Events\n",
        structuredClone(EVENTS),
    );
    model.validateBundleSources(SAMPLE_BOARD_SOURCE, configSource, historySource);
    return {
        boardSource: SAMPLE_BOARD_SOURCE,
        configSource,
        historySource,
    };
}
