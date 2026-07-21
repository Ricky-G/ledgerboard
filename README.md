# LedgerBoard

Your Kanban board should survive the tool that displays it.

LedgerBoard is a local-first VS Code board whose source of truth is three readable Markdown files.
It adds a polished drag-and-drop workflow, generic entity palettes, conflict-safe autosave, and
append-only analytics without an account, database, server, or proprietary export.

![LedgerBoard board](images/board.png)

## Why LedgerBoard

- **Markdown stays authoritative.** Review every change in Git and edit the files with any text editor.
- **Local-first by design.** No telemetry, cloud sync, login, or hosted service.
- **Useful beyond software teams.** Entities can represent projects, clients, products, teams, or workstreams.
- **History without a database.** Semantic create, move, update, and delete events append to a readable ledger.
- **Safe around human edits.** Saves stop when a Markdown buffer changed outside the board.
- **Fast at runtime.** The extension has no runtime package dependencies.

## Quick Start

1. Open a folder in VS Code.
2. Run **LedgerBoard: Initialize Board in Folder** from the Command Palette.
3. Add outcomes, drag cards between columns, and configure entities and colors.
4. Commit the resulting Markdown diff when you are ready.

Initialization creates only missing files and never overwrites an existing one:

```text
BOARD.md
KANBAN-CONFIG.md
KANBAN-HISTORY.md
```

Run **LedgerBoard: Open Board** whenever you want to return. In a multi-root workspace, Kanban
Ledger discovers compatible bundles and lets you choose one.

## Features

### Board

- Inbox, Next, Doing, Review / Blocked, and Done workflow
- Hard three-card Doing WIP limit
- P1-P4 priorities
- Search and entity/priority filters
- Responsive desktop and narrow-editor layouts
- One-second autosave with visible pending, saving, saved, and blocked states

### Entities and appearance

Every card has an `area` linked to a generic entity. An entity can be a project, account, product,
team, department, or any grouping that makes the board useful. Names and colors live in
`KANBAN-CONFIG.md`, alongside the board title, timezone, accent, and density.

### Analytics

- Current workload and completion rate
- Work by status, priority, and entity
- 7, 30, and 90-day activity ranges
- Recorded throughput and median cycle time
- Recent semantic activity from the append-only history ledger

Existing boards begin with honest baseline observations. LedgerBoard never invents old creation or
completion dates.

## Commands

| Command | Purpose |
|---|---|
| **LedgerBoard: Initialize Board in Folder** | Create the missing Markdown bundle files |
| **LedgerBoard: Open Board** | Discover and open a board in the workspace |
| **LedgerBoard: Add Outcome** | Open the board directly in the new-outcome dialog |
| **LedgerBoard: Validate Board Bundle** | Validate syntax, entities, WIP, history, and round-trip safety |
| **LedgerBoard: Open Board Standard** | Open the complete format and agent-generation contract |

You can also right-click a folder in Explorer and choose **Initialize Board in Folder**.

## Markdown Contract

A card is deliberately small:

```markdown
- [ ] AO-001 — Prepare the architecture review · P2 · area:project-alpha
    - **Description:** Consolidate the decisions, risks, and recommended next steps.
```

Status is the section containing the card. Description is the only optional detail. The full,
versioned contract is in [BOARD-STANDARDS.md](BOARD-STANDARDS.md), including a ready-to-paste prompt
for coding agents that generate compatible boards.

## Privacy and Trust

LedgerBoard does not collect telemetry and does not make network requests. It reads and writes only
the three Markdown files in the board folder selected through the workspace. Webview scripts use a
strict Content Security Policy, and every save is validated again in the extension host.

The extension supports untrusted and virtual workspaces because it never executes workspace content.
As always, review source-control changes before sharing a board that may contain private information.

## Requirements

- VS Code 1.103 or later
- A writable workspace for editing (read-only virtual workspaces can still be inspected)

There are no external runtime dependencies.

## Development

```powershell
npm ci
npm run privacy:scan
npm run test
npm run compile
npm run test:integration
npm run vsix
```

Press `F5` to launch an Extension Development Host. The project uses TypeScript, esbuild, the VS Code
test runner, and Node's built-in test runner.

Publishing is release-driven. A GitHub Release matching the `package.json` version triggers the
Marketplace workflow; the scoped `VSCE_PAT` is stored only in the protected `marketplace` environment.
A monthly credential-health workflow verifies publisher access and opens a GitHub issue before PAT
expiry or Microsoft's global-PAT retirement deadline.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and
[SUPPORT.md](SUPPORT.md) before opening a pull request or security report.

## License

[MIT](LICENSE)
