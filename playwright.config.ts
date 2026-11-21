import { defineConfig, devices } from '@playwright/test';

const jobDeadline = Number(process.env.GAME_CHECK_DEADLINE_MS);

export default defineConfig({
  testDir: './tests',
  testMatch: 'browser.spec.ts',
  timeout: 30_000,
  // Bound setup and the entire suite before the shell terminates the verifier.
  globalTimeout: jobDeadline ? Math.max(1, jobDeadline - Date.now() - 2_000) : undefined,
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
    timeout: 30_000,
  },
});
