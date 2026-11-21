import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

const screenshotBudget = 500;

export const test = base.extend<{ screenshotDeadline: number }>({
  screenshotDeadline: [
    async ({ browserName }, use, testInfo) => {
      const suiteDeadline = Number(testInfo.config.metadata.suiteDeadline);
      // Context diagnostics and trace teardown run after the bounded screenshot.
      const deadline = suiteDeadline ? suiteDeadline - 2_000 : 0;
      if (deadline) {
        const remaining = deadline - Date.now() - screenshotBudget;
        if (remaining <= 0)
          throw new Error(`Game checks ran out of time before starting this ${browserName} test.`);
        testInfo.setTimeout(Math.min(testInfo.timeout, remaining));
      }
      await use(deadline);
    },
    { auto: true },
  ],
  page: async ({ page, screenshotDeadline }, use, testInfo) => {
    await use(page);
    if (!screenshotDeadline || testInfo.status === testInfo.expectedStatus || testInfo.status === 'skipped')
      return;

    const timeout = Math.min(screenshotBudget, screenshotDeadline - Date.now());
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
