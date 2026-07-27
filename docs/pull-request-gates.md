# Pull Request Quality and Security Gates

Every pull request to `main` must pass the following required checks. The names are stable so they can be selected in the `main` branch rule.

| Required check | Purpose | Blocking policy |
| --- | --- | --- |
| `CI / quality` | Aggregates every CI layer: static checks, unit and tooling tests with coverage thresholds, webview tests, Extension Host integration tests, performance budgets, and packaging | Any layer that does not succeed blocks the pull request. |
| `Dependency review / dependency-review` | Newly introduced dependency advisories | High and critical advisories in runtime, development, or unknown scopes block the pull request unless they match an active, documented exception. |
| `Dependency security / dependency-security` | Resolved lockfile integrity and `npm audit` | Production high and critical findings block the pull request. Development findings also block unless they match an active, documented, expiring exception. |
| `Secret scan / secret-scan` | Gitleaks scan of the pull request history | Every detected secret blocks the pull request. Revoke the credential before removing it from source. |
| `CodeQL / analyze` | GitHub CodeQL JavaScript and TypeScript analysis | GitHub code-scanning merge protection blocks errors and high or critical security alerts. |

`quality` is the only CI entry in the branch rule. It depends on every test layer, so adding a layer
means adding a job and listing it under the `quality` job's `needs:`, and branch protection never has
to change. Never rename `quality`: the release workflow waits on that exact name before preparing a
release.

The layers behind `quality` each report as their own check, so a red build names what broke:

| CI job | Runs |
| --- | --- |
| `static-checks` | Privacy scan, type check, lint, dependency audit |
| `unit-tests` | Unit and tooling suites under the coverage ratchet |
| `webview-tests` | Playwright specs against the real webview assets |
| `integration-tests` | The VS Code Extension Host suite |
| `performance` | Board operation budgets |
| `packaging` | VSIX build plus the packaging assertions, and uploads the VSIX artifact |

Dependabot keeps npm dependencies under weekly review and GitHub Actions under monthly review. Dependency Review complements that scheduled maintenance by rejecting risky dependency changes before merge.

Testing expectations for a change are in [the testing standard](testing.md). Every pull request is
expected to add or update a test at the layer that owns the behavior it changed. What happens to a
change after it merges is in [the release process](releasing.md).

## Local preflight

Use Node 22 LTS. One command runs everything CI runs:

```powershell
npm ci
npm run preflight
```

`preflight` runs the static checks, then the coverage, performance, webview, integration, and
packaging layers in order. To run a single layer while iterating:

```powershell
npm run static             # privacy scan, type check, lint, dependency audit
npm run test:unit          # domain model and analytics
npm run test:tooling       # repository automation guards
npm run test:coverage      # unit + tooling under the coverage ratchet
npm run test:webview       # Playwright specs
npm run test:integration   # VS Code Extension Host
npm run test:packaging     # builds and verifies the VSIX
npm run test:performance   # board operation budgets
```

The Gitleaks and CodeQL checks run in GitHub Actions because they inspect the pull request commit range and publish results to GitHub Security. Contributors with the Gitleaks CLI can also run `gitleaks detect --source . --redact` locally. Dependency Review compares the pull request dependency graph with its base branch, and `npm run audit:dependencies` applies the same production audit and limited exception policy as the dependency security gate.

## Failure response

- **A CI layer failed:** open the job named in the `quality` summary table. Each layer runs
  independently, so the failing job is the one to read. Reproduce it with the matching local command
  above, fix the cause, and push an update. Do not weaken the test to get past it.
- **Webview failure:** the `playwright-report` artifact on the run contains the trace, screenshot,
  and video for the first retry. Download it rather than guessing from the log.
- **Coverage threshold failure:** add the missing test. Lowering a threshold in
  `scripts/coverage-policy.json` requires an explicit justification in the pull request.
- **Dependency finding:** update, replace, or remove the affected dependency. If upstream has no compatible fix, add an explicit exception with an owner, expiration date, and tracked remediation in [the dependency security exception register](dependency-security-exceptions.md). New, expired, or production findings remain blocking.
- **Secret finding:** immediately revoke or rotate the exposed credential, remove it from the source and generated artifacts, and assess whether history rewriting is necessary. Removing a secret alone does not make it safe.
- **CodeQL finding:** correct the vulnerability or suppress it only when the result is proven to be a false positive and the suppression explains why. Review the code-scanning alert in GitHub Security.

## `main` merge rule

The active `Main PR quality and security` repository ruleset protects `main`. Audit its current configuration with:

```powershell
gh api repos/Ricky-G/ledgerboard/rulesets/19599753
```

Repository administrators must keep this ruleset active with:

- required pull requests and the current branch requirement;
- the five required checks listed above;
- one independent approving review;
- stale-review dismissal when new commits are pushed;
- resolved review conversations;
- direct pushes, force pushes, and branch deletion blocked for normal contributors;
- GitHub code-scanning merge protection enabled for CodeQL, blocking errors and high or critical security alerts;
- an administrator emergency bypass only for urgent, documented recovery work.

The current policy deliberately does not require code-owner approval. An emergency bypass is not a routine merge path: the administrator must record the reason and open follow-up work to restore any skipped validation.

## Credential isolation

PR workflows use the `pull_request` event, read-only permissions, and `persist-credentials: false` wherever repository contents are checked out. They never use `pull_request_target`, the protected `marketplace` environment, or `VSCE_PAT`. The CodeQL workflow receives the narrowly scoped `security-events: write` permission required to upload code-scanning results. Marketplace credentials remain available only to the release-driven publishing workflow, which reads them through the `marketplace` environment. That environment restricts deployments to `main`, and [the release process](releasing.md) explains why merging the release pull request, rather than a second environment approval, is the decision to ship.

Every GitHub Action is pinned to a full commit SHA with its version in a trailing comment, so an
upstream tag move cannot change what runs against this repository. Each CI job declares a timeout,
and a push to `main` is never cancelled by a newer run because the release gate reads the check
results recorded for that exact commit. `test/tooling/ci-workflow.test.js` enforces all of this, so
a regression fails a test instead of quietly weakening the pipeline.
