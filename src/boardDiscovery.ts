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
  canNormalize: boolean;
  line: number | null;
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
    1_000,
  );
  const roots = uniqueUris(configFiles.map((uri) => vscode.Uri.joinPath(uri, '..')));
  const repositories = await existingRepositories(roots);
  return validateRepositories(repositories, 'workspace-descendants');
}

async function existingRepositories(roots: vscode.Uri[]): Promise<BoardRepository[]> {
  const repositories = await Promise.all(uniqueUris(roots).map(async (root) => {
    const repository = new BoardRepository(root);
    return await repository.exists(2_000) ? repository : null;
  }));
  return repositories.filter((repository): repository is BoardRepository => repository !== null);
}

async function validateRepositories(
  repositories: BoardRepository[],
  scope: BoardDiscoveryResult['scope'],
): Promise<BoardDiscoveryResult> {
  const results = await Promise.all(repositories.map(async (repository) => {
    try {
      return {
        valid: { repository, validation: repository.validate(await repository.readFromDisk()) },
        invalid: null,
      };
    } catch (error) {
      return {
        valid: null,
        invalid: {
          repository,
          message: errorMessage(error),
          canNormalize: Boolean(error && typeof error === 'object' && 'canNormalize' in error && error.canNormalize),
          line: error && typeof error === 'object' && 'line' in error && typeof error.line === 'number' ? error.line : null,
        },
      };
    }
  }));

  return {
    valid: results.map((result) => result.valid).filter((item): item is ValidBoardCandidate => item !== null),
    invalid: results.map((result) => result.invalid).filter((item): item is InvalidBoardCandidate => item !== null),
    scope,
  };
}

function uniqueUris(uris: vscode.Uri[]): vscode.Uri[] {
  return [...new Map(uris.map((uri) => [path.normalize(uri.fsPath).toLowerCase(), uri])).values()];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
