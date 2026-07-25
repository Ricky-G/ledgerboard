import { runTests } from '@vscode/test-electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await runTests({
	extensionDevelopmentPath: repositoryRoot,
	extensionTestsPath: path.join(repositoryRoot, 'out', 'test', 'runTestSuite.js'),
	launchArgs: ['--disable-updates'],
});
