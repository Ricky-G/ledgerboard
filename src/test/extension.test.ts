import * as vscode from 'vscode';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import { discoverBoardRepositories } from '../boardDiscovery';
import { BoardRepository } from '../boardRepository';
import { boardModel } from '../model';
import { BOARD_FILE } from '../templates';

async function removeFixture(uri: vscode.Uri): Promise<void> {
	await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
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
				'- [ ] AO-001 — First outcome · P1 · area:meta\n'
					+ '    - **Description:** First description.\n'
					+ '- [ ] AO-002 — Second outcome · P2 · area:meta\n'
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
				'- [ ] AO-001 — First outcome · P1 · area:meta\n'
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
				'- [ ] AO-001 — Invalid nested outcome · P2 · area:missing-entity',
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
				'- [ ] AO-001 — First outcome · P1 · area:meta\n'
					+ '- [ ] AO-002 — Second outcome · P2 · area:meta',
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
});
