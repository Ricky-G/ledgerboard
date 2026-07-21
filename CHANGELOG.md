# Changelog

All notable changes to LedgerBoard are documented here.

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
