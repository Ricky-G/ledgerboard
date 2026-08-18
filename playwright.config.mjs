import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.LEDGERBOARD_HARNESS_PORT ?? 4173);
const baseURL = `http://127.0.0.1:${port}`;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'test/webview/specs',
  testMatch: '**/*.spec.mjs',
  outputDir: 'test-results/webview',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: isCI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }], ['list']]
    : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium-dark',
      testIgnore: '**/responsive.spec.mjs',
      use: { ...devices['Desktop Chrome'], colorScheme: 'dark' },
    },
    {
      name: 'chromium-light',
      testMatch: ['**/rendering.spec.mjs', '**/label-colors.spec.mjs'],
      use: { ...devices['Desktop Chrome'], colorScheme: 'light' },
    },
    {
      name: 'chromium-narrow',
      testMatch: '**/responsive.spec.mjs',
      use: { ...devices['Desktop Chrome'], viewport: { width: 620, height: 900 } },
    },
  ],
  webServer: {
    command: 'node test/webview/harness/serve.mjs',
    url: baseURL,
    reuseExistingServer: !isCI,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 30_000,
  },
});
