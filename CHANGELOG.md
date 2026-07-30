# Changelog

All notable changes to LedgerBoard are documented here.

## [0.6.0](https://github.com/Ricky-G/ledgerboard/compare/v0.5.1...v0.6.0) (2026-07-30)


### Added

* add contextual right-click ticket actions ([492eb42](https://github.com/Ricky-G/ledgerboard/commit/492eb4254fb4d67c8df0807e99ec1466d48e3b33))


### Fixed

* restore reliable ticket deletion ([#49](https://github.com/Ricky-G/ledgerboard/issues/49)) ([492eb42](https://github.com/Ricky-G/ledgerboard/commit/492eb4254fb4d67c8df0807e99ec1466d48e3b33))

## [0.5.1](https://github.com/Ricky-G/ledgerboard/compare/v0.5.0...v0.5.1) (2026-07-27)


### Fixed

* stop release automation stranding tagged versions unpublished ([#42](https://github.com/Ricky-G/ledgerboard/issues/42)) ([505677f](https://github.com/Ricky-G/ledgerboard/commit/505677faa66f28e813cfcaf4a7087145e4793f4c))

## [0.5.0](https://github.com/Ricky-G/ledgerboard/compare/v0.4.0...v0.5.0) (2026-07-27)


### Added

* ship a self-contained offline board app ([#38](https://github.com/Ricky-G/ledgerboard/issues/38)) ([68db308](https://github.com/Ricky-G/ledgerboard/commit/68db308ab1aa272f3a881ed17cb9d405123e916d))

## [0.4.0](https://github.com/Ricky-G/ledgerboard/compare/v0.3.2...v0.4.0) (2026-07-26)


### Added

* expand board analytics and insights ([#33](https://github.com/Ricky-G/ledgerboard/issues/33)) ([af1c662](https://github.com/Ricky-G/ledgerboard/commit/af1c66259bf67ca0e79c653a94a68ce9184aae32))
* expand board analytics and insights ([#33](https://github.com/Ricky-G/ledgerboard/issues/33)) ([962f225](https://github.com/Ricky-G/ledgerboard/commit/962f2254d9fbf52a7fcbf5402cb1a33764a5b47b))
* remove board column ticket limits ([#35](https://github.com/Ricky-G/ledgerboard/issues/35)) ([8608a1b](https://github.com/Ricky-G/ledgerboard/commit/8608a1b3c4f27802307da6358f9d3dc90cd943e4))

## [0.3.2](https://github.com/Ricky-G/ledgerboard/compare/v0.3.1...v0.3.2) (2026-07-25)


### Documentation

* remove internal details from Marketplace description ([#31](https://github.com/Ricky-G/ledgerboard/issues/31)) ([aeed081](https://github.com/Ricky-G/ledgerboard/commit/aeed081449cca600845723d569d761a1ed5771f5))

## [0.3.1](https://github.com/Ricky-G/ledgerboard/compare/v0.3.0...v0.3.1) (2026-07-25)


### Fixed

* harden dependency release gates ([#27](https://github.com/Ricky-G/ledgerboard/issues/27)) ([4c0ab91](https://github.com/Ricky-G/ledgerboard/commit/4c0ab919948263101a9cc1e32f6f60f843cc535d))
* recover lightweight release tags ([#21](https://github.com/Ricky-G/ledgerboard/issues/21)) ([18415a2](https://github.com/Ricky-G/ledgerboard/commit/18415a26365bc2861f5c45eaf13d94884fdb27ac))

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
