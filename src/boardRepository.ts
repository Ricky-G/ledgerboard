import * as path from 'node:path';
import * as vscode from 'vscode';
import { boardModel, type BoardDocument, type HistoryEvent, type KanbanConfig } from './model';
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

    for (const fileName of BUNDLE_FILES) {
      const target = this.uri(fileName);
      if (await fileExists(target)) {
        preserved.push(fileName);
      } else {
        await vscode.workspace.fs.writeFile(target, encoder.encode(templates[fileName]));
        created.push(fileName);
      }
    }

    this.validate(await this.read());
    return { created, preserved };
  }

  public async exists(): Promise<boolean> {
    const results = await Promise.all(BUNDLE_FILES.map((fileName) => fileExists(this.uri(fileName))));
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

  public validate(bundle: BoardBundle): BundleValidation {
    const board = boardModel.parseBoard(bundle.boardSource);
    const config = boardModel.parseConfig(bundle.configSource);
    const history = boardModel.parseHistory(bundle.historySource);
    const entityIds = new Set(config.entities.map((entity) => entity.id));
    const cards = board.columns.flatMap((column) => column.cards);
    const missing = [...new Set(cards.map((card) => card.area).filter((area) => !entityIds.has(area)))];

    if (missing.length > 0) {
      throw new Error(`Missing entity configuration: ${missing.join(', ')}.`);
    }
    if (boardModel.serializeBoard(board) !== bundle.boardSource) {
      throw new Error('BOARD.md does not round-trip exactly. Keep descriptions on one physical line and line endings consistent.');
    }

    return {
      board,
      config,
      historyEvents: history.events,
      cardCount: cards.length,
    };
  }

  public async save(request: SaveRequest): Promise<SaveResult> {
    const current = await this.read();
    if (request.saveBoard && current.boardSource !== request.base.boardSource) {
      throw new Error(`${BOARD_FILE} changed outside Kanban Ledger. Reload before saving.`);
    }
    if (request.saveConfig && current.configSource !== request.base.configSource) {
      throw new Error(`${CONFIG_FILE} changed outside Kanban Ledger. Reload before saving.`);
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
      throw new Error(`${HISTORY_FILE} changed outside Kanban Ledger. Reload before saving.`);
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

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {return false;}
    throw error;
  }
}
