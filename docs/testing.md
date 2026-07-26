# LedgerBoard Testing Standard

This is the contract every change to LedgerBoard follows. It describes what each test layer
proves, where its tests live, how to run it, and when a change is required to add to it.

The short version: **every change adds or updates a test at the layer that owns the behavior it
changes.** If a change genuinely cannot be tested, the pull request has to say why.

## The layers

| Layer | Proves | Lives in | Local command | CI job |
| --- | --- | --- | --- | --- |
| Unit | The Markdown domain model: parsing, serializing, validation, moves, history, analytics | `test/unit/` | `npm run test:unit` | `unit-tests` |
| Tooling | The repository's own automation cannot silently regress: workflows, scripts, exception registers | `test/tooling/` | `npm run test:tooling` | `unit-tests` |
| Webview | The rendered board a user actually clicks: rendering, editing, drag and drop, filtering, error recovery, accessibility, responsiveness | `test/webview/specs/` | `npm run test:webview` | `webview-tests` |
| Integration | The extension inside a real VS Code host: activation, commands, the file system, watchers, stale-write rejection | `src/test/` | `npm run test:integration` | `integration-tests` |
| Packaging | The VSIX a user installs contains exactly what it should | `test/packaging/` | `npm run test:packaging` | `packaging` |
| Performance | Board operations stay inside their budgets as boards grow | `test/performance/` | `npm run test:performance` | `performance` |

Run everything with `npm run test:all`, or `npm run preflight` to include the static checks.

## Choosing the right layer

Pick the cheapest layer that can actually fail when the behavior breaks.

- Changing how a card, column, config value, or history event is parsed, validated, or written?
  **Unit.** These tests are pure, fast, and run against `src/webview/board-model.js` directly.
- Changing a workflow, an npm script, a repository policy file, or a generator script?
  **Tooling.** Add a guard so a future edit that breaks the contract fails a test instead of
  failing a release.
- Changing anything the user sees or interacts with in the board panel? **Webview.** The static
  harness renders the generated `media/index.html` from the maintainable `src/webview/` sources
  against a fixed fixture, so a spec failure means a user-visible regression.
- Changing activation, a command, file reading or writing, or the watcher? **Integration.**
- Changing `.vscodeignore`, `package.json` contributions, or the build output? **Packaging.**
- Changing an algorithm whose cost grows with board size? **Performance**, plus unit tests for
  correctness.

A change that touches the domain model and the UI needs a test at both layers. The unit test pins
the rule and the webview test proves the rule reaches the screen.

## Fixtures

Shared fixtures live in `test/fixtures/board-fixtures.js`. Use them instead of hand-building
Markdown in a test file.

`withColumn()` **throws when its anchor is missing**. This is deliberate, and it exists because of a
real failure. A fixture once used `String.prototype.replace` against a heading that a later change
had reworded. `replace` returns the original string when the needle is absent, so the fixture
silently produced an empty column and two analytics tests failed with a confusing off-by-one that
pointed at the analytics code rather than the fixture. A fixture that cannot build what it promised
must fail loudly at the point of construction, never return something plausible.

The webview harness uses its own deterministic fixture in `test/webview/harness/bundle.mjs`: fixed
card identifiers, a fixed accent color, and `Etc/UTC`. Never introduce `Date.now()`,
`Math.random()`, or the local timezone into a fixture.

## Writing a good test

- **Name the behavior, not the function.** `rejects a stale write when the file changed on disk`
  beats `test save 2`.
- **Assert the observable outcome.** Assert the Markdown that gets written, the event appended to
  the ledger, or the element the user sees. Do not assert on internal call counts.
- **One reason to fail.** When a test fails, its name should already tell the reader what broke.
- **Give the failure a message.** `assert.ok(x, 'The watcher never reported KANBAN-CONFIG.md')` is
  worth far more to whoever reads the failure than a bare `assert.ok(x)`.
- **Explain a non-obvious assertion with a comment**, especially when it encodes a subtlety such as
  a boundary condition or an operating-system behavior.
- **No sleeping for a fixed duration to "let things settle".** Poll for the condition with a
  deadline, or use a Playwright web-first assertion, which retries automatically.

## Determinism and flaky tests

A flaky test is worse than a missing test, because it teaches the team to ignore a red build.

- The webview suite is verified with `npx playwright test --repeat-each=3` before any spec change
  merges. Zero flakes is the bar.
- CI retries a webview test once, purely to keep an infrastructure hiccup from blocking a merge.
  A test that only passes on the retry is a bug to fix, not a result to accept.
- If a test must be quarantined, mark it with `test.fixme` and open an issue with an owner and a
  date. A quarantined test that outlives its issue gets deleted, not ignored: an always-skipped
  test is dead code that implies coverage it does not provide.

## Coverage

`npm run test:coverage` runs the unit and tooling layers under the Node coverage reporter and
enforces `scripts/coverage-policy.json`.

The thresholds are a **ratchet**. When a change raises the measured baseline, raise the thresholds
in the same pull request so the gain cannot silently erode. Lowering a threshold needs an explicit
justification in the pull request description, and reviewers should treat it as a red flag.

Coverage measures the domain model and the repository scripts, which are the parts where an
untested branch turns into corrupted Markdown. It is a floor, not a goal: a change that lifts the
percentage without asserting anything meaningful has made things worse.

## CI

Each layer is an independent job with a stable name, so a red build names the layer that broke
rather than requiring a reader to work it out from a log.

The single required status check is **`quality`**. It depends on every layer and fails when any of
them fails. Adding a new layer means adding a job and listing it under `needs:`; branch protection
never has to change. `test/tooling/ci-workflow.test.js` enforces that contract, along with SHA
pinning, least-privilege permissions, per-job timeouts, and the rule that a push to `main` is never
cancelled by a newer run.

On a pull request, CI validates the merge result. On a push to `main`, CI validates the exact
commit that landed, which is the evidence the release workflow later gates on. The release path
reads those recorded results instead of re-running the suites, so a merge does not pay for the same
validation twice.

## The rule for every change

Before opening a pull request, answer these:

1. Which layer owns the behavior I changed, and did I add or update a test there?
2. Does that test fail if I revert my change? (If not, it is not testing my change.)
3. Did I fix a bug? Then there is a test that reproduces it, and it fails without the fix.
4. Did coverage move? Then the thresholds moved with it.
5. Did I change a workflow, a script, or a policy file? Then there is a tooling guard for it.
