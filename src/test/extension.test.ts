import * as vscode from 'vscode';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import { discoverBoardRepositories } from '../boardDiscovery';
import { BoardRepository } from '../boardRepository';
import { boardModel } from '../model';
import { BOARD_FILE } from '../templates';

suite('Extension Test Suite', function () {
	this.timeout(15_000);

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
		assert.ok(commands.includes('ledgerBoard.openStandard'));
	});

	test('initializes, validates, saves, and rejects stale writes', async () => {
		const root = vscode.Uri.file(path.join(os.tmpdir(), `ledgerboard-${Date.now()}`));
		await vscode.workspace.fs.createDirectory(root);
		try {
			const repository = new BoardRepository(root);
			const initialized = await repository.initialize();
			assert.deepEqual(initialized.created.sort(), ['BOARD.md', 'KANBAN-CONFIG.md', 'KANBAN-HISTORY.md'].sort());

			const base = await repository.read();
			const validation = repository.validate(base);
			assert.equal(validation.cardCount, 0);
			assert.equal(validation.config.entities.length, 1);

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
			await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
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
			await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
		}
	});
});
