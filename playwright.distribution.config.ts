import { defineConfig } from '@playwright/test';
import config, { gameServer, timingReporter } from './playwright.config.ts';

const server = gameServer('preview', 4174);

export default defineConfig({
  ...config,
  reporter: timingReporter('distribution'),
  testMatch: 'distribution.spec.ts',
  use: { ...config.use, baseURL: server.baseURL },
  webServer: server.webServer,
});
