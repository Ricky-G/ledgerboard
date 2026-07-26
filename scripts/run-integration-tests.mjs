import { runTests } from '@vscode/test-electron';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The extension host is launched against a throwaway profile so a developer's
// installed extensions, settings, and telemetry consent can never influence the
// result. CI and local runs therefore exercise exactly the same environment.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerboard-vscode-'));
const userDataDir = path.join(sandbox, 'user-data');
const extensionsDir = path.join(sandbox, 'extensions');
const workspaceDir = path.join(sandbox, 'workspace');
for (const directory of [userDataDir, extensionsDir, workspaceDir]) {
  fs.mkdirSync(directory, { recursive: true });
}

// Tests create and delete fixture folders faster than the editor can snapshot
// them, and local history then logs a copy failure that looks like a test error.
// Disabling the editor features the suite does not exercise keeps the output
// readable, so a real failure is the only thing that stands out.
fs.mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
fs.writeFileSync(
  path.join(userDataDir, 'User', 'settings.json'),
  `${JSON.stringify({
    'workbench.localHistory.enabled': false,
    'files.hotExit': 'off',
    'update.mode': 'none',
    'extensions.autoCheckUpdates': false,
    'telemetry.telemetryLevel': 'off',
    'window.restoreWindows': 'none',
  }, null, 2)}\n`,
  'utf8',
);

const version = process.env.LEDGERBOARD_VSCODE_VERSION ?? 'stable';
const attempts = Number.parseInt(process.env.LEDGERBOARD_VSCODE_DOWNLOAD_ATTEMPTS ?? '3', 10);

function isTransientDownloadFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|getaddrinfo|502|503|504/i.test(message);
}

// Windows keeps handles open briefly after the editor exits, so deleting the
// sandbox can fail with EPERM or EBUSY. A temporary directory left behind is
// housekeeping, not a test result, so it must never turn a passing run red.
function removeSandbox() {
  try {
    fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`Could not remove the sandbox profile at ${sandbox}: ${reason}`);
  }
}

async function main() {
  console.log(`Running the VS Code integration suite against "${version}".`);
  console.log(`Sandbox profile: ${sandbox}`);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await runTests({
        version,
        extensionDevelopmentPath: repositoryRoot,
        extensionTestsPath: path.join(repositoryRoot, 'out', 'test', 'runTestSuite.js'),
        launchArgs: [
          workspaceDir,
          '--disable-updates',
          '--disable-workspace-trust',
          '--skip-welcome',
          '--skip-release-notes',
          '--disable-telemetry',
          '--disable-gpu',
          `--user-data-dir=${userDataDir}`,
          `--extensions-dir=${extensionsDir}`,
        ],
      });
      return;
    } catch (error) {
      // Only the download and launch phase is retried. A genuine assertion
      // failure surfaces immediately so a real regression is never masked.
      if (attempt < attempts && isTransientDownloadFailure(error)) {
        console.warn(`Attempt ${attempt} could not reach the VS Code download service. Retrying.`);
        continue;
      }
      throw error;
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
} finally {
  removeSandbox();
}
