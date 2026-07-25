# Dependency Security Exceptions

The dependency security workflow performs two audits:

1. A production-only audit with no exceptions.
2. A full dependency audit where only the exact, active exceptions in
   `scripts/dependency-audit-exceptions.json` may pass.

Every exception has an owner, expiration date, remediation reference, and reason. New high or critical
findings fail the workflow, as do expired exceptions and any production finding.

## Brace expansion

- **Advisory:** [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg)
- **Owner:** Ricky-G
- **Expires:** 2026-10-31
- **Affected development tools:** `@vscode/vsce`, `eslint`, and `typescript-eslint`
- **Remediation:** Review releases from
  [VSCE](https://github.com/microsoft/vscode-vsce/releases),
  [ESLint](https://github.com/eslint/eslint/releases), and
  [typescript-eslint](https://github.com/typescript-eslint/typescript-eslint/releases).

The current compatible releases still resolve the affected `brace-expansion` dependency through
`minimatch`. Remove this exception as soon as a compatible upstream release resolves a fixed version.

## Fast URI

- **Advisory:** [GHSA-v2hh-gcrm-f6hx](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx)
- **Owner:** Ricky-G
- **Expires:** 2026-10-31
- **Affected development tool:** `@vscode/vsce`
- **Remediation:** Review
  [VSCE releases](https://github.com/microsoft/vscode-vsce/releases) and
  [fast-uri releases](https://github.com/fastify/fast-uri/releases).

The current compatible VSCE release resolves the affected `fast-uri` dependency through `secretlint`.
Remove this exception as soon as VSCE resolves a fixed version.
