import * as path from 'node:path';
import * as vscode from 'vscode';
import { BoardRepository, type BundleValidation } from './boardRepository';

export interface ValidBoardCandidate {
  repository: BoardRepository;
  validation: BundleValidation;
}

export interface InvalidBoardCandidate {
  repository: BoardRepository;
  message: string;
}

export interface BoardDiscoveryResult {
  valid: ValidBoardCandidate[];
  invalid: InvalidBoardCandidate[];
  scope: 'workspace-roots' | 'workspace-descendants';
}

export async function discoverBoardRepositories(
  workspaceFolders = vscode.workspace.workspaceFolders ?? [],
): Promise<BoardDiscoveryResult> {
  const rootRepositories = await existingRepositories(workspaceFolders.map((folder) => folder.uri));
  if (rootRepositories.length > 0) {
    return validateRepositories(rootRepositories, 'workspace-roots');
  }

  const configFiles = await vscode.workspace.findFiles(
    '**/KANBAN-CONFIG.md',
    '**/{.git,node_modules,.vscode-test}/**',
    100,
  );
  const roots = uniqueUris(configFiles.map((uri) => vscode.Uri.joinPath(uri, '..')));
  const repositories = await existingRepositories(roots);
  return validateRepositories(repositories, 'workspace-descendants');
}

async function existingRepositories(roots: vscode.Uri[]): Promise<BoardRepository[]> {
  const repositories: BoardRepository[] = [];
  for (const root of uniqueUris(roots)) {
    const repository = new BoardRepository(root);
    if (await repository.exists()) {
      repositories.push(repository);
    }
  }
  return repositories;
}

async function validateRepositories(
  repositories: BoardRepository[],
  scope: BoardDiscoveryResult['scope'],
): Promise<BoardDiscoveryResult> {
  const valid: ValidBoardCandidate[] = [];
  const invalid: InvalidBoardCandidate[] = [];

  for (const repository of repositories) {
    try {
      valid.push({ repository, validation: repository.validate(await repository.read()) });
    } catch (error) {
      invalid.push({ repository, message: errorMessage(error) });
    }
  }

  return { valid, invalid, scope };
}

function uniqueUris(uris: vscode.Uri[]): vscode.Uri[] {
  return [...new Map(uris.map((uri) => [path.normalize(uri.fsPath).toLowerCase(), uri])).values()];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
