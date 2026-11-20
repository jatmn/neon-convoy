import { resolve } from 'node:path';
import type { PlaywrightTestConfig } from '@playwright/test';
import { defineConfig, devices } from '@playwright/test';

export function timingReporter(suite: string): PlaywrightTestConfig['reporter'] {
  const directory = process.env.NEON_TEST_TIMINGS_DIRECTORY;
  return directory ? [['line'], ['json', { outputFile: resolve(directory, `${suite}.json`) }]] : undefined;
}

export default defineConfig({
  testDir: './tests',
  reporter: timingReporter('browser'),
  testMatch: 'browser.spec.ts',
  timeout: 30_000,
  forbidOnly: !!process.env.CI,
  workers: process.env.CI ? 2 : undefined,
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
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
