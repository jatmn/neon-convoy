import { resolve } from 'node:path';
import type { PlaywrightTestConfig } from '@playwright/test';
import { defineConfig, devices } from '@playwright/test';

const jobDeadline = Number(process.env.GAME_CHECK_DEADLINE_MS);
// Let Playwright finish reporting before the shell terminates the verifier.
const suiteDeadline = jobDeadline ? jobDeadline - 2_000 : 0;
const startupDeadline = suiteDeadline ? suiteDeadline - 2_000 : 0;
const serverTimeout = 30_000;
const webServerTimeout = startupDeadline
  ? Math.max(1, Math.min(serverTimeout, startupDeadline - Date.now()))
  : serverTimeout;

// Playwright's automatic failure snapshot can wait five seconds before it reports the test.
if (suiteDeadline) process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

export function timingReporter(suite: string): PlaywrightTestConfig['reporter'] {
  const directory = process.env.NEON_TEST_TIMINGS_DIRECTORY;
  return directory ? [['line'], ['json', { outputFile: resolve(directory, `${suite}.json`) }]] : undefined;
}

const isolatedServers = process.env.NEON_ISOLATE_TEST_SERVERS === '1';

export function gameServer(script: 'dev' | 'preview', port: number) {
  const baseURL = isolatedServers ? undefined : `http://127.0.0.1:${port}`;
  return {
    baseURL,
    webServer: {
      command: `bun run ${script} --host 127.0.0.1 --port ${isolatedServers ? 0 : port} --strictPort`,
      url: baseURL,
      // Vite reports the kernel-assigned listener before Playwright starts the test workers.
      wait: isolatedServers
        ? { stdout: /(?<PLAYWRIGHT_TEST_BASE_URL>http:\/\/127\.0\.0\.1:\d+)\// }
        : undefined,
      reuseExistingServer: !isolatedServers && !process.env.CI,
      timeout: webServerTimeout,
    },
  };
}

const server = gameServer('dev', 4173);

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
    baseURL: server.baseURL,
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
  webServer: server.webServer,
});
