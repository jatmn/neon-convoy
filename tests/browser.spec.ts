import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';

async function clickWorld(page: Page, x: number, y: number) {
  const canvas = page.locator('#game');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Battlefield has no bounding box');
  await canvas.click({ position: { x: x / 1200 * box.width, y: y / 600 * box.height } });
}

test('campaign loads ten playable sectors with a rendered battlefield', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'First Light' })).toBeVisible();
  const firstTimer = await page.locator('#timer').textContent();
  expect(firstTimer).toMatch(/^\d{2}:\d{2}$/);
  await expect(page.locator('#levels button')).toHaveCount(10);
  await expect(page.locator('#start-banner')).toBeVisible();
  const battlefield = await page.locator('#game').evaluate((canvas: HTMLCanvasElement) => {
    const { width, height } = canvas;
    const data = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 400) if (data[i] || data[i + 1] || data[i + 2]) lit++;
    return { width, height, lit };
  });
  expect(battlefield.width).toBeGreaterThan(0);
  expect(battlefield.height).toBeGreaterThan(0);
  expect(battlefield.lit).toBeGreaterThan(100);

  await page.locator('#levels button').last().click();
  await expect(page.getByRole('heading', { name: 'Neon Convoy' })).toBeVisible();
  await expect(page.locator('#timer')).not.toHaveText(firstTimer!);
  await expect(page.locator('#rescue-total')).toContainText('/');
  expect(errors).toEqual([]);
});

test('deploy, pause, speed, restart, and music controls update game state', async ({ page }) => {
  await page.goto('/');
  const initialTimer = await page.locator('#timer').textContent();
  await page.getByRole('button', { name: 'Deploy convoy' }).click();
  await expect(page.locator('#feed-status')).toHaveText('CONVOY IN TRANSIT');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.locator('#pause-label')).toBeVisible();
  const pausedAt = await page.evaluate(() => window.__NEON_CONVOY__.game.elapsed);
  await page.waitForTimeout(250);
  const stillPausedAt = await page.evaluate(() => window.__NEON_CONVOY__.game.elapsed);
  expect(stillPausedAt - pausedAt).toBeLessThan(0.02);

  await page.getByRole('button', { name: 'Toggle double speed' }).click();
  await expect(page.locator('#speed span')).toHaveText('2×');
  await page.getByRole('button', { name: 'Mute music' }).click();
  await expect(page.getByRole('button', { name: 'Unmute music' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('neon-convoy-muted'))).toBe('true');

  await page.getByRole('button', { name: 'Restart level' }).click();
  await expect(page.locator('#start-banner')).toBeVisible();
  await expect(page.locator('#timer')).toHaveText(initialTimer!);
  await expect(page.locator('#speed span')).toHaveText('1×');
});

test('assigning a tool consumes its charge and terrain lab changes the route', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Deploy convoy' }).click();
  await page.getByRole('button', { name: 'Pause' }).click();
  const drone = await page.evaluate(() => window.__NEON_CONVOY__.game.drones[0]);
  await clickWorld(page, drone.x, drone.y - 9);
  await expect(page.locator('#count-laser')).toHaveText('0');
  await expect(page.locator('#toast')).toContainText('Laser assigned');

  await page.locator('#levels button').nth(1).click();
  await expect(page.getByRole('heading', { name: 'Skybridge' })).toBeVisible();
  const before = await page.evaluate(() => window.__NEON_CONVOY__.game.terrain.solid(535, 500));
  expect(before).toBe(false);
  await page.getByRole('button', { name: /Terrain lab/ }).click();
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await clickWorld(page, 535, 500);
  const after = await page.evaluate(() => window.__NEON_CONVOY__.game.terrain.solid(535, 500));
  expect(after).toBe(true);
  await expect(page.locator('#best')).toContainText('UNRANKED');
  await page.getByRole('button', { name: 'Erase', exact: true }).click();
  await clickWorld(page, 535, 500);
  expect(await page.evaluate(() => window.__NEON_CONVOY__.game.terrain.solid(535, 500))).toBe(false);
});

test('hint and settings dialogs pause and restore the music and simulation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Deploy convoy' }).click();
  await expect.poll(() => page.evaluate(() => window.__NEON_CONVOY__.audio.context?.state)).toBe('running');
  await page.getByRole('button', { name: 'Need a hint?' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A little guidance.' })).toBeVisible();
  expect(await page.evaluate(() => window.__NEON_CONVOY__.game.paused)).toBe(true);
  expect(await page.evaluate(() => window.__NEON_CONVOY__.audio.paused)).toBe(true);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect.poll(() => page.evaluate(() => window.__NEON_CONVOY__.game.paused)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__NEON_CONVOY__.audio.paused)).toBe(false);

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('slider', { name: 'Music volume' }).fill('0.25');
  expect(await page.evaluate(() => window.__NEON_CONVOY__.audio.volume)).toBe(0.25);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect.poll(() => page.evaluate(() => window.__NEON_CONVOY__.game.paused)).toBe(false);
});

test('a successful rescue saves progress and opens the next sector', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Deploy convoy' }).click();
  await page.getByRole('button', { name: 'Pause' }).click();

  // Advance the real simulation to the level's suggested laser position.
  // Pausing the browser animation makes the tool click deterministic.
  const drone = await page.evaluate(() => {
    const game = window.__NEON_CONVOY__.game;
    game.paused = false;
    for (let i = 0; i < 600 && game.drones[0].x < 345; i++) game.update(1 / 60);
    game.paused = true;
    return { x: game.drones[0].x, y: game.drones[0].y };
  });
  expect(drone.x).toBeGreaterThanOrEqual(345);
  await clickWorld(page, drone.x, drone.y - 9);
  await expect(page.locator('#toast')).toContainText('Laser assigned');

  const outcome = await page.evaluate(() => {
    const game = window.__NEON_CONVOY__.game;
    game.paused = false;
    for (let i = 0; i < 5000 && game.status === 'running'; i++) game.update(1 / 60);
    return { status: game.status, saved: game.saved, required: game.level.required, score: game.score };
  });
  expect(outcome.status).toBe('won');
  expect(outcome.saved).toBeGreaterThanOrEqual(outcome.required);
  expect(outcome.score).toBeGreaterThan(0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Convoy extracted.' })).toBeVisible();
  await expect(page.locator('#campaign-complete')).toContainText('1 / 10');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('neon-convoy-progress') || '{}')['1'].completed)).toBe(true);
  await page.getByRole('button', { name: /Next sector/ }).click();
  await expect(page.getByRole('heading', { name: 'Skybridge' })).toBeVisible();
  await expect(page.locator('#start-banner')).toBeVisible();
});
