import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JSONReport } from '@playwright/test/reporter';

const dir = mkdtempSync(join(tmpdir(), 'neon-browser-deadline-'));
const stalledFont = 'times out waiting for a stalled font';
const busyRenderer = 'times out while the renderer is busy';
const config = join(dir, 'playwright.config.ts');
try {
  writeFileSync(
    config,
    `import config from ${JSON.stringify(fileURLToPath(new URL('../playwright.config.ts', import.meta.url)))};
export default { ...config, testDir: '.', testMatch: 'stalled-font.spec.ts', webServer: undefined };`,
  );
  writeFileSync(
    join(dir, 'stalled-font.spec.ts'),
    `import { test } from ${JSON.stringify(fileURLToPath(new URL('../tests/browser-fixtures.ts', import.meta.url)))};
test.describe.configure({ mode: 'parallel' });
test(${JSON.stringify(stalledFont)}, async ({ page }) => {
  await page.route('**/stalled.woff2', () => console.log('Font request intercepted'));
  await page.setContent(
    '<style>@font-face { font-family: stalled; src: url(https://deadline.invalid/stalled.woff2); } body { font-family: stalled; }</style><p>Waiting for the font</p>',
    { waitUntil: 'domcontentloaded' },
  );
  await page.evaluate(() => document.fonts.ready);
});
test(${JSON.stringify(busyRenderer)}, async ({ page }) => {
  await page.setContent('<p>Testing renderer cleanup</p>');
  page.on('console', (message) => console.log(message.text()));
  await page.evaluate(() => {
    console.log('Renderer task started');
    const finish = performance.now() + 15_000;
    while (performance.now() < finish) {
      // Keep the renderer occupied through the reporting deadline.
    }
  });
});`,
  );

  const deadline = Date.now() + 13_000;
  const run = spawnSync(
    process.execPath,
    [
      '--bun',
      'playwright',
      'test',
      '--config',
      config,
      '--project',
      'desktop',
      '--workers',
      '2',
      '--reporter',
      'json',
      '--output',
      join(dir, 'results'),
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, GAME_CHECK_DEADLINE_MS: String(deadline) },
      timeout: Math.max(1, deadline - Date.now()),
    },
  );
  assert.ifError(run.error);
  assert.ok(Date.now() < deadline, 'Playwright must finish reporting before the verifier deadline');
  assert.equal(run.status, 1, run.stderr);
  const report = JSON.parse(run.stdout) as JSONReport;
  assert.deepEqual(report.errors, []);
  for (const [title, marker] of [
    [stalledFont, 'Font request intercepted'],
    [busyRenderer, 'Renderer task started'],
  ] as const) {
    const spec = report.suites[0]?.specs.find((entry) => entry.title === title);
    const result = spec?.tests[0]?.results[0];
    assert.equal(result?.status, 'timedOut', title);
    assert.match(result.error?.message ?? '', /Test timeout of \d+ms exceeded/);
    assert.ok(
      result.stdout.some((entry) => 'text' in entry && entry.text.includes(marker)),
      title,
    );
    const trace = result.attachments.find((attachment) => attachment.name === 'trace');
    assert.ok(trace?.path, title);
    const archive = readFileSync(trace.path);
    // Playwright's ZIP has no comment. An incomplete trace has no end-of-central-directory record.
    assert.ok(archive.length > 22);
    assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
    console.log(`"${title}" reported a timeout and attached a finalized trace.`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
