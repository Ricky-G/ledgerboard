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
npm run privacy:scan
npm run test
npm run compile
npm run test:integration
```

Press `F5` to run an Extension Development Host. Keep changes focused and preserve the public
Markdown contract in `BOARD-STANDARDS.md`.

## Pull requests

- Add tests for behavior changes.
- Keep runtime dependencies at zero unless there is a compelling reviewed reason.
- Use conventional commit titles so automated releases can identify user-visible changes.
- Confirm the packaged VSIX contains no test fixtures, secrets, or private board data.
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

1. A merge to `main` reruns the production validation suite on that exact merge commit.
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

Use the **Publish to Visual Studio Marketplace** workflow dispatch only to recover an interrupted
publication. Provide an existing annotated `vX.Y.Z` tag that already has a GitHub Release. The workflow
revalidates the tagged source and verifies that the tag matches `package.json` before publishing. It
skips an already-published Marketplace version and refuses a release asset that differs from the
validated build, so retrying cannot duplicate a version or silently replace an artifact. Rerunning the
failed release workflow also safely resumes publication for its existing release tag.

By contributing, you agree that your contribution is licensed under the MIT License.
