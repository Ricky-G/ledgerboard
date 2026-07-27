# Contributing

Thanks for improving LedgerBoard.

## Before opening an issue

- Search existing issues.
- Run **LedgerBoard: Validate Board Bundle** for format problems.
- Include the extension version, VS Code version, operating system, and minimal reproduction.
- Remove private board content before attaching Markdown files.

## Development

Use Node 22 LTS and a current VS Code release.

```powershell
npm ci
npm run preflight
```

`preflight` runs everything CI runs. While iterating, run just the layer you are changing:

```powershell
npm run static             # privacy scan, type check, lint, dependency audit
npm run test:unit          # domain model and analytics
npm run test:tooling       # repository automation guards
npm run test:webview       # Playwright specs against the real webview assets
npm run test:integration   # VS Code Extension Host
npm run test:packaging     # builds and verifies the VSIX
npm run test:performance   # board operation budgets
```

Press `F5` to run an Extension Development Host. Keep changes focused and preserve the public
Markdown contract in `BOARD-STANDARDS.md`.

## Testing

[The testing standard](docs/testing.md) describes every layer, where its tests live, and which layer
owns which behavior. Read it before your first pull request.

The rule is short: **every change adds or updates a test at the layer that owns the behavior it
changes.** A bug fix starts with a test that reproduces the bug and fails without the fix. Never
weaken a test, widen a matcher, skip a case, or lower a coverage threshold to get a green build. If
a change genuinely cannot be tested, say so in the pull request and explain how you verified it.

## Writing for a public repository

This repository is public. Commit messages, pull request descriptions, comments, and documentation
are permanent and visible to everyone, so write for a reader who has no other context.

- Do not reference a private conversation, chat, or instruction a reader cannot open. Phrases such
  as "you asked" or "as we discussed" imply hidden context. State the requirement or rationale
  directly instead.
- Do not include absolute local paths, home directories, personal email addresses, internal
  hostnames or registry URLs, or real board content.
- Explain a decision by its technical reason rather than by who requested it.

`npm run privacy:scan` enforces the mechanical parts of this and runs as part of `npm run static`.

## Pull requests

- Fill in the testing section of the pull request template. It is the part reviewers read first.
- Write the title as the changelog entry you want readers to see. Squash merging turns it into the
  first bullet of the next release, and that release ships inside the VSIX as the Marketplace
  Changelog tab. Add a nested commit block per additional user-visible change, as described in
  [the release process](docs/releasing.md).
- Keep runtime dependencies at zero unless there is a compelling reviewed reason.
- Use conventional commit titles so automated releases can identify user-visible changes.
- Confirm the packaged VSIX contains no test fixtures, secrets, or private board data. The
  `packaging` layer checks this automatically.
- Use accessible labels, keyboard interactions, and visible focus states for UI changes.
- Follow [the PR quality and security gates](docs/pull-request-gates.md), including its local
  preflight commands and remediation guidance.

## Releases

LedgerBoard uses Release Please to create release-preparation pull requests after validated changes
merge to `main`. Do not manually edit a version, create a release tag, or publish a normal release.

### Versioning convention

Release Please determines the next semantic version from the commits that reach `main`:

- `feat:` creates a minor release.
- `fix:` creates a patch release.
- `feat!:` or a `BREAKING CHANGE:` footer creates a major release.
- `perf:` and `docs:` are included in release notes when they are part of a release.
- Other commit types do not independently create a release.

Use a squash commit title that follows this convention. The generated release-preparation pull request
updates `package.json`, `package-lock.json`, and `CHANGELOG.md`. It must pass the same required pull
request checks and branch rules as every other change before merging.

### Automated lifecycle

1. A merge to `main` runs the full CI pipeline against that exact merge commit. The release workflow
   waits for those recorded check results rather than repeating the same suites.
2. Release Please opens or updates a version and changelog pull request when eligible conventional
   commits are present.
3. After that protected pull request merges, Release Please creates the annotated `vX.Y.Z` tag and
   GitHub Release from the release commit. The workflow ensures the tag is annotated and points to
   that exact merge commit. Its generated notes clearly group breaking changes, additions, fixes,
   performance work, documentation, and linked contributors where available.
4. The release workflow validates the tag again, builds the VSIX from it, publishes through the
   protected `marketplace` environment, attaches the VSIX and SHA-256 file to the GitHub Release, and
   adds the Marketplace link.

### Required repository setup

- Protect `main` with the required pull request quality and security checks, review policy, and an
  up-to-date branch requirement. Do not allow direct pushes.
- Set `RELEASE_PLEASE_TOKEN` as an Actions secret for a release bot. Use a GitHub App token or
  fine-grained token with repository `contents` and `pull requests` write access. The token must be
  able to trigger workflows so generated release pull requests receive the normal checks. It is used
  only by the trusted workflow that runs after a `main` merge.
- Keep `VSCE_PAT` only as a secret in the protected `marketplace` environment. Configure
  `VSCE_PAT_VALID_TO` and `VSCE_GLOBAL_PAT_RETIREMENT` there so the credential-health workflow
  continues to warn before expiry.

### Recovery publishing

Use the **Release** workflow dispatch from the default branch with the existing `vX.Y.Z` tag when release
recovery must repair the tag before publishing. It requires the tag format, an existing GitHub Release, and
a matching `package.json` version at the tagged commit. A lightweight tag is replaced with an annotated tag
pointing to the same commit, then the existing protected publisher runs. Approve the `marketplace`
deployment only after these validations succeed.

Use the **Publish to Visual Studio Marketplace** workflow dispatch only when the existing GitHub Release
already has an annotated `vX.Y.Z` tag. It revalidates the tagged source and verifies that the tag matches
`package.json` before publishing. It skips an already-published Marketplace version and refuses a release
asset that differs from the validated build, so retrying cannot duplicate a version or silently replace an
artifact.

By contributing, you agree that your contribution is licensed under the MIT License.
