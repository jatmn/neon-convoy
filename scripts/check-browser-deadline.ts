import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JSONReport } from '@playwright/test/reporter';

const dir = mkdtempSync(join(tmpdir(), 'neon-browser-deadline-'));
const title = 'times out waiting for a stalled font';
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
test(${JSON.stringify(title)}, async ({ page }) => {
  await page.route('**/stalled.woff2', () => console.log('Font request intercepted'));
  await page.setContent(
    '<style>@font-face { font-family: stalled; src: url(https://deadline.invalid/stalled.woff2); } body { font-family: stalled; }</style><p>Waiting for the font</p>',
    { waitUntil: 'domcontentloaded' },
  );
  await page.evaluate(() => document.fonts.ready);
});`,
  );

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
      '--reporter',
      'json',
      '--output',
      join(dir, 'results'),
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, GAME_CHECK_DEADLINE_MS: String(Date.now() + 13_000) },
      timeout: 16_000,
    },
  );
  assert.ifError(run.error);
  assert.equal(run.status, 1, run.stderr);
  const report = JSON.parse(run.stdout) as JSONReport;
  const spec = report.suites[0]?.specs[0];
  assert.equal(spec?.title, title);
  const result = spec.tests[0]?.results[0];
  assert.equal(result?.status, 'timedOut', report.errors.map(({ message }) => message).join('\n'));
  assert.match(result.error?.message ?? '', /Test timeout of \d+ms exceeded/);
  assert.ok(
    result.stdout.some((entry) => 'text' in entry && entry.text.includes('Font request intercepted')),
  );
  const trace = result.attachments.find((attachment) => attachment.name === 'trace');
  assert.ok(trace?.path);
  const archive = readFileSync(trace.path);
  // Playwright's ZIP has no comment. An incomplete trace has no end-of-central-directory record.
  assert.ok(archive.length > 22);
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
  console.log('The stalled-font test reported a timeout and attached a finalized trace.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
