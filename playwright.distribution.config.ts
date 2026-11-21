import { defineConfig } from '@playwright/test';
import config, { timingReporter, webServerTimeout } from './playwright.config.ts';

export default defineConfig({
  ...config,
  reporter: timingReporter('distribution'),
  testMatch: 'distribution.spec.ts',
  webServer: {
    command: 'bun run preview --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: !process.env.CI,
    timeout: webServerTimeout,
  },
});
