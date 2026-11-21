import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

const jobDeadline = Number(process.env.GAME_CHECK_DEADLINE_MS);
const screenshotBudget = 500;
// Leave time for Playwright's context diagnostics, trace and result reporting.
const finishScreenshotBy = jobDeadline - 8_000;

export const test = base.extend<{ jobDeadline: void }>({
  jobDeadline: [
    async ({ browserName }, use, testInfo) => {
      if (jobDeadline) {
        const remaining = finishScreenshotBy - Date.now() - screenshotBudget;
        if (remaining <= 0)
          throw new Error(`Game checks ran out of time before starting this ${browserName} test.`);
        testInfo.setTimeout(Math.min(testInfo.timeout, remaining));
      }
      await use();
    },
    { auto: true },
  ],
  page: async ({ page }, use, testInfo) => {
    await use(page);
    if (!jobDeadline || testInfo.status === testInfo.expectedStatus || testInfo.status === 'skipped') return;

    const timeout = Math.min(screenshotBudget, finishScreenshotBy - Date.now());
    if (timeout <= 0) return;
    // Screenshot capture can wait on a stalled font. Leave trace teardown time to finish.
    const path = testInfo.outputPath('test-failed-1.png');
    try {
      await page.screenshot({ path, timeout, caret: 'initial' });
    } catch {
      return;
    }
    await testInfo.attach('screenshot', { path, contentType: 'image/png' });
  },
});
