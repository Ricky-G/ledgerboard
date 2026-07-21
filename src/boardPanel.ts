import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { BoardRepository, readUtf8, type BoardBundle, type SaveRequest } from './boardRepository';

export class BoardPanel implements vscode.Disposable {
  private static current: BoardPanel | undefined;

  private repository: BoardRepository;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private watcher: vscode.Disposable | undefined;
  private ready = false;
  private openNewCardWhenReady = false;
  private ignoreWatcherUntil = 0;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    repository: BoardRepository,
  ) {
    this.repository = repository;
    this.panel = vscode.window.createWebviewPanel(
      'ledgerBoard.board',
      `LedgerBoard · ${repository.name}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
    this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message), undefined, this.disposables);
    void this.initializeHtml();
    this.startWatching();
  }

  public static show(context: vscode.ExtensionContext, repository: BoardRepository): BoardPanel {
    if (BoardPanel.current) {
      BoardPanel.current.panel.reveal(vscode.ViewColumn.One);
      void BoardPanel.current.setRepository(repository);
      return BoardPanel.current;
    }

    BoardPanel.current = new BoardPanel(context, repository);
    return BoardPanel.current;
  }

  public openNewCard(): void {
    if (this.ready) {
      void this.panel.webview.postMessage({ type: 'openNewCard' });
    } else {
      this.openNewCardWhenReady = true;
    }
  }

  public async setRepository(repository: BoardRepository): Promise<void> {
    const bundle = await repository.read();
    repository.validate(bundle);

    if (this.repository.root.toString() === repository.root.toString()) {
      if (this.ready) {await this.postBundle(repository, bundle);}
      return;
    }

    this.repository = repository;
    this.panel.title = `LedgerBoard · ${repository.name}`;
    this.startWatching();
    if (this.ready) {await this.postBundle(repository, bundle);}
  }

  public dispose(): void {
    if (BoardPanel.current === this) {BoardPanel.current = undefined;}
    this.watcher?.dispose();
    while (this.disposables.length > 0) {this.disposables.pop()?.dispose();}
  }

  private async initializeHtml(): Promise<void> {
    try {
      this.panel.webview.html = await this.getHtml();
    } catch (error) {
      void vscode.window.showErrorMessage(`LedgerBoard could not open: ${errorMessage(error)}`);
      this.panel.dispose();
    }
  }

  private async handleMessage(message: { type?: string; request?: SaveRequest }): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          this.ready = true;
          await this.load();
          if (this.openNewCardWhenReady) {
            this.openNewCardWhenReady = false;
            await this.panel.webview.postMessage({ type: 'openNewCard' });
          }
          break;
        case 'reload':
          await this.load();
          break;
        case 'save':
          if (!message.request) {throw new Error('The webview sent an empty save request.');}
          this.ignoreWatcherUntil = Date.now() + 1500;
          await this.panel.webview.postMessage({
            type: 'saveResult',
            result: await this.repository.save(message.request),
          });
          break;
        case 'selectBoard':
          await vscode.commands.executeCommand('ledgerBoard.openBoard');
          break;
      }
    } catch (error) {
      const messageText = errorMessage(error);
      const messageType = message.type === 'save' ? 'saveError' : 'loadError';
      await this.panel.webview.postMessage({ type: messageType, message: messageText });
      if (messageType === 'loadError') {
        void vscode.window.showErrorMessage(`LedgerBoard could not load ${this.repository.name}: ${messageText}`);
      }
    }
  }

  private async load(): Promise<void> {
    const bundle = await this.repository.read();
    this.repository.validate(bundle);
    await this.postBundle(this.repository, bundle);
  }

  private async postBundle(repository: BoardRepository, bundle: BoardBundle): Promise<void> {
    await this.panel.webview.postMessage({
      type: 'load',
      bundle: { rootName: repository.name, ...bundle },
    });
  }

  private startWatching(): void {
    this.watcher?.dispose();
    this.watcher = this.repository.watch((fileName) => {
      if (Date.now() < this.ignoreWatcherUntil) {return;}
      void this.panel.webview.postMessage({ type: 'externalChange', fileName });
    });
  }

  private async getHtml(): Promise<string> {
    const webview = this.panel.webview;
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const nonce = randomBytes(16).toString('base64');
    const replacements: Record<string, string> = {
      '{{cspSource}}': webview.cspSource,
      '{{nonce}}': nonce,
      '{{stylesUri}}': webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'styles.css')).toString(),
      '{{modelUri}}': webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'board-model.js')).toString(),
      '{{appUri}}': webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'app.js')).toString(),
    };
    let html = await readUtf8(vscode.Uri.joinPath(mediaRoot, 'index.html'));
    for (const [token, value] of Object.entries(replacements)) {html = html.replaceAll(token, value);}
    return html;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
