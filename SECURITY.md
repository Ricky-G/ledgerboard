# Security Policy

## Supported versions

Security fixes are applied to the latest Marketplace version.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private security advisory
flow for this repository and include:

- affected version;
- reproduction steps;
- expected impact;
- any suggested mitigation.

You can expect an acknowledgement within five business days. Please allow time for a fix and release
before public disclosure.

## Security posture

Kanban Ledger does not collect telemetry, call remote services, execute workspace content, or store
credentials. It reads and writes the three selected Markdown bundle files. The webview uses a strict
Content Security Policy and untrusted messages are validated again in the extension host.
