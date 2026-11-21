import { setTimeout as delay } from 'node:timers/promises';
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
    // Playwright can wait for trace instrumentation before its screenshot timeout starts.
    const screenshot = await Promise.race([
      page.screenshot({ timeout, caret: 'initial' }).catch(() => undefined),
      delay(timeout, undefined, { ref: false }),
    ]);
    if (screenshot) {
      await testInfo.attach('screenshot', { body: screenshot, contentType: 'image/png' });
    }
  },
});
