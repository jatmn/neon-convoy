import { resolve } from 'node:path';
import type { PlaywrightTestConfig } from '@playwright/test';
import { defineConfig, devices } from '@playwright/test';

const jobDeadline = Number(process.env.GAME_CHECK_DEADLINE_MS);
// Let Playwright finish reporting before the shell terminates the verifier.
const suiteDeadline = jobDeadline ? jobDeadline - 2_000 : 0;
const startupDeadline = suiteDeadline ? suiteDeadline - 2_000 : 0;
const serverTimeout = 30_000;
export const webServerTimeout = startupDeadline
  ? Math.max(1, Math.min(serverTimeout, startupDeadline - Date.now()))
  : serverTimeout;

// Playwright's automatic failure snapshot can wait five seconds before it reports the test.
if (suiteDeadline) process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

export function timingReporter(suite: string): PlaywrightTestConfig['reporter'] {
  const directory = process.env.NEON_TEST_TIMINGS_DIRECTORY;
  return directory ? [['line'], ['json', { outputFile: resolve(directory, `${suite}.json`) }]] : undefined;
}

export default defineConfig({
  testDir: './tests',
  reporter: timingReporter('browser'),
  testMatch: 'browser.spec.ts',
  timeout: 30_000,
  globalTimeout: suiteDeadline ? Math.max(1, suiteDeadline - Date.now()) : undefined,
  metadata: { suiteDeadline, startupDeadline },
  forbidOnly: !!process.env.CI,
  workers: process.env.CI ? 2 : undefined,
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    // The shared page fixture caps failure screenshots when the job is timed.
    screenshot: jobDeadline ? 'off' : 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'bun run dev --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: webServerTimeout,
  },
});
