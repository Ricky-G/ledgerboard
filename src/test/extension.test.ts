import * as vscode from 'vscode';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import { discoverBoardRepositories } from '../boardDiscovery';
import { BoardRepository } from '../boardRepository';
import { boardModel } from '../model';
import { BOARD_FILE, BUNDLE_FILES, CONFIG_FILE, HISTORY_FILE } from '../templates';

async function removeFixture(uri: vscode.Uri): Promise<void> {
	await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
}

/**
 * Every test gets its own temporary workspace folder so no test can observe or
 * corrupt another test's board bundle, even when the suite is re-ordered.
 */
async function withWorkspace(
	label: string,
	body: (root: vscode.Uri) => Promise<void>,
): Promise<void> {
	const root = vscode.Uri.file(path.join(
		os.tmpdir(),
		`ledgerboard-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	));
	await vscode.workspace.fs.createDirectory(root);
	try {
		await body(root);
	} finally {
		await removeFixture(root);
	}
}

suite('Extension Test Suite', function () {
	this.timeout(30_000);

	suiteSetup(async () => {
		const extension = vscode.extensions.getExtension('ricky-g.ledgerboard');
		assert.ok(extension, 'LedgerBoard extension was not discovered by the test host.');
		await extension.activate();
	});

	test('registers the public command surface', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('ledgerBoard.initializeBoard'));
		assert.ok(commands.includes('ledgerBoard.openBoard'));
		assert.ok(commands.includes('ledgerBoard.addOutcome'));
		assert.ok(commands.includes('ledgerBoard.validateBoard'));
		assert.ok(commands.includes('ledgerBoard.normalizeBoard'));
		assert.ok(commands.includes('ledgerBoard.openStandard'));
	});

	test('repository diagnostics and normalization preserve history', async () => {
		const root = vscode.Uri.file(path.join(os.tmpdir(), `ledgerboard-normalize-${Date.now()}`));
		await vscode.workspace.fs.createDirectory(root);
		try {
			const repository = new BoardRepository(root);
			await repository.initialize();
			const base = await repository.read();
			const adjacentCards = base.boardSource.replace(
				'<!-- empty -->',
				'- [ ] AO-001 — First ticket · P1 · area:meta\n'
					+ '    - **Description:** First description.\n'
					+ '- [ ] AO-002 — Second ticket · P2 · area:meta\n'
					+ '    - **Description:** Second description.',
			);
			const boardDocument = await vscode.workspace.openTextDocument(repository.uri(BOARD_FILE));
			const edit = new vscode.WorkspaceEdit();
			edit.replace(
				boardDocument.uri,
				new vscode.Range(boardDocument.positionAt(0), boardDocument.positionAt(boardDocument.getText().length)),
				adjacentCards,
			);
			assert.equal(await vscode.workspace.applyEdit(edit), true);
			assert.equal(await boardDocument.save(), true);
			const invalid = await repository.read();

			assert.throws(
				() => repository.validate(invalid),
				/Cards AO-001 and AO-002 must be separated by exactly one blank physical line/,
			);
			const result = await repository.normalizeBoard(invalid.boardSource);
			const normalized = await repository.read();
			assert.equal(result.changed, true);
			assert.equal(normalized.historySource, invalid.historySource);
			assert.doesNotThrow(() => repository.validate(normalized));
			assert.match(normalized.boardSource, /First description\.\n\n- \[ \] AO-002/);

			await assert.rejects(
				repository.normalizeBoard(invalid.boardSource),
				/changed outside LedgerBoard/,
			);
		} finally {
			await removeFixture(root);
		}
	});

	test('repository normalization refuses multiline descriptions', async () => {
		const root = vscode.Uri.file(path.join(os.tmpdir(), `ledgerboard-multiline-${Date.now()}`));
		await vscode.workspace.fs.createDirectory(root);
		try {
			const repository = new BoardRepository(root);
			await repository.initialize();
			const base = await repository.read();
			const multiline = base.boardSource.replace(
				'<!-- empty -->',
				'- [ ] AO-001 — First ticket · P1 · area:meta\n'
					+ '    - **Description:** First line.\n'
					+ '      Second physical line.',
			);
			const boardDocument = await vscode.workspace.openTextDocument(repository.uri(BOARD_FILE));
			const edit = new vscode.WorkspaceEdit();
			edit.replace(
				boardDocument.uri,
				new vscode.Range(boardDocument.positionAt(0), boardDocument.positionAt(boardDocument.getText().length)),
				multiline,
			);
			assert.equal(await vscode.workspace.applyEdit(edit), true);
			assert.equal(await boardDocument.save(), true);

			await assert.rejects(
				repository.normalizeBoard(multiline),
				/Description for AO-001 must stay on one physical line/,
			);
		} finally {
			await removeFixture(root);
		}
	});

	test('initializes, validates, saves, and rejects stale writes', async () => {
		const root = vscode.Uri.file(path.join(os.tmpdir(), `ledgerboard-${Date.now()}`));
		await vscode.workspace.fs.createDirectory(root);
		try {
			const repository = new BoardRepository(root);
			const started = performance.now();
			const initialized = await repository.initialize();
			const initializationMs = performance.now() - started;
			assert.deepEqual(initialized.created.sort(), ['BOARD.md', 'KANBAN-CONFIG.md', 'KANBAN-HISTORY.md'].sort());
			assert.ok(initializationMs < 5_000, `Initialization took ${Math.round(initializationMs)}ms; budget is 5000ms.`);

			const base = await repository.read();
			const validation = repository.validate(base);
			assert.equal(validation.cardCount, 0);
			assert.equal(validation.config.entities.length, 1);
			assert.equal(validation.config.people.length, 0);

			const config = boardModel.parseConfig(base.configSource);
			config.workspace.name = 'Integration Test';
			const nextConfigSource = boardModel.serializeConfig(base.configSource, config);
			const saved = await repository.save({
				base,
				nextBoardSource: base.boardSource,
				nextConfigSource,
				saveBoard: false,
				saveConfig: true,
			});
			assert.equal(boardModel.parseConfig(saved.configSource).workspace.name, 'Integration Test');

			await assert.rejects(
				repository.save({
					base,
					nextBoardSource: base.boardSource,
					nextConfigSource,
					saveBoard: false,
					saveConfig: true,
				}),
				/changed outside LedgerBoard/,
			);
		} finally {
			await removeFixture(root);
		}
	});

	test('persists assignment and unassignment history', async () => {
		const root = vscode.Uri.file(path.join(os.tmpdir(), `ledgerboard-assignment-${Date.now()}`));
		await vscode.workspace.fs.createDirectory(root);
		try {
			const repository = new BoardRepository(root);
			await repository.initialize();
			const base = await repository.read();
			const config = boardModel.parseConfig(base.configSource);
			config.people.push({ id: 'alex-smith', name: 'Alex Smith', color: '#7257b5' });
			const assignedBoardSource = base.boardSource.replace(
				'<!-- empty -->',
				'- [ ] AO-001 — Prepare review · P2 · area:meta\n'
					+ '    - **Assignee:** alex-smith',
			);
			const assigned = await repository.save({
				base,
				nextBoardSource: assignedBoardSource,
				nextConfigSource: boardModel.serializeConfig(base.configSource, config),
				saveBoard: true,
				saveConfig: true,
			});
			assert.equal(assigned.events[0].assignee, 'alex-smith');

			const board = boardModel.parseBoard(assigned.boardSource);
			board.columns[0].cards[0].detailValues.assignee = '';
			const unassigned = await repository.save({
				base: assigned,
				nextBoardSource: boardModel.serializeBoard(board),
				nextConfigSource: assigned.configSource,
				saveBoard: true,
				saveConfig: false,
			});
			const history = boardModel.parseHistory(unassigned.historySource).events;
			assert.equal(history.at(-1)?.previousAssignee, 'alex-smith');
			assert.equal(history.at(-1)?.assignee, null);
		} finally {
			await removeFixture(root);
		}
	});

	test('persists a duplicated card with its creation source', async () => {
		await withWorkspace('duplicate-history', async (root) => {
			const repository = new BoardRepository(root);
			await repository.initialize();
			const base = await repository.read();
			const created = await repository.save({
				base,
				nextBoardSource: base.boardSource.replace(
					'<!-- empty -->',
					'- [ ] AO-001 — Prepare the release · P1 · area:meta\n'
						+ '    - **Description:** Collect final approval evidence.',
				),
				nextConfigSource: base.configSource,
				saveBoard: true,
				saveConfig: false,
			});
			const board = boardModel.parseBoard(created.boardSource);
			const duplicate = boardModel.duplicateCard(
				board,
				'AO-001',
				boardModel.parseHistory(created.historySource).events,
			);

			const saved = await repository.save({
				base: created,
				nextBoardSource: boardModel.serializeBoard(board),
				nextConfigSource: created.configSource,
				saveBoard: true,
				saveConfig: false,
				duplicateSources: { [duplicate.id]: 'AO-001' },
			});

			assert.equal(saved.events.length, 1);
			assert.equal(saved.events[0].event, 'created');
			assert.equal(saved.events[0].duplicatedFrom, 'AO-001');
			assert.equal(saved.events[0].card, duplicate.id);
			assert.equal(boardModel.parseHistory(saved.historySource).events.at(-1)?.duplicatedFrom, 'AO-001');
		});
	});

	test('prefers a valid workspace-root board over invalid nested bundles', async () => {
		const root = vscode.Uri.file(path.join(os.tmpdir(), `ledgerboard-discovery-${Date.now()}`));
		const nested = vscode.Uri.joinPath(root, 'reference', 'nested-board');
		await vscode.workspace.fs.createDirectory(nested);
		try {
			await new BoardRepository(root).initialize();
			const nestedRepository = new BoardRepository(nested);
			await nestedRepository.initialize();
			const nestedBundle = await nestedRepository.read();
			const invalidBoard = nestedBundle.boardSource.replace(
				'<!-- empty -->',
				'- [ ] AO-001 — Invalid nested ticket · P2 · area:missing-label',
			);
			await vscode.workspace.fs.writeFile(
				nestedRepository.uri(BOARD_FILE),
				new TextEncoder().encode(invalidBoard),
			);

			const discovery = await discoverBoardRepositories([{
				uri: root,
				name: 'Test workspace',
				index: 0,
			}]);

			assert.equal(discovery.scope, 'workspace-roots');
			assert.equal(discovery.valid.length, 1);
			assert.equal(discovery.valid[0].repository.root.toString(), root.toString());
			assert.equal(discovery.invalid.length, 0);
		} finally {
			await removeFixture(root);
		}
	});

	test('classifies separator-only invalid boards as normalizable', async () => {
		const root = vscode.Uri.file(path.join(os.tmpdir(), `ledgerboard-invalid-discovery-${Date.now()}`));
		await vscode.workspace.fs.createDirectory(root);
		try {
			const repository = new BoardRepository(root);
			await repository.initialize();
			const bundle = await repository.readFromDisk();
			const adjacent = bundle.boardSource.replace(
				'<!-- empty -->',
				'- [ ] AO-001 — First ticket · P1 · area:meta\n'
					+ '- [ ] AO-002 — Second ticket · P2 · area:meta',
			);
			await vscode.workspace.fs.writeFile(repository.uri(BOARD_FILE), new TextEncoder().encode(adjacent));

			const discovery = await discoverBoardRepositories([{ uri: root, name: 'Invalid board', index: 0 }]);
			assert.equal(discovery.valid.length, 0);
			assert.equal(discovery.invalid.length, 1);
			assert.equal(discovery.invalid[0].canNormalize, true);
			assert.ok(discovery.invalid[0].line && discovery.invalid[0].line > 0);
			assert.match(discovery.invalid[0].message, /Cards AO-001 and AO-002/);
		} finally {
			await removeFixture(root);
		}
	});

	test('discovers twenty workspace-root boards within the performance budget', async () => {
		const parent = vscode.Uri.file(path.join(os.tmpdir(), `ledgerboard-performance-${Date.now()}`));
		await vscode.workspace.fs.createDirectory(parent);
		try {
			const folders = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
				const uri = vscode.Uri.joinPath(parent, `board-${index}`);
				await vscode.workspace.fs.createDirectory(uri);
				await new BoardRepository(uri).initialize();
				return { uri, name: `Board ${index}`, index };
			}));
			const started = performance.now();
			const discovery = await discoverBoardRepositories(folders);
			const durationMs = performance.now() - started;

			assert.equal(discovery.valid.length, 20);
			assert.equal(discovery.invalid.length, 0);
			assert.ok(durationMs < 5_000, `Discovery took ${Math.round(durationMs)}ms; budget is 5000ms.`);
		} finally {
			await removeFixture(parent);
		}
	});

	test('every contributed command is registered by activation', async () => {
		const extension = vscode.extensions.getExtension('ricky-g.ledgerboard');
		assert.ok(extension);
		const contributed: Array<{ command: string }> = extension.packageJSON.contributes.commands;
		const registered = new Set(await vscode.commands.getCommands(true));
		const missing = contributed
			.map((entry) => entry.command)
			.filter((command) => !registered.has(command));
		assert.deepEqual(missing, [], `Commands declared but never registered: ${missing}`);
	});

	test('the initialize command creates a complete bundle and opens the webview', async () => {
		await withWorkspace('command-initialize', async (root) => {
			await vscode.commands.executeCommand('ledgerBoard.initializeBoard', root);

			const repository = new BoardRepository(root);
			const panelTitle = `LedgerBoard · ${repository.name}`;
			const panelIsOpen = () => vscode.window.tabGroups.all
				.flatMap((group) => group.tabs)
				.some((tab) => tab.label === panelTitle);
			const deadline = Date.now() + 10_000;
			while ((!await repository.exists() || !panelIsOpen()) && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}

			assert.equal(await repository.exists(), true, 'The command did not create the bundle.');
			assert.equal(panelIsOpen(), true, 'The command did not open the generated webview.');
			const validation = repository.validate(await repository.readFromDisk());
			assert.equal(validation.cardCount, 0);
			assert.equal(validation.diagnostics.length, 0);
		});
	});

	test('bundles fixed first-open positioning for ticket action menus', async () => {
		const extension = vscode.extensions.getExtension('ricky-g.ledgerboard');
		assert.ok(extension, 'LedgerBoard extension was not discovered by the test host.');
		const html = new TextDecoder().decode(await vscode.workspace.fs.readFile(
			vscode.Uri.joinPath(extension.extensionUri, 'media', 'index.html'),
		));

		assert.match(
			html,
			/\.card-action-menu\s*\{[^}]*\bposition:\s*fixed;/,
			'The action menu must be fixed before its initial dimensions are measured.',
		);
		assert.match(
			html,
			/window\.LedgerBoardMenuPosition/,
			'The generated webview must use the shared viewport positioning helper.',
		);
	});

	test('initialization preserves files that already exist', async () => {
		await withWorkspace('preserve', async (root) => {
			const repository = new BoardRepository(root);
			await repository.initialize();
			const withCard = (await repository.readFromDisk()).boardSource.replace(
				'<!-- empty -->',
				'- [ ] AO-001 — Existing ticket · P2 · area:meta',
			);
			await vscode.workspace.fs.writeFile(
				repository.uri(BOARD_FILE),
				new TextEncoder().encode(withCard),
			);

			const second = await repository.initialize();
			assert.deepEqual(second.created, []);
			assert.deepEqual([...second.preserved].sort(), [...BUNDLE_FILES].sort());
			assert.match((await repository.readFromDisk()).boardSource, /AO-001 — Existing ticket/);
		});
	});

	test('exists reports false while any bundle file is missing', async () => {
		await withWorkspace('partial-bundle', async (root) => {
			const repository = new BoardRepository(root);
			assert.equal(await repository.exists(), false);

			await repository.initialize();
			assert.equal(await repository.exists(), true);

			await vscode.workspace.fs.delete(repository.uri(HISTORY_FILE), { useTrash: false });
			assert.equal(await repository.exists(), false, 'A partial bundle must not count as a board.');
		});
	});

	test('read observes unsaved editor text while readFromDisk observes the file', async () => {
		await withWorkspace('dirty-editor', async (root) => {
			const repository = new BoardRepository(root);
			await repository.initialize();
			const document = await vscode.workspace.openTextDocument(repository.uri(BOARD_FILE));
			const edit = new vscode.WorkspaceEdit();
			edit.replace(
				document.uri,
				new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
				document.getText().replace(
					'<!-- empty -->',
					'- [ ] AO-001 — Unsaved ticket · P3 · area:meta',
				),
			);
			assert.equal(await vscode.workspace.applyEdit(edit), true);

			assert.match((await repository.read()).boardSource, /AO-001 — Unsaved ticket/);
			assert.doesNotMatch((await repository.readFromDisk()).boardSource, /AO-001 — Unsaved ticket/);

			assert.equal(await document.save(), true);
			assert.match((await repository.readFromDisk()).boardSource, /AO-001 — Unsaved ticket/);
		});
	});

	test('saving a board rejects an externally rewritten history ledger', async () => {
		await withWorkspace('stale-history', async (root) => {
			const repository = new BoardRepository(root);
			await repository.initialize();
			const base = await repository.read();
			const nextBoardSource = base.boardSource.replace(
				'<!-- empty -->',
				'- [ ] AO-001 — Recorded ticket · P1 · area:meta',
			);

			const historyDocument = await vscode.workspace.openTextDocument(repository.uri(HISTORY_FILE));
			const edit = new vscode.WorkspaceEdit();
			edit.insert(historyDocument.uri, historyDocument.positionAt(historyDocument.getText().length), '\n');
			assert.equal(await vscode.workspace.applyEdit(edit), true);
			assert.equal(await historyDocument.save(), true);

			await assert.rejects(
				repository.save({
					base,
					nextBoardSource,
					nextConfigSource: base.configSource,
					saveBoard: true,
					saveConfig: false,
				}),
				new RegExp(`${HISTORY_FILE} changed outside LedgerBoard`),
			);
		});
	});

	test('saving a board that fails validation leaves every file untouched', async () => {
		await withWorkspace('atomic-save', async (root) => {
			const repository = new BoardRepository(root);
			await repository.initialize();
			const base = await repository.read();

			await assert.rejects(repository.save({
				base,
				// area:not-a-real-label is not present in KANBAN-CONFIG.md.
				nextBoardSource: base.boardSource.replace(
					'<!-- empty -->',
					'- [ ] AO-001 — Rejected ticket · P1 · area:not-a-real-label',
				),
				nextConfigSource: base.configSource,
				saveBoard: true,
				saveConfig: false,
			}));

			const afterFailure = await repository.readFromDisk();
			assert.equal(afterFailure.boardSource, base.boardSource);
			assert.equal(afterFailure.configSource, base.configSource);
			assert.equal(
				afterFailure.historySource,
				base.historySource,
				'A rejected save must not append history events.',
			);
		});
	});

	test('the file watcher only reports the bundle files and disposes cleanly', async () => {
		await withWorkspace('watcher', async (root) => {
			const repository = new BoardRepository(root);
			await repository.initialize();

			const observed: string[] = [];
			const subscription = repository.watch((fileName) => observed.push(fileName));
			try {
				// VS Code installs watchers for folders outside the workspace
				// asynchronously, so give the provider a moment before writing.
				await new Promise((resolve) => setTimeout(resolve, 2_000));

				const bundle = await repository.readFromDisk();
				await vscode.workspace.fs.writeFile(
					repository.uri(CONFIG_FILE),
					new TextEncoder().encode(`${bundle.configSource}\n`),
				);
				// A sibling Markdown file matches the watcher glob but is not part
				// of the bundle, so it must never reach the callback.
				await vscode.workspace.fs.writeFile(
					vscode.Uri.joinPath(root, 'NOTES.md'),
					new TextEncoder().encode('# Not part of the bundle\n'),
				);

				const deadline = Date.now() + 5_000;
				while (observed.length === 0 && Date.now() < deadline) {
					await new Promise((resolve) => setTimeout(resolve, 100));
				}

				// File-system notification delivery is an operating-system service,
				// so the assertion covers the filter rather than the delivery: any
				// event that does arrive must name a bundle file and nothing else.
				const unexpected = observed.filter((fileName) => !BUNDLE_FILES.includes(
					fileName as typeof BUNDLE_FILES[number],
				));
				assert.deepEqual(
					unexpected,
					[],
					`The watcher reported files outside the bundle: ${JSON.stringify(unexpected)}`,
				);
				assert.ok(
					!observed.includes(BOARD_FILE),
					`${BOARD_FILE} never changed but the watcher reported it.`,
				);
			} finally {
				subscription.dispose();
				// Disposal must be idempotent so a panel can dispose during teardown.
				assert.doesNotThrow(() => subscription.dispose());
			}
		});
	});

	test('discovery falls back to descendant boards when no workspace root holds one', async () => {
		await withWorkspace('descendants', async (root) => {
			const nested = vscode.Uri.joinPath(root, 'programmes', 'alpha');
			await vscode.workspace.fs.createDirectory(nested);
			await new BoardRepository(nested).initialize();

			const discovery = await discoverBoardRepositories([{ uri: root, name: 'Outer', index: 0 }]);

			// The workspace root has no bundle, so discovery must widen its search
			// rather than reporting that the workspace holds no board at all.
			assert.equal(discovery.scope, 'workspace-descendants');
		});
	});

	test('a round trip through the model preserves byte-for-byte Markdown', async () => {
		await withWorkspace('round-trip', async (root) => {
			const repository = new BoardRepository(root);
			await repository.initialize();
			const base = await repository.read();
			const populated = base.boardSource.replace(
				'<!-- empty -->',
				'- [ ] AO-001 — Round trip ticket · P2 · area:meta\n'
					+ '    - **Description:** Stable text.',
			);

			const parsed = boardModel.parseBoard(populated);
			assert.equal(
				boardModel.serializeBoard(parsed),
				populated,
				'parseBoard then serializeBoard must not rewrite the author\'s Markdown.',
			);
			assert.equal(
				boardModel.serializeConfig(base.configSource, boardModel.parseConfig(base.configSource)),
				base.configSource,
			);
		});
	});

	test('the standard command opens the bundled BOARD-STANDARDS document', async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await vscode.commands.executeCommand('ledgerBoard.openStandard');

		const deadline = Date.now() + 10_000;
		while (Date.now() < deadline) {
			const open = vscode.workspace.textDocuments.some(
				(document) => document.uri.fsPath.endsWith('BOARD-STANDARDS.md'),
			);
			const previewed = vscode.window.tabGroups.all.some((group) => group.tabs.some(
				(tab) => tab.label.includes('BOARD-STANDARDS'),
			));
			if (open || previewed) {
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		assert.fail('ledgerBoard.openStandard did not surface BOARD-STANDARDS.md.');
	});
});
