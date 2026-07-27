# Releasing

LedgerBoard releases are automated. A maintainer decides *when* to ship by merging a release pull
request. Everything after that is unattended.

## The path from merge to Marketplace

```text
merge a feature pull request
  -> CI validates the merge commit on main
  -> Release Please opens or updates the release pull request

merge the release pull request        <- this is the decision to ship
  -> CI validates that merge commit
  -> Release Please creates the tag and the GitHub Release
  -> the tag is verified against the merge commit
  -> the VSIX is built, verified, published, and attached to the release
```

Two workflows own this:

| Workflow | Trigger | Responsibility |
| --- | --- | --- |
| `Release` (`release.yml`) | push to `main` | Confirm the required checks passed on this exact commit, run Release Please, verify the tag, then call the publishing workflow. |
| `Publish to Visual Studio Marketplace` (`publish.yml`) | called by `Release`, or dispatched manually with a tag | Build and verify the VSIX, publish it, attach it to the GitHub Release. |

## Release Please keeps one release pull request

Release Please maintains a **single** open release pull request that covers every releasable commit
since the last release. It does not open one per feature.

This means release velocity and release cadence are independent:

- Merge as many feature pull requests as you like. Each one updates the same release pull request,
  recalculating the version and the changelog.
- Nothing publishes until you merge that release pull request.
- There is never a 0.6.0 release and a 0.7.0 release waiting at the same time, so there is no
  situation where you skip one to get to another. If you merge five features and then merge the
  release pull request once, you ship one version containing all five.

If you merge the release pull request and then merge more features, Release Please opens a fresh
release pull request for the next version. The already-merged release continues publishing on its
own; it is not blocked by the new work.

## Version selection

The version comes from the Conventional Commit titles of the pull requests since the last release.
Squash merging uses the pull request title as the commit title, so the title is what counts.

| Title prefix | Effect |
| --- | --- |
| `feat:` | minor release |
| `fix:` | patch release |
| `perf:`, `docs:` | patch release, listed in the changelog |
| `feat!:` or a `BREAKING CHANGE:` footer | major release |
| `test:`, `refactor:`, `build:`, `ci:`, `chore:` | no release on its own |

Do not edit versions, tags, or changelog entries by hand. Release Please owns them.

## The `marketplace` environment

Publishing runs in the `marketplace` GitHub environment, which:

- holds `VSCE_PAT`, the only credential that can publish, scoped so no other workflow can read it;
- restricts deployments to `main`.

It does **not** require a separate reviewer approval. Merging a pull request titled
`chore(main): release X.Y.Z` is already an explicit, reviewed decision to ship, and a second
approval on the same decision only delays publication. Approval gates and publication must not share
a concurrency group in any case: GitHub cancels an already-pending run when a newer one joins the
group, which can strand a tagged version unpublished.

`marketplace-credential-health.yml` checks the credential monthly and opens an issue before it
expires.

## What is validated, and where

The `quality` check runs every test layer against the exact commit that lands on `main`, and the
release workflow refuses to proceed until it, `dependency-security`, `secret-scan`, and `analyze`
have all succeeded on that commit. The tag is then asserted to point at that same commit.

Publication therefore does not repeat those suites. It runs `npm run test:packaging`, which builds
the VSIX through `vscode:prepublish` (privacy scan, type check, lint, production bundle), asserts the
contents of the package, and installs it into a clean extensions directory. That covers the artifact
itself, which is the one thing CI on a source tree cannot fully verify.

## When something fails

A failure in any release stage opens or updates a `[Automation] Release automation failed` issue with
a per-stage result table and a link to the run. A tagged version that never published leaves the
Marketplace behind this repository, and that is not visible unless something reports it.

To recover, fix the cause and then publish the **existing** tag rather than cutting a new version:

```powershell
gh workflow run publish.yml --ref main -f tag=v0.5.0
```

That path verifies the tag is annotated, has a GitHub Release, and matches `package.json`, then
publishes it. It is safe to rerun: if the Marketplace already has that version, the workflow reports
it and skips the duplicate.

`release.yml` also accepts a `tag` input for the same purpose when the tag itself needs repairing
first, for example when it was created as a lightweight tag.

## Checking what is actually live

The GitHub Release list and the Marketplace can disagree, which is exactly the failure worth
catching. Compare them with:

```powershell
gh release list --limit 5
```

```powershell
$body = '{"filters":[{"criteria":[{"filterType":7,"value":"ricky-g.ledgerboard"}],"pageNumber":1,"pageSize":1}],"flags":1}'
Invoke-RestMethod -Uri 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery' `
  -Method Post -ContentType 'application/json' `
  -Headers @{Accept = 'application/json;api-version=7.2-preview.1'} -Body $body |
  ForEach-Object { $_.results[0].extensions[0].versions } | Select-Object -First 5 version, lastUpdated
```

A published release also carries its `.vsix` and `.vsix.sha256` as release assets. A GitHub Release
with no assets never reached the Marketplace. Gallery indexing lags publication by a few minutes, so
allow for that before treating a mismatch as a failure.
