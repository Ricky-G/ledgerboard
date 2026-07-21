import * as path from 'node:path';
import * as vscode from 'vscode';
import { boardModel, type BoardDiagnostic, type BoardDocument, type HistoryEvent, type KanbanConfig } from './model';
import {
  BOARD_FILE,
  BOARD_TEMPLATE,
  BUNDLE_FILES,
  CONFIG_FILE,
  createConfigTemplate,
  HISTORY_FILE,
  HISTORY_TEMPLATE,
  localIsoTimestamp,
} from './templates';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export interface BoardBundle {
  boardSource: string;
  configSource: string;
  historySource: string;
}

export interface BundleValidation {
  board: BoardDocument;
  config: KanbanConfig;
  historyEvents: HistoryEvent[];
  cardCount: number;
  diagnostics: BoardDiagnostic[];
  warnings: BoardDiagnostic[];
}

export interface SaveRequest {
  base: BoardBundle;
  nextBoardSource: string;
  nextConfigSource: string;
  saveBoard: boolean;
  saveConfig: boolean;
}

export interface SaveResult extends BoardBundle {
  events: HistoryEvent[];
}

export class BoardRepository {
  public constructor(public readonly root: vscode.Uri) {}

  public get name(): string {
    return path.basename(this.root.fsPath) || this.root.fsPath;
  }

  public uri(fileName: typeof BUNDLE_FILES[number]): vscode.Uri {
    return vscode.Uri.joinPath(this.root, fileName);
  }

  public async initialize(): Promise<{ created: string[]; preserved: string[] }> {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC';
    const templates: Record<typeof BUNDLE_FILES[number], string> = {
      [BOARD_FILE]: BOARD_TEMPLATE,
      [CONFIG_FILE]: createConfigTemplate(this.name, timezone),
      [HISTORY_FILE]: HISTORY_TEMPLATE,
    };
    const created: string[] = [];
    const preserved: string[] = [];

    const results = await Promise.all(BUNDLE_FILES.map(async (fileName) => {
      const target = this.uri(fileName);
      if (await fileExists(target)) {
        return { fileName, created: false };
      } else {
        await vscode.workspace.fs.writeFile(target, encoder.encode(templates[fileName]));
        return { fileName, created: true };
      }
    }));
    results.forEach((result) => (result.created ? created : preserved).push(result.fileName));

    this.validate(await this.readFromDisk());
    return { created, preserved };
  }

  public async exists(timeoutMs?: number): Promise<boolean> {
    const results = await Promise.all(BUNDLE_FILES.map((fileName) => fileExists(this.uri(fileName), timeoutMs)));
    return results.every(Boolean);
  }

  public async read(): Promise<BoardBundle> {
    const documents = await Promise.all(BUNDLE_FILES.map((fileName) => vscode.workspace.openTextDocument(this.uri(fileName))));
    return {
      boardSource: documents[0].getText(),
      configSource: documents[1].getText(),
      historySource: documents[2].getText(),
    };
  }

  public async readFromDisk(): Promise<BoardBundle> {
    const contents = await Promise.all(BUNDLE_FILES.map((fileName) => vscode.workspace.fs.readFile(this.uri(fileName))));
    return {
      boardSource: decoder.decode(contents[0]),
      configSource: decoder.decode(contents[1]),
      historySource: decoder.decode(contents[2]),
    };
  }

  public validate(bundle: BoardBundle): BundleValidation {
    return boardModel.validateBundleSources(bundle.boardSource, bundle.configSource, bundle.historySource);
  }

  public async normalizeBoard(expectedSource?: string): Promise<{ changed: boolean; diagnostics: BoardDiagnostic[] }> {
    const current = await this.read();
    if (expectedSource !== undefined && current.boardSource !== expectedSource) {
      throw new Error(`${BOARD_FILE} changed outside LedgerBoard. Reload before normalizing.`);
    }

    const normalized = boardModel.normalizeBoardSource(current.boardSource);
    if (!normalized.changed) {
      return { changed: false, diagnostics: normalized.diagnostics };
    }

    await this.applyChanges(new Map([[BOARD_FILE, normalized.source]]));
    return { changed: true, diagnostics: normalized.diagnostics };
  }

  public async save(request: SaveRequest): Promise<SaveResult> {
    const current = await this.read();
    if (request.saveBoard && current.boardSource !== request.base.boardSource) {
      throw new Error(`${BOARD_FILE} changed outside LedgerBoard. Reload before saving.`);
    }
    if (request.saveConfig && current.configSource !== request.base.configSource) {
      throw new Error(`${CONFIG_FILE} changed outside LedgerBoard. Reload before saving.`);
    }

    const nextBoardSource = request.saveBoard ? request.nextBoardSource : current.boardSource;
    const nextConfigSource = request.saveConfig ? request.nextConfigSource : current.configSource;
    const beforeBoard = boardModel.parseBoard(current.boardSource);
    const afterBoard = boardModel.parseBoard(nextBoardSource);
    boardModel.parseConfig(nextConfigSource);
    const events = request.saveBoard
      ? boardModel.diffBoardEvents(beforeBoard, afterBoard, localIsoTimestamp())
      : [];

    if (events.length > 0 && current.historySource !== request.base.historySource) {
      throw new Error(`${HISTORY_FILE} changed outside LedgerBoard. Reload before saving.`);
    }

    const nextHistorySource = boardModel.appendHistory(current.historySource, events);
    const nextBundle = { boardSource: nextBoardSource, configSource: nextConfigSource, historySource: nextHistorySource };
    this.validate(nextBundle);

    const changes = new Map<string, string>();
    if (request.saveBoard) {changes.set(BOARD_FILE, nextBoardSource);}
    if (request.saveConfig) {changes.set(CONFIG_FILE, nextConfigSource);}
    if (events.length > 0) {changes.set(HISTORY_FILE, nextHistorySource);}
    await this.applyChanges(changes);

    return { ...nextBundle, events };
  }

  public watch(onChange: (fileName: string) => void): vscode.Disposable {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.root, '*.md'));
    const subscriptions = BUNDLE_FILES.flatMap((fileName) => {
      const matches = (uri: vscode.Uri) => path.basename(uri.fsPath) === fileName;
      return [
        watcher.onDidChange((uri) => matches(uri) && onChange(fileName)),
        watcher.onDidCreate((uri) => matches(uri) && onChange(fileName)),
        watcher.onDidDelete((uri) => matches(uri) && onChange(fileName)),
      ];
    });
    return vscode.Disposable.from(watcher, ...subscriptions);
  }

  private async applyChanges(changes: Map<string, string>): Promise<void> {
    if (changes.size === 0) {return;}

    const edit = new vscode.WorkspaceEdit();
    const documents: vscode.TextDocument[] = [];
    for (const [fileName, content] of changes) {
      const document = await vscode.workspace.openTextDocument(this.uri(fileName as typeof BUNDLE_FILES[number]));
      documents.push(document);
      edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), content);
    }

    if (!await vscode.workspace.applyEdit(edit)) {
      throw new Error('VS Code rejected the Markdown workspace edit.');
    }
    const saved = await Promise.all(documents.map((document) => document.save()));
    if (saved.some((result) => !result)) {
      throw new Error('One or more Markdown files could not be saved.');
    }
  }
}

export async function readUtf8(uri: vscode.Uri): Promise<string> {
  return decoder.decode(await vscode.workspace.fs.readFile(uri));
}

async function fileExists(uri: vscode.Uri, timeoutMs?: number): Promise<boolean> {
  const operation = (async () => {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {return false;}
      throw error;
    }
  })();
  return timeoutMs === undefined ? operation : withTimeout(operation, timeoutMs, false);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
