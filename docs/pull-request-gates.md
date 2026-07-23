# Pull Request Quality and Security Gates

Every pull request to `main` must pass the following required checks. The names are stable so they can be selected in the `main` branch rule.

| Required check | Purpose | Blocking policy |
| --- | --- | --- |
| `CI / quality` | Lockfile install, privacy scan, type check, lint, unit tests, compile, Extension Host integration tests, VSIX package, and VSIX artifact | Any failed or missing step blocks the pull request. |
| `Dependency review / dependency-review` | Newly introduced dependency advisories | High and critical advisories in runtime, development, or unknown scopes block the pull request. |
| `Dependency security / dependency-security` | Resolved lockfile integrity and `npm audit` | High and critical audit findings block the pull request. |
| `Secret scan / secret-scan` | Gitleaks scan of the pull request history | Every detected secret blocks the pull request. Revoke the credential before removing it from source. |
| `CodeQL / analyze` | GitHub CodeQL JavaScript and TypeScript analysis | GitHub code-scanning merge protection blocks errors and high or critical security alerts. |

Dependabot keeps npm dependencies under weekly review and GitHub Actions under monthly review. Dependency Review complements that scheduled maintenance by rejecting risky dependency changes before merge.

## Local preflight

Use Node 22 LTS and run the same quality and dependency commands before opening a pull request:

```powershell
npm ci
npm run privacy:scan
npm run check-types
npm run lint
npm run test
npm run compile
npm run test:integration
npm run vsix
npm audit --audit-level=high
```

The Gitleaks and CodeQL checks run in GitHub Actions because they inspect the pull request commit range and publish results to GitHub Security. Contributors with the Gitleaks CLI can also run `gitleaks detect --source . --redact` locally. Dependency Review compares the pull request dependency graph with its base branch, so `npm audit` is the local preflight for that gate.

## Failure response

- **Privacy, type, lint, test, compile, integration, or package failure:** correct the reported failure and push an update. The quality workflow summary identifies the failed stage.
- **Dependency finding:** update, replace, or remove the affected dependency. An exception requires a documented risk acceptance with an owner, expiration date, and a link to the tracked remediation before a repository administrator uses the emergency bypass.
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

PR workflows use the `pull_request` event, read-only permissions, and `persist-credentials: false` wherever repository contents are checked out. They never use `pull_request_target`, the protected `marketplace` environment, or `VSCE_PAT`. The CodeQL workflow receives the narrowly scoped `security-events: write` permission required to upload code-scanning results. Marketplace credentials remain available only to the release-driven publishing workflow.
