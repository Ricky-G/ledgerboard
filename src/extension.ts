import * as vscode from 'vscode';
import { discoverBoardRepositories } from './boardDiscovery';
import { BoardPanel } from './boardPanel';
import { BoardRepository } from './boardRepository';

export function activate(context: vscode.ExtensionContext): void {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  status.name = 'LedgerBoard';
  status.text = '$(project) LedgerBoard';
  status.tooltip = 'Open your local-first Markdown Kanban board';
  status.command = 'ledgerBoard.openBoard';
  status.show();

  context.subscriptions.push(
    status,
    vscode.commands.registerCommand('ledgerBoard.initializeBoard', (uri?: vscode.Uri) => initializeBoard(context, uri)),
    vscode.commands.registerCommand('ledgerBoard.openBoard', () => openBoard(context)),
    vscode.commands.registerCommand('ledgerBoard.addOutcome', () => addOutcome(context)),
    vscode.commands.registerCommand('ledgerBoard.validateBoard', () => validateBoard()),
    vscode.commands.registerCommand('ledgerBoard.openStandard', () => openStandard(context)),
  );
}

async function initializeBoard(context: vscode.ExtensionContext, uri?: vscode.Uri): Promise<void> {
  try {
    const root = await chooseTargetFolder(uri);
    if (!root) {return;}

    const repository = new BoardRepository(root);
    const result = await repository.initialize();
    const detail = result.created.length > 0
      ? `Created ${result.created.join(', ')}${result.preserved.length ? `; preserved ${result.preserved.join(', ')}` : ''}.`
      : 'The board bundle already exists; no files were overwritten.';
    void vscode.window.showInformationMessage(`LedgerBoard initialized in ${repository.name}. ${detail}`);
    BoardPanel.show(context, repository);
  } catch (error) {
    void vscode.window.showErrorMessage(`LedgerBoard initialization failed: ${errorMessage(error)}`);
  }
}

async function openBoard(context: vscode.ExtensionContext): Promise<void> {
  try {
    const repository = await chooseExistingBoard();
    if (!repository) {return;}
    BoardPanel.show(context, repository);
  } catch (error) {
    void vscode.window.showErrorMessage(`LedgerBoard could not open the board: ${errorMessage(error)}`);
  }
}

async function addOutcome(context: vscode.ExtensionContext): Promise<void> {
  try {
    const repository = await chooseExistingBoard();
    if (!repository) {return;}
    BoardPanel.show(context, repository).openNewCard();
  } catch (error) {
    void vscode.window.showErrorMessage(`LedgerBoard could not add an outcome: ${errorMessage(error)}`);
  }
}

async function validateBoard(): Promise<void> {
  try {
    const repository = await chooseExistingBoard();
    if (!repository) {return;}
    const validation = repository.validate(await repository.read());
    void vscode.window.showInformationMessage(
      `LedgerBoard is valid: ${validation.cardCount} cards, ${validation.config.entities.length} entities, ${validation.historyEvents.length} history events.`,
    );
  } catch (error) {
    void vscode.window.showErrorMessage(`LedgerBoard validation failed: ${errorMessage(error)}`);
  }
}

async function openStandard(context: vscode.ExtensionContext): Promise<void> {
  const uri = vscode.Uri.joinPath(context.extensionUri, 'BOARD-STANDARDS.md');
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: false });
}

async function chooseExistingBoard(): Promise<BoardRepository | undefined> {
  const discovery = await discoverBoardRepositories();
  const repositories = discovery.valid.map((candidate) => candidate.repository);

  if (repositories.length === 1) {return repositories[0];}
  if (repositories.length > 1) {
    const selected = await vscode.window.showQuickPick(
      repositories.map((repository) => ({
        label: repository.name,
        description: vscode.workspace.asRelativePath(repository.root, false),
        repository,
      })),
      { title: 'Open LedgerBoard', placeHolder: 'Choose a Markdown board bundle' },
    );
    return selected?.repository;
  }

  if (discovery.invalid.length > 0) {
    const invalid = discovery.invalid[0];
    const action = await vscode.window.showErrorMessage(
      `LedgerBoard found ${invalid.repository.name}, but it is invalid: ${invalid.message}`,
      'Open BOARD.md',
      'Choose folder',
    );
    if (action === 'Open BOARD.md') {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(invalid.repository.uri('BOARD.md')));
      return undefined;
    }
    if (action === 'Choose folder') {
      return chooseBoardFolder();
    }
    return undefined;
  }

  const action = await vscode.window.showInformationMessage(
    'No LedgerBoard bundle was found in this workspace.',
    'Initialize board',
    'Choose folder',
  );
  if (action === 'Initialize board') {
    await vscode.commands.executeCommand('ledgerBoard.initializeBoard');
    return undefined;
  }
  if (action === 'Choose folder') {
    return chooseBoardFolder();
  }
  return undefined;
}

async function chooseBoardFolder(): Promise<BoardRepository | undefined> {
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    title: 'Choose a LedgerBoard folder',
    openLabel: 'Open board',
  });
  if (!selected?.[0]) {return undefined;}

  const repository = new BoardRepository(selected[0]);
  if (!await repository.exists()) {
    void vscode.window.showWarningMessage('That folder does not contain BOARD.md, KANBAN-CONFIG.md, and KANBAN-HISTORY.md.');
    return undefined;
  }
  repository.validate(await repository.read());
  return repository;
}

async function chooseTargetFolder(uri?: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (uri) {
    const stat = await vscode.workspace.fs.stat(uri);
    return stat.type === vscode.FileType.Directory ? uri : vscode.Uri.joinPath(uri, '..');
  }

  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1) {return folders[0].uri;}
  if (folders.length > 1) {
    const selected = await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Choose where to initialize LedgerBoard' });
    return selected?.uri;
  }

  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    title: 'Choose a folder for LedgerBoard',
    openLabel: 'Initialize here',
  });
  return selected?.[0];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function deactivate(): void {}
