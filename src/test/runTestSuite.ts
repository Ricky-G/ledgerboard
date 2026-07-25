type TestBody = () => void | Promise<void>;

interface TestCase {
	name: string;
	body: TestBody;
}

const testCases: TestCase[] = [];
let suiteName = 'Extension Test Suite';
let suiteSetup: TestBody | undefined;

async function runTest(name: string, body: TestBody): Promise<void> {
	try {
		await body();
	} catch (error) {
		throw new Error(`${suiteName}: ${name} failed.`, { cause: error });
	}
}

export async function run(): Promise<void> {
	Object.assign(globalThis, {
		suite(name: string, body: (this: { timeout(milliseconds: number): void }) => void) {
			suiteName = name;
			body.call({ timeout: () => undefined });
		},
		suiteSetup(body: TestBody) {
			if (suiteSetup) {
				throw new Error('Only one suite setup hook is supported.');
			}
			suiteSetup = body;
		},
		test(name: string, body: TestBody) {
			testCases.push({ name, body });
		},
	});

	await import('./extension.test.js');

	if (suiteSetup) {
		await runTest('suite setup', suiteSetup);
	}
	for (const testCase of testCases) {
		await runTest(testCase.name, testCase.body);
	}
}
