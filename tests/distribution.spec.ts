import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

for (const entry of ['dist/index.html', 'play.html']) {
  test(`${entry} deploys the convoy without external game assets`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    // Fonts are optional; the distributable must play offline.
    await page.route(/^https?:\/\//, route => route.abort());
    if (entry.startsWith('dist/')) {
      // The production site uses module assets, so serve it through Vite preview.
      await page.unroute(/^https?:\/\//);
      await page.route(/^https?:\/\//, route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      await page.goto('http://127.0.0.1:4174/');
    } else {
      await page.goto(pathToFileURL(resolve(entry)).href);
    }
    const license = (await readFile('LICENSE', 'utf8')).replace(/\r\n?/g, '\n');
    expect(await page.content()).toContain(`<!--\n${license}-->`);
    await expect(page.getByRole('heading', { name: 'First Light' })).toBeVisible();
    expect(await page.evaluate(() => '__NEON_CONVOY__' in window)).toBe(false);
    const timer = await page.locator('#timer').textContent();
    await page.getByRole('button', { name: 'Deploy convoy' }).click();
    await expect(page.locator('#feed-status')).toHaveText('CONVOY IN TRANSIT');
    await expect(page.locator('#timer')).not.toHaveText(timer!);
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.locator('#pause-label')).toBeVisible();
    const lit = await page.locator('#game').evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels.some((value, index) => index % 4 !== 3 && value > 0);
    });
    expect(lit).toBe(true);
    expect(errors).toEqual([]);
  });
}
