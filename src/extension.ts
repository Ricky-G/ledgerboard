import * as vscode from 'vscode';
import { discoverBoardRepositories } from './boardDiscovery';
import { BoardPanel } from './boardPanel';
import { BoardRepository } from './boardRepository';
import { boardModel } from './model';

let recentRepository: BoardRepository | undefined;

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
    vscode.commands.registerCommand('ledgerBoard.validateBoard', () => validateBoard(context)),
    vscode.commands.registerCommand('ledgerBoard.normalizeBoard', () => normalizeBoard(context)),
    vscode.commands.registerCommand('ledgerBoard.openStandard', () => openStandard(context)),
  );
}

async function initializeBoard(context: vscode.ExtensionContext, uri?: vscode.Uri): Promise<void> {
  try {
    const root = await chooseTargetFolder(uri);
    if (!root) {return;}

    const repository = new BoardRepository(root);
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: `Initializing LedgerBoard in ${repository.name}…` },
      () => repository.initialize(),
    );
    const detail = result.created.length > 0
      ? `Created ${result.created.join(', ')}${result.preserved.length ? `; preserved ${result.preserved.join(', ')}` : ''}.`
      : 'The board bundle already exists; no files were overwritten.';
    void vscode.window.showInformationMessage(`LedgerBoard initialized in ${repository.name}. ${detail}`);
    recentRepository = repository;
    BoardPanel.show(context, repository);
  } catch (error) {
    void vscode.window.showErrorMessage(`LedgerBoard initialization failed: ${errorMessage(error)}`);
  }
}

async function openBoard(context: vscode.ExtensionContext): Promise<void> {
  try {
    const repository = await chooseExistingBoard();
    if (!repository) {return;}
    recentRepository = repository;
    BoardPanel.show(context, repository);
  } catch (error) {
    void vscode.window.showErrorMessage(`LedgerBoard could not open the board: ${errorMessage(error)}`);
  }
}

async function addOutcome(context: vscode.ExtensionContext): Promise<void> {
  try {
    const repository = await recentOrChooseExistingBoard();
    if (!repository) {return;}
    BoardPanel.show(context, repository).openNewCard();
  } catch (error) {
    void vscode.window.showErrorMessage(`LedgerBoard could not add an outcome: ${errorMessage(error)}`);
  }
}

async function validateBoard(context: vscode.ExtensionContext): Promise<void> {
  const repository = await recentOrChooseBoardForMaintenance();
  if (!repository) {return;}

  try {
    const validation = repository.validate(await repository.read());
    const warningDetail = validation.warnings.length > 0 ? ` ${validation.warnings.length} warning(s) were preserved.` : '';
    await vscode.window.showInformationMessage(
      `LedgerBoard is valid: ${validation.cardCount} cards, ${validation.config.entities.length} entities, ${validation.historyEvents.length} history events.${warningDetail}`,
    );
  } catch (error) {
    const actions = errorCanNormalize(error) ? ['Normalize formatting', 'Open BOARD.md'] : ['Open BOARD.md'];
    const action = await vscode.window.showErrorMessage(
      `LedgerBoard validation failed: ${errorMessage(error)}`,
      ...actions,
    );
    if (action === 'Normalize formatting') {
      await normalizeRepository(context, repository);
    } else if (action === 'Open BOARD.md') {
      await openBoardMarkdown(repository, errorLine(error));
    }
  }
}

async function normalizeBoard(context: vscode.ExtensionContext): Promise<void> {
  const repository = await recentOrChooseBoardForMaintenance();
  if (!repository) {return;}
  await normalizeRepository(context, repository);
}

async function normalizeRepository(context: vscode.ExtensionContext, repository: BoardRepository): Promise<void> {
  try {
    const bundle = await repository.read();
    const analysis = boardModel.analyzeBoardSource(bundle.boardSource);
    if (analysis.errors.length === 0) {
      await vscode.window.showInformationMessage('BOARD.md already uses canonical LedgerBoard formatting.');
      return;
    }
    if (!analysis.canNormalize) {
      const first = analysis.errors[0];
      const action = await vscode.window.showErrorMessage(
        `LedgerBoard cannot safely normalize this file: ${first.message}`,
        'Open BOARD.md',
      );
      if (action === 'Open BOARD.md') {await openBoardMarkdown(repository, first.line);}
      return;
    }

    const changes = [...new Set(analysis.errors.map((item) => item.message))];
    const confirmation = await vscode.window.showWarningMessage(
      `Normalize BOARD.md formatting? LedgerBoard will fix ${changes.length} formatting issue(s) without changing cards or history.`,
      { modal: true, detail: changes.slice(0, 5).join('\n') },
      'Normalize',
    );
    if (confirmation !== 'Normalize') {return;}

    const result = await repository.normalizeBoard(bundle.boardSource);
    if (result.changed) {
      await vscode.window.showInformationMessage('BOARD.md formatting normalized. No semantic history event was added.');
      BoardPanel.show(context, repository);
    }
  } catch (error) {
    const action = await vscode.window.showErrorMessage(
      `LedgerBoard normalization failed: ${errorMessage(error)}`,
      'Open BOARD.md',
    );
    if (action === 'Open BOARD.md') {await openBoardMarkdown(repository, errorLine(error));}
  }
}

async function openStandard(context: vscode.ExtensionContext): Promise<void> {
  const uri = vscode.Uri.joinPath(context.extensionUri, 'BOARD-STANDARDS.md');
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: false });
}

async function chooseExistingBoard(): Promise<BoardRepository | undefined> {
  const discovery = await discoverWithProgress('Finding LedgerBoard bundles…');
  const repositories = discovery.valid.map((candidate) => candidate.repository);

  if (repositories.length === 1) {return rememberRepository(repositories[0]);}
  if (repositories.length > 1) {
    const selected = await vscode.window.showQuickPick(
      repositories.map((repository) => ({
        label: repository.name,
        description: vscode.workspace.asRelativePath(repository.root, false),
        repository,
      })),
      { title: 'Open LedgerBoard', placeHolder: 'Choose a Markdown board bundle' },
    );
    return selected?.repository ? rememberRepository(selected.repository) : undefined;
  }

  if (discovery.invalid.length > 0) {
    const invalid = discovery.invalid[0];
    const actions = invalid.canNormalize
      ? ['Normalize formatting', 'Open BOARD.md', 'Choose folder']
      : ['Open BOARD.md', 'Choose folder'];
    const action = await vscode.window.showErrorMessage(
      `LedgerBoard found ${invalid.repository.name}, but it is invalid: ${invalid.message}`,
      ...actions,
    );
    if (action === 'Normalize formatting') {
      recentRepository = invalid.repository;
      await vscode.commands.executeCommand('ledgerBoard.normalizeBoard');
      return undefined;
    }
    if (action === 'Open BOARD.md') {
      await openBoardMarkdown(invalid.repository, invalid.line);
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

async function chooseBoardForMaintenance(): Promise<BoardRepository | undefined> {
  const discovery = await discoverWithProgress('Checking LedgerBoard bundles…');
  const candidates = [
    ...discovery.valid.map((item) => ({ repository: item.repository, issue: '' })),
    ...discovery.invalid.map((item) => ({ repository: item.repository, issue: item.message })),
  ];
  if (candidates.length === 1) {return rememberRepository(candidates[0].repository);}
  if (candidates.length > 1) {
    const selected = await vscode.window.showQuickPick(
      candidates.map((candidate) => ({
        label: candidate.repository.name,
        description: vscode.workspace.asRelativePath(candidate.repository.root, false),
        detail: candidate.issue || 'Valid LedgerBoard bundle',
        repository: candidate.repository,
      })),
      { title: 'Maintain LedgerBoard', placeHolder: 'Choose a board bundle' },
    );
    return selected?.repository ? rememberRepository(selected.repository) : undefined;
  }
  return chooseBoardFolder(false);
}

async function recentOrChooseExistingBoard(): Promise<BoardRepository | undefined> {
  if (recentRepository && await recentRepository.exists()) {return recentRepository;}
  return chooseExistingBoard();
}

async function recentOrChooseBoardForMaintenance(): Promise<BoardRepository | undefined> {
  if (recentRepository && await recentRepository.exists()) {return recentRepository;}
  return chooseBoardForMaintenance();
}

function rememberRepository(repository: BoardRepository): BoardRepository {
  recentRepository = repository;
  return repository;
}

function discoverWithProgress(title: string): Thenable<Awaited<ReturnType<typeof discoverBoardRepositories>>> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title },
    () => discoverBoardRepositories(),
  );
}

async function chooseBoardFolder(validate = true): Promise<BoardRepository | undefined> {
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
  if (validate) {repository.validate(await repository.read());}
  return rememberRepository(repository);
}

async function openBoardMarkdown(repository: BoardRepository, line?: number | null): Promise<void> {
  const document = await vscode.workspace.openTextDocument(repository.uri('BOARD.md'));
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  if (line && line > 0) {
    const position = new vscode.Position(Math.min(line - 1, document.lineCount - 1), 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }
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

function errorCanNormalize(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'canNormalize' in error && error.canNormalize);
}

function errorLine(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('line' in error)) {return null;}
  return typeof error.line === 'number' ? error.line : null;
}

export function deactivate(): void {}
