# Markdown Kanban Board Standard

Use this standard to create a Markdown data bundle that opens in the LedgerBoard VS Code extension.
It is intended for people and coding agents. Following it exactly avoids boards that
look plausible in Markdown but fail to load, autosave, or produce accurate analytics.

## How the viewer works

Install LedgerBoard in VS Code, run **LedgerBoard: Open Board**, and choose the folder containing
the board data. Run **LedgerBoard: Initialize Board in Folder** to create a blank compatible bundle.

The selected folder can be any workspace folder, but it must contain these exact filenames at its root:

```text
<board-folder>/
  BOARD.md
  KANBAN-CONFIG.md
  KANBAN-HISTORY.md
```

Do not rename the three board data files. The extension opens those fixed names.

## Non-negotiable rules

1. `BOARD.md` is authoritative for current cards and status.
2. `KANBAN-CONFIG.md` defines board labels, appearance, people, and the entity color palette.
3. `KANBAN-HISTORY.md` is an append-only semantic event ledger used by Analytics.
4. Keep the five board columns in the exact order and spelling shown below.
5. Use the exact one-line card grammar. Additional inline fields are invalid.
6. Description and Assignee are the optional detail fields and must each stay on one physical Markdown line.
7. Every card's `area` must match an entity ID in `KANBAN-CONFIG.md`.
8. Every non-empty Assignee must match a person ID in `KANBAN-CONFIG.md`.
9. Card IDs are unique, monotonic, and never reused.
10. `Doing` has a hard WIP limit of three cards.
11. Never invent historical transition times. Use `baseline` when only current state is known.

## `BOARD.md` contract

### Required structure

Use these five H2 headings exactly and in this order:

```markdown
# Kanban Board

---

## Inbox
_Captured outcomes awaiting triage and commitment._

<!-- empty -->

---

## Next
_Accepted and ready to pull._

<!-- empty -->

---

## Doing `(WIP <= 3)`
_Actively receiving attention._

<!-- empty -->

---

## Review / Blocked
_Waiting for acceptance or an external dependency._

<!-- empty -->

---

## Done
_Delivered or conclusively closed._

<!-- empty -->
```

The descriptive italic lines may be changed, but the five H2 headings, their order, and the `---`
section separators must remain stable.

### Exact card syntax

Open card:

```markdown
- [ ] AO-001 — Prepare architecture review · P2 · area:client-a
```

Done card:

```markdown
- [x] AO-002 — Publish final design document · P2 · area:client-b
```

Optional details:

```markdown
- [ ] AO-003 — Confirm workspace prerequisites · P1 · area:project-alpha
    - **Description:** Confirm identity, network, access, and environment prerequisites with the delivery team.
    - **Assignee:** alex-smith
```

The grammar is exactly:

```text
- [ ] AO-NNN — Outcome title · P1|P2|P3|P4 · area:<entity-id>
```

Formatting rules:

- Use the Unicode em dash `—` between the ID and title.
- Use the Unicode middle dot `·` around priority and area.
- Use `[x]` only in `Done`; use `[ ]` in every other column.
- Do not add due dates, source fields, labels, estimates, tags, URLs, or other inline fields.
- Put essential context in the one-line description.
- Separate every pair of adjacent cards with exactly one blank physical line.

Correct adjacent cards:

```markdown
- [ ] AO-001 — First outcome · P1 · area:client-a
  - **Description:** First description.

- [ ] AO-002 — Second outcome · P2 · area:client-a
  - **Description:** Second description.
```

Incorrect: no blank physical line between cards:

```markdown
- [ ] AO-001 — First outcome · P1 · area:client-a
  - **Description:** First description.
- [ ] AO-002 — Second outcome · P2 · area:client-a
  - **Description:** Second description.
```

LedgerBoard reports both card IDs and the second card's line. Run **LedgerBoard: Normalize BOARD.md
Formatting** to fix missing or extra separator lines safely.

### Card title quality

Write an observable outcome rather than a topic or activity.

Prefer:

- `Prepare the Client A architecture review`
- `Confirm Project Alpha workspace prerequisites`
- `Publish the AKS recovery design`

Avoid:

- `Client A`
- `Follow up`
- `Meeting`
- `Look into this`

### Priorities

| Priority | Meaning |
|---|---|
| `P1` | Critical or must be handled now |
| `P2` | Important current work |
| `P3` | Useful, but not immediately urgent |
| `P4` | Someday or deliberately deferred |

Only `P1`, `P2`, `P3`, and `P4` are valid. Do not use `P?`, `P0`, `P5`, High, Medium, or Low.

### Status meanings

Status is represented only by the section containing the card:

| Column | Meaning |
|---|---|
| `Inbox` | Captured, but not yet accepted or fully triaged |
| `Next` | Accepted, clear, and ready to start |
| `Doing` | Actively receiving attention; maximum three cards |
| `Review / Blocked` | Waiting for review, acceptance, or an external dependency |
| `Done` | Delivered or conclusively closed |

### ID allocation

- Scan every card and every history event for the highest `AO-NNN` value.
- Allocate the next new ID by incrementing the highest value.
- Never renumber existing cards.
- Never reuse an ID, including after deletion.
- Use at least three digits: `AO-001`, `AO-035`, `AO-103`.

### Card details

`Description` and `Assignee` are the supported optional card detail fields:

```markdown
    - **Description:** Document the required controls and review them with the delivery team.
    - **Assignee:** alex-smith
```

Detail rules:

- Indent the detail line with exactly four spaces.
- Use the labels `**Description:**` and `**Assignee:**` exactly.
- Keep each complete detail value on one physical Markdown line.
- Replace source line breaks with spaces.
- The Assignee value is a person ID from `KANBAN-CONFIG.md`; omit the line for unassigned work.
- Do not add `Next`, `Owner`, `Evidence`, `Artifact`, `Due`, or other detail fields.

Keeping detail values on one physical line is required for byte-for-byte round-trip behavior.

Incorrect: a description continued onto another physical line:

```markdown
- [ ] AO-001 — Prepare architecture review · P2 · area:client-a
    - **Description:** Consolidate the current decisions and risks
      before recommending the next step.
```

LedgerBoard refuses to normalize this automatically because joining arbitrary lines could change
meaning. Replace the line break with a space, then validate again.

### Line endings and normalization

- Use LF or CRLF consistently throughout `BOARD.md`.
- Mixed line endings produce a specific line-numbered diagnostic.
- **Normalize BOARD.md Formatting** can safely standardize line endings and card separators.
- Normalization never changes card IDs, titles, descriptions, assignees, priorities, areas, status, or history.
- Unsupported custom detail fields are preserved and reported as warnings because the visual editor
  cannot edit them.

### Empty columns

Use this marker when a column contains no cards:

```markdown
<!-- empty -->
```

Remove the marker as soon as the column contains a card.

## `KANBAN-CONFIG.md` contract

The file must contain one fenced JSON block. Canonical configuration uses generic `entities`, so
the board can represent customers, projects, teams, products, or any other grouping.

````markdown
# Kanban Configuration

```json
{
  "version": 1,
  "workspace": {
    "name": "Architecture Operations",
    "boardTitle": "Delivery Board",
    "timezone": "Etc/UTC"
  },
  "appearance": {
    "accent": "#e24a35",
    "density": "comfortable"
  },
  "entities": [
    {
      "id": "meta",
      "name": "Internal",
      "color": "#167d74"
    },
    {
      "id": "client-a",
      "name": "Client A",
      "color": "#7257b5"
    }
  ],
  "people": [
    {
      "id": "alex-smith",
      "name": "Alex Smith",
      "color": "#2e6ea6"
    }
  ]
}
```
````

Entity rules:

- `id` uses only lowercase letters, numbers, and hyphens: `^[a-z0-9][a-z0-9-]*$`.
- IDs are unique and stable.
- `name` is the human-readable label shown on cards and charts.
- `color` is a six-digit hexadecimal color such as `#1866a3`.
- Every `area:<entity-id>` in `BOARD.md` must resolve to one entity.
- Add a missing entity before assigning its ID to a card.
- Preserve existing IDs when updating a board because cards and history reference them.
- `density` is `comfortable` or `compact`.
- Use the IANA timezone appropriate for the board, for example `Etc/UTC`.

People rules:

- `id` follows the same lowercase letters, numbers, and hyphens rule as entity IDs.
- IDs are unique and stable within the people directory.
- `name` is the person's display name in the editor, filters, and card avatar.
- `color` is a six-digit hexadecimal color used for the person's avatar.
- Every non-empty `Assignee` value in `BOARD.md` must resolve to one person.
- Existing configuration without `people` is valid and loads with an empty people directory.

Older configuration using `customers` can be read and migrated by the current parser, but new board
bundles must use `entities`.

## `KANBAN-HISTORY.md` contract

History is append-only. Never edit, reorder, deduplicate, or delete an existing event.

Start the file with:

```markdown
# Kanban History

Append-only semantic event ledger for the visual Kanban.

## Events
```

Each event is one compact JSON object indented by exactly four spaces.

### New board or imported current state

If cards already exist but their real transition times are unknown, append one `baseline` event per
card using the actual time the board bundle is created:

```text
    {"at":"2026-01-15T09:00:00+00:00","card":"AO-001","event":"baseline","to":"inbox","area":"client-a","priority":"P2","title":"Prepare architecture review"}
```

`baseline` means “observed in this state at this time.” It does not claim that the card was created,
started, or completed then.

### Events for later changes

Created:

```text
    {"at":"<actual ISO timestamp>","card":"AO-035","event":"created","to":"inbox","area":"client-a","priority":"P2","title":"Prepare architecture review"}
```

Moved:

```text
    {"at":"<actual ISO timestamp>","card":"AO-035","event":"moved","from":"inbox","to":"next","area":"client-a","priority":"P2","title":"Prepare architecture review"}
```

Updated:

```text
    {"at":"<actual ISO timestamp>","card":"AO-035","event":"updated","to":"next","changes":["title","description","priority","area"],"area":"client-a","priority":"P1","title":"Updated outcome title"}
```

Assignment changed:

```text
    {"at":"<actual ISO timestamp>","card":"AO-035","event":"updated","to":"next","changes":["assignee"],"previousAssignee":"alex-smith","assignee":"sam-lee","area":"client-a","priority":"P1","title":"Updated outcome title"}
```

For unassignment, set `assignee` to `null`. If an actor identity is available, include it as an
`actor` string. LedgerBoard does not invent an actor when the local environment does not provide one.

Deleted:

```text
    {"at":"<actual ISO timestamp>","card":"AO-035","event":"deleted","from":"next","area":"client-a","priority":"P1","title":"Updated outcome title"}
```

History rules:

- Allowed event types: `baseline`, `created`, `moved`, `updated`, and `deleted`.
- Use the actual current ISO 8601 timestamp with UTC offset.
- Valid status values are `inbox`, `next`, `doing`, `blocked`, and `done`.
- Include only fields that actually changed in an `updated.changes` array.
- Assignment changes include `previousAssignee` and `assignee`; either value can be `null`.
- A direct Markdown mutation must append the corresponding semantic event at the same time.
- The visual application automatically appends events when it saves changes.
- Never invent past timestamps from email dates, file dates, Git history, or narrative text.

## Agent workflow

When an agent creates or updates a bundle, it must follow this sequence:

1. Read all three existing files when they exist.
2. Parse all current cards and history events.
3. Determine the highest card ID across the board and history.
4. Dedupe proposed outcomes against the complete board.
5. Normalize vague task text into observable outcome titles.
6. Choose a valid priority and status using explicit evidence; when uncertain, use `Inbox` and `P3`.
7. Add missing entities and people to `KANBAN-CONFIG.md` before using them.
8. Preserve existing cards, descriptions, assignees, IDs, colors, and all prior history events.
9. Separate adjacent cards with exactly one blank physical line.
10. Enforce the Doing WIP limit of three.
11. Write the three files atomically where possible.
12. Run the validation command below.
13. Do not report completion unless validation succeeds.

Do not invent work, completion, priorities, entity assignments, or transition timestamps.

## Copy/paste prompt for another agent

Use this prompt as-is, then add the source material from which the agent should derive tasks.

```text
Create or update a Markdown Kanban bundle that is compatible with the LedgerBoard VS Code extension.

Read and follow BOARD-STANDARDS.md as the authoritative contract. In VS Code, run
"LedgerBoard: Open Board Standard" to open the installed copy.

TARGET FOLDER
<replace with the absolute target folder>

REQUIRED OUTPUT
The target folder must contain these exact files:
- BOARD.md
- KANBAN-CONFIG.md
- KANBAN-HISTORY.md

PROCESS
1. Read all three files if they already exist. Preserve existing data and treat history as append-only.
2. Extract only real, evidence-backed outcomes from the supplied source material.
3. Dedupe against every existing board card before adding anything.
4. Rewrite vague tasks as concise observable outcome titles.
5. Use exactly P1, P2, P3, or P4.
6. Use only the exact columns Inbox, Next, Doing `(WIP <= 3)`, Review / Blocked, and Done.
7. Use exactly this card grammar:
   - [ ] AO-NNN — Outcome title · P1|P2|P3|P4 · area:<entity-id>
8. Description and Assignee are optional details and must each be one physical Markdown line:
       - **Description:** Concise context.
       - **Assignee:** <person-id>
9. Separate every pair of adjacent cards with exactly one blank physical line.
10. Keep Doing at three cards or fewer.
11. Use checked boxes only in Done.
12. Allocate monotonic IDs by scanning both current cards and history. Never reuse an ID.
13. Ensure every card area resolves to a stable entity in KANBAN-CONFIG.md. New configuration uses
    `entities`, not `customers`.
14. Ensure every Assignee value resolves to a stable person in the `people` configuration array.
15. For a new/imported board with unknown transition history, append baseline events using the actual
    current timestamp. For updates, append created, moved, updated, or deleted events. Never rewrite
    prior history and never infer historical timestamps. Record previous and new person IDs for
    assignment changes.
16. Do not add due dates, source fields, estimates, tags, or other card metadata.
17. Validate the completed bundle with the command in BOARD-STANDARDS.md.

SOURCE MATERIAL
<paste or identify the task source here>

Return a concise summary of cards added or changed, people or entities added, history events appended,
and the validation result. Do not claim success unless validation passes.
```

## Validation

Run **LedgerBoard: Validate Board Bundle** from the VS Code Command Palette.

When working from a LedgerBoard source checkout, the equivalent terminal command is:

```powershell
$BoardFolder = "C:\path\to\board-folder"
npm run validate:board -- "$BoardFolder"
```

Expected result:

```text
Kanban bundle valid: <card-count> cards, <entity-count> entities, <person-count> people, <event-count> history events
```

## Common failure modes

- Using a different filename such as `tasks.md` instead of `BOARD.md`.
- Renaming or reordering a required H2 column.
- Adding fields after `area:<entity-id>` on the card line.
- Using multiline detail values. Keep each Description and Assignee value on one physical line.
- Omitting the one blank physical line required between adjacent cards.
- Adding two or more blank physical lines between adjacent cards.
- Mixing LF and CRLF line endings in one `BOARD.md`.
- Using priorities other than P1–P4.
- Leaving `<!-- empty -->` in a column that contains cards.
- Assigning an area that has no matching entity in the config.
- Assigning a person ID that has no matching entry in the people directory.
- Creating config with `customers` instead of canonical `entities`.
- Reusing or renumbering card IDs.
- Putting more than three cards in Doing.
- Marking non-Done cards with `[x]` or Done cards with `[ ]`.
- Rewriting old history rows or inventing transition timestamps.
- Creating only `BOARD.md`; the viewer also requires config and history files.

When validation succeeds, run **LedgerBoard: Open Board** and select the generated board folder.
