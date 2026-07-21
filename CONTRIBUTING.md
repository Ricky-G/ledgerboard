# Contributing

Thanks for improving Kanban Ledger.

## Before opening an issue

- Search existing issues.
- Run **Kanban Ledger: Validate Board Bundle** for format problems.
- Include the extension version, VS Code version, operating system, and minimal reproduction.
- Remove private board content before attaching Markdown files.

## Development

Use Node 22 LTS and a current VS Code release.

```powershell
npm ci
npm run test
npm run compile
npm run test:integration
```

Press `F5` to run an Extension Development Host. Keep changes focused and preserve the public
Markdown contract in `BOARD-STANDARDS.md`.

## Pull requests

- Add tests for behavior changes.
- Keep runtime dependencies at zero unless there is a compelling reviewed reason.
- Update `CHANGELOG.md` for user-visible changes.
- Confirm the packaged VSIX contains no test fixtures, secrets, or private board data.
- Use accessible labels, keyboard interactions, and visible focus states for UI changes.

By contributing, you agree that your contribution is licensed under the MIT License.
