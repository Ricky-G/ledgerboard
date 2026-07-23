# LedgerBoard Copilot Instructions

## Scope and quality

- Keep changes focused. Preserve unrelated work already in the tree.
- Keep the extension local-first: no telemetry, credentials, network requests, or runtime dependencies
  without an explicitly reviewed requirement.
- Preserve the Markdown contract in `BOARD-STANDARDS.md`. Add tests for behavior changes and maintain
  accessible keyboard and focus behavior for UI changes.
- Use Node 22. Run the smallest relevant checks locally; use the full preflight in
  `docs/pull-request-gates.md` before a pull request when practical.

## Pull requests and releases

- Use a Conventional Commit title for every pull request. Squash merging uses the PR title as the
  commit title, and Release Please uses that commit to determine the release version.
- Use `feat:` for a user-facing capability, `fix:` for a user-visible defect correction, and
  `feat!:` or a `BREAKING CHANGE:` footer for a breaking change. `feat` produces a minor release,
  `fix` produces a patch release, and a breaking change produces a major release.
- Use `docs:`, `perf:`, `test:`, `refactor:`, `build:`, `ci:`, or `chore:` when a change should not
  independently create a release. Do not disguise a user-visible change as a non-release type.
- Do not manually change package versions, create tags or releases, publish a VSIX, or edit generated
  changelog entries. Release Please owns version preparation and the protected workflow owns publishing.
- Describe user-visible behavior clearly in the PR. Update user documentation when it changes.

## Security and review

- Never add, print, or expose secrets. Marketplace credentials belong only to the protected
  `marketplace` environment and are unavailable to PR workflows.
- Keep workflow permissions minimal. Do not use `pull_request_target` for untrusted pull request code.
- Required checks and an independent approval protect `main`. Do not bypass them for routine work.
