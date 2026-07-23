# Changelog

All notable changes to LedgerBoard are documented here.

## [0.3.0](https://github.com/Ricky-G/ledgerboard/compare/v0.2.1...v0.3.0) (2026-07-23)


### Added

* add task assignees and persistent LedgerBoard preview ([#18](https://github.com/Ricky-G/ledgerboard/issues/18)) ([2cdf3c8](https://github.com/Ricky-G/ledgerboard/commit/2cdf3c86baf7329ababe0b46a9387958f417a8f1))
* automate versioned releases ([#17](https://github.com/Ricky-G/ledgerboard/issues/17)) ([a66f71b](https://github.com/Ricky-G/ledgerboard/commit/a66f71b423cc04b1418497eac3ae3a229bf75d44))


### Fixed

* wait for actual release gate check names ([#19](https://github.com/Ricky-G/ledgerboard/issues/19)) ([fcd7bf7](https://github.com/Ricky-G/ledgerboard/commit/fcd7bf740cdea4e70c869cd448dae8fdccf0426b))

## [0.2.1] - 2026-07-22

### Fixed

- Remove the invalid Getting Started walkthrough contribution so the extension manifest validates cleanly in supported VS Code versions.

## [0.2.0] - 2026-07-22

### Added

- Shared, line-numbered diagnostics for card separators, multiline descriptions, mixed line endings,
	unsupported details, missing entities, and first source/serialized differences.
- **Normalize BOARD.md Formatting** command with confirmation and conflict detection.
- Actionable normalization directly from the webview load-error state.
- Visible badges for custom Markdown detail fields preserved outside the visual editor.
- Performance budgets for 1,000-card validation, 10,000-event analytics, and multi-root discovery.

### Changed

- Require exactly one blank physical line between adjacent cards.
- Centralize CLI and Extension Host bundle validation in the shared model.
- Parallelize initialization, existence checks, and candidate validation.
- Prefer direct filesystem reads during discovery and cache the active board for common commands.
- Add progress feedback while initializing or discovering boards.
- Expand model, CLI, and Extension Host regression coverage.

### Fixed

- Report adjacent cards without a separator using both card IDs and the exact line instead of a
	misleading generic round-trip error.
- Reject malformed checkbox markers instead of silently ignoring card-like lines.
- Preserve semantic history when normalizing formatting.

## [0.1.1] - 2026-07-21

### Fixed

- Prefer valid board bundles at workspace roots instead of recursively selecting nested reference boards.
- Validate every discovered board before offering or opening it.
- Keep the current board intact when switching to an invalid bundle.
- Show an actionable load error with reload and board-switch options instead of leaving a blank webview.
- Replace organization-specific documentation examples with neutral placeholders.
- Block packaging and publication when the privacy scanner finds known private identifiers or local data.

## [0.1.0] - 2026-07-21

### Added

- Local-first Markdown Kanban board inside VS Code.
- Safe initialization for `BOARD.md`, `KANBAN-CONFIG.md`, and `KANBAN-HISTORY.md`.
- Drag-and-drop workflow with P1-P4 priorities and a three-card Doing WIP limit.
- Generic entity palette and appearance editor.
- Conflict-safe one-second autosave.
- Append-only semantic history and operational analytics.
- Board discovery for multi-root workspaces.
- Validation and board-standard commands.
