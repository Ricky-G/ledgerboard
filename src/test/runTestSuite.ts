type TestBody = () => void | Promise<void>;

interface TestCase {
	name: string;
	body: TestBody;
	timeoutMs: number;
}

interface TestResult {
	name: string;
	durationMs: number;
	error?: unknown;
}

const DEFAULT_TIMEOUT_MS = 30_000;

const testCases: TestCase[] = [];
const suiteSetupHooks: TestBody[] = [];
const suiteTeardownHooks: TestBody[] = [];
let suiteName = 'Extension Test Suite';
let suiteTimeoutMs = DEFAULT_TIMEOUT_MS;

function withTimeout(label: string, body: TestBody, timeoutMs: number): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`${label} exceeded the ${timeoutMs}ms timeout.`));
		}, timeoutMs);
		timer.unref?.();
		Promise.resolve()
			.then(body)
			.then(resolve, reject)
			.finally(() => clearTimeout(timer));
	});
}

function describeError(error: unknown): string {
	if (error instanceof Error) {
		const cause = error.cause instanceof Error ? `\n      caused by: ${error.cause.message}` : '';
		const stack = error.stack ? `\n${error.stack.split('\n').slice(1, 6).join('\n')}` : '';
		return `${error.message}${cause}${stack}`;
	}
	return String(error);
}

export async function run(): Promise<void> {
	Object.assign(globalThis, {
		suite(name: string, body: (this: { timeout(milliseconds: number): void }) => void) {
			suiteName = name;
			body.call({
				timeout: (milliseconds: number) => {
					suiteTimeoutMs = milliseconds;
				},
			});
		},
		suiteSetup(body: TestBody) {
			suiteSetupHooks.push(body);
		},
		suiteTeardown(body: TestBody) {
			suiteTeardownHooks.push(body);
		},
		test(name: string, body: TestBody) {
			testCases.push({ name, body, timeoutMs: suiteTimeoutMs });
		},
	});

	await import('./extension.test.js');

	console.log(`\n${suiteName}`);
	const results: TestResult[] = [];
	const startedAt = Date.now();

	try {
		for (const [index, hook] of suiteSetupHooks.entries()) {
			await withTimeout(`suite setup #${index + 1}`, hook, suiteTimeoutMs);
		}
	} catch (error) {
		console.error(`  x suite setup\n      ${describeError(error)}`);
		throw new Error(`${suiteName}: suite setup failed, so no tests ran.`, { cause: error });
	}

	// Every test runs even when an earlier one fails so a single run reports the
	// complete picture instead of only the first regression.
	for (const testCase of testCases) {
		const testStartedAt = Date.now();
		try {
			await withTimeout(testCase.name, testCase.body, testCase.timeoutMs);
			const durationMs = Date.now() - testStartedAt;
			results.push({ name: testCase.name, durationMs });
			console.log(`  ok ${testCase.name} (${durationMs}ms)`);
		} catch (error) {
			const durationMs = Date.now() - testStartedAt;
			results.push({ name: testCase.name, durationMs, error });
			console.error(`  x ${testCase.name} (${durationMs}ms)\n      ${describeError(error)}`);
		}
	}

	for (const [index, hook] of suiteTeardownHooks.entries()) {
		try {
			await withTimeout(`suite teardown #${index + 1}`, hook, suiteTimeoutMs);
		} catch (error) {
			console.error(`  x suite teardown\n      ${describeError(error)}`);
			results.push({ name: `suite teardown #${index + 1}`, durationMs: 0, error });
		}
	}

	const failures = results.filter((result) => result.error !== undefined);
	console.log(
		`\n  ${results.length - failures.length} passing, ${failures.length} failing `
		+ `(${Date.now() - startedAt}ms)\n`,
	);

	if (failures.length > 0) {
		const names = failures.map((failure) => `  - ${failure.name}`).join('\n');
		throw new Error(
			`${suiteName}: ${failures.length} of ${results.length} tests failed.\n${names}`,
			{ cause: failures[0].error },
		);
	}
}
