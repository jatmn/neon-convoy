import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

export const test = base.extend<{ jobDeadline: void }>({
  jobDeadline: [
    async ({ browserName }, use, testInfo) => {
      const jobDeadline = Number(process.env.GAME_CHECK_DEADLINE_MS);
      if (jobDeadline) {
        // Leave time to record screenshots and traces before the suite deadline.
        const remaining = jobDeadline - Date.now() - 4_000;
        if (remaining <= 0)
          throw new Error(`Game checks ran out of time before starting this ${browserName} test.`);
        testInfo.setTimeout(Math.min(testInfo.timeout, remaining));
      }
      await use();
    },
    { auto: true },
  ],
});
