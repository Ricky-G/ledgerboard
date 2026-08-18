# LedgerBoard Copilot Instructions

## Scope and quality

- Keep changes focused. Preserve unrelated work already in the tree.
- Keep the extension local-first: no telemetry, credentials, network requests, or runtime dependencies
  without an explicitly reviewed requirement.
- Preserve the Markdown contract in `BOARD-STANDARDS.md`. Maintain accessible keyboard and focus
  behavior for UI changes.
- Use Node 22. Run the smallest relevant checks locally; use `npm run preflight` before a pull
  request when practical.

## Testing is mandatory for every task

`docs/testing.md` is the full standard. It is not optional guidance, and these rules apply to every
story, task, bug fix, and refactor, including small ones.

- **Every change adds or updates a test at the layer that owns the behavior it changes.** Choose the
  cheapest layer that can actually fail when the behavior breaks:
  - domain model, parsing, validation, history, analytics -> `test/unit/`
  - workflows, npm scripts, policy files, repository automation -> `test/tooling/`
  - anything the user sees or clicks in the board panel -> `test/webview/specs/`
  - activation, commands, file system, watchers -> `src/test/`
  - VSIX contents and contributed manifest surface -> `test/packaging/`
  - cost that grows with board size -> `test/performance/`
- **A bug fix starts with a test that reproduces the bug.** Confirm it fails before the fix and
  passes after. A fix without a regression test is incomplete work.
- **Verify the test actually tests the change.** Revert the change mentally or literally: if the new
  test still passes, it is not covering the behavior and needs to be rewritten.
- **Never weaken a test to make a build green.** Deleting an assertion, widening a matcher, skipping
  a case, or lowering a coverage threshold to get past a failure is a defect, not a fix. If a test is
  genuinely wrong, say so explicitly in the pull request and explain why.
- **Use the shared fixtures** in `test/fixtures/board-fixtures.js` and the webview harness fixture.
  Fixtures must fail loudly when they cannot build what they promised, never return something
  plausible. Keep them deterministic: no `Date.now()`, no `Math.random()`, no local timezone.
- **Raise the coverage thresholds** in `scripts/coverage-policy.json` in the same pull request when a
  change lifts the measured baseline. Lowering one requires an explicit justification.
- **No flaky tests.** Poll with a deadline or use a retrying assertion instead of sleeping for a
  fixed duration. Verify webview spec changes with `npx playwright test --repeat-each=3`.
- If a change genuinely cannot be tested, state that in the pull request along with the reason and
  how the behavior was verified instead. Silence is not an acceptable answer.

## Writing for a public repository

Everything in this repository, including commit messages, pull request descriptions, code comments,
and documentation, is public and permanent. Write for a reader who has no other context.

- Never reference a private conversation, chat, ticket, or instruction the reader cannot open.
  Phrases such as "you asked", "as we discussed", or "per your request" have no meaning to a
  stranger and imply hidden context. State the requirement or the rationale directly instead.
- Explain a decision by its technical reason, not by who requested it.
- Never include machine-specific detail: absolute local paths, home directories, personal email
  addresses, internal hostnames, internal registry or proxy URLs, or real board content.
- Use neutral, factual prose. Describe what the change does and why, not the process of arriving
  at it.
- `npm run privacy:scan` enforces the mechanical parts of this and runs in `static-checks`.

## Pull requests and releases

- Use a Conventional Commit title for every pull request. Squash merging uses the PR title as the
  commit title, and Release Please uses that commit to determine the release version.
- Use `feat:` for a user-facing capability, `fix:` for a user-visible defect correction, and
  `feat!:` or a `BREAKING CHANGE:` footer for a breaking change. `feat` produces a minor release,
  `fix` produces a patch release, and a breaking change produces a major release.
- `docs:` and `perf:` also produce a patch release and appear in the changelog, because both have a
  section in `.release-please-config.json`. Use them for changes a reader of the Marketplace listing
  should know about, not for repository housekeeping.
- Use `test:`, `refactor:`, `build:`, `ci:`, `style:`, or `chore:` when a change should not
  independently create a release. Do not disguise a user-visible change as a non-release type.
- Do not manually change package versions, create tags or releases, publish a VSIX, or edit generated
  changelog entries. Release Please owns version preparation and the protected workflow owns publishing.
- Prepare a release only through the manually dispatched `Prepare release` workflow. Its generated
  pull request ships after required checks pass and the sole maintainer confirms a squash merge with
  the repository's pull-request-only bypass.
- Describe user-visible behavior clearly in the PR. Update user documentation when it changes.

### Writing the release notes

The pull request body becomes the squash commit message, and Release Please builds `CHANGELOG.md`
from it. That file ships inside the VSIX, so it is the Changelog tab on the Marketplace listing.
Write every entry for someone who uses the extension and has never seen this repository.

- The title is already the first changelog entry. Write it as the sentence a reader should see, not
  as the name of the task.
- Add one nested commit block to the body for each additional user-visible change. Release Please
  reads each block as a separate commit:

  ```text
  BEGIN_NESTED_COMMIT
  feat: group cards by assignee
  END_NESTED_COMMIT
  ```

- Each marker must be alone on its line, blocks cannot nest, and the entry must start at the
  beginning of the line with a type that has a section in `.release-please-config.json`.
- Never start a line in the body with a Conventional Commit prefix after a blank line unless you
  intend it to become a changelog entry, because Release Please turns it into one. Indent the line
  when quoting a commit message rather than writing an entry.
- A pull request that makes a single change needs no blocks at all. Use them when one pull request
  delivers several things a reader would want to know about separately.
- `npm run check:release-notes` validates the body in `static-checks`, so a malformed block fails
  the build instead of silently producing nothing. `docs/releasing.md` is the full reference.

## Security and review

- Never add, print, or expose secrets. Marketplace credentials belong only to the protected
  `marketplace` environment and are unavailable to PR workflows.
- Keep workflow permissions minimal. Do not use `pull_request_target` for untrusted pull request code.
- Pin every GitHub Action to a full commit SHA with the version in a trailing comment. A mutable tag
  lets an upstream owner change what runs in CI.
- Required checks and an independent approval protect `main`. The generated release pull request is
  the documented sole-maintainer exception: required checks remain mandatory, and the
  pull-request-only bypass substitutes only for an impossible self-approval.
- `quality` is the single required status check and aggregates every CI layer. Adding a layer means
  adding a job and listing it under the `quality` job's `needs:`. Never rename `quality`: the release
  workflow waits on that exact name.
