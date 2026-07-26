<!--
The title must be a Conventional Commit: squash merging uses it as the commit
title, and Release Please reads that commit to decide the next version.

  feat:  a user-facing capability          -> minor release
  fix:   a user-visible defect correction  -> patch release
  feat!: or a BREAKING CHANGE: footer      -> major release
  docs, perf, test, refactor, build, ci, chore -> no release on its own
-->

## What changed

<!-- Describe the user-visible behavior. Link the issue this closes. -->

## Tests

<!-- Required. See docs/testing.md. -->

- [ ] I added or updated a test at the layer that owns the behavior I changed.
- [ ] The new test fails without my change (I verified this, not just assumed it).
- [ ] If this fixes a bug, a test reproduces the bug and fails without the fix.
- [ ] I did not weaken an existing test, widen a matcher, skip a case, or lower a coverage
      threshold to get a green build.
- [ ] Coverage thresholds in `scripts/coverage-policy.json` were raised if the baseline moved.

Which layers did you touch, and which tests cover them?

| Layer | Touched | Tests added or updated |
| --- | --- | --- |
| Unit (`test/unit/`) | no | |
| Tooling (`test/tooling/`) | no | |
| Webview (`test/webview/specs/`) | no | |
| Integration (`src/test/`) | no | |
| Packaging (`test/packaging/`) | no | |
| Performance (`test/performance/`) | no | |

<!--
If a change genuinely cannot be tested, delete the table and explain here why,
plus how you verified the behavior instead. Do not leave this section empty.
-->

## Checks

- [ ] `npm run preflight` passes locally, or I named the checks I ran and why that was enough.
- [ ] Documentation is updated if user-visible behavior or a contributor workflow changed.
- [ ] No secrets, credentials, telemetry, or new runtime dependencies were introduced.
- [ ] This description, the commit messages, and any new comments stand on their own: no reference
      to a private conversation, no local paths, no internal URLs.
