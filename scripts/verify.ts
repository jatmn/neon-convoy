import { execFile, spawn } from 'node:child_process';
import type { StdioOptions } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { validationChecks } from './ci.ts';
import { recordTestInventory } from './test-inventory.ts';

type CheckResult = 'passed' | 'failed' | 'blocked';

const [mode = 'full', base, head, ...options] = process.argv.slice(2);
const checks = validationChecks(mode, base, head);
const results = new Map<string, Promise<CheckResult>>();
const exec = promisify(execFile);
const jobStartedAt = process.env.GAME_CHECK_STARTED_MS;
const setupStartedAt = Number(jobStartedAt);
const setupBudget = 15_000;

const budgets = new Map([
  ['Native lint', 1_000],
  ['Format', 1_000],
  ['TypeScript', 5_000],
  ['Unit tests', 30_000],
  ['Browser controls', 30_000],
  ['Distribution', 30_000],
]);

function check(name: string, start: () => void | Promise<void>, ...prerequisites: Promise<CheckResult>[]) {
  const result = Promise.all(prerequisites).then(async (ready): Promise<CheckResult> => {
    if (ready.some((status) => status !== 'passed')) return 'blocked';

    console.log(`${name}: started`);
    const started = performance.now();
    const budget = (jobStartedAt ? budgets.get(name) : undefined) ?? Infinity;
    let overBudget = false;
    const reportOverrun = () => {
      if (overBudget) return;
      overBudget = true;
      const elapsed = performance.now() - started;
      console.error(`${name}: failed (budget ${budget} ms) in ${elapsed.toFixed(0)} ms`);
    };
    // Keep collecting command output after a budget failure. The workflow owns termination.
    const timer = budget === Infinity ? undefined : setTimeout(reportOverrun, budget);
    try {
      await start();
      const elapsed = performance.now() - started;
      if (elapsed >= budget) reportOverrun();
      if (overBudget) return 'failed';
      console.log(`${name}: passed in ${elapsed.toFixed(0)} ms`);
      return 'passed';
    } catch (error) {
      const elapsed = performance.now() - started;
      if (elapsed >= budget) reportOverrun();
      console.error(
        `${name}: failed (${error instanceof Error ? error.message : String(error)}) in ${elapsed.toFixed(0)} ms`,
      );
      return 'failed';
    } finally {
      clearTimeout(timer);
    }
  });
  results.set(name, result);
  return result;
}

function spawnCommand(command: string, args: string[], env?: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const stdio: StdioOptions = ['ignore', 'inherit', 'inherit'];
    const child = spawn(command, args, { stdio, env });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(signal ?? `exit code ${code}`));
    });
  });
}

function run(name: string, command: string, args: string[], ...prerequisites: Promise<CheckResult>[]) {
  return check(name, () => spawnCommand(command, args), ...prerequisites);
}

const full = Object.values(checks).every(Boolean);
const timingDirectory = 'test-results/timings';
const unitArgs = ['test', '--isolate', '--randomize'];
if (full) {
  rmSync(timingDirectory, { recursive: true, force: true });
  mkdirSync(timingDirectory, { recursive: true });
  process.env.NEON_TEST_TIMINGS_DIRECTORY = timingDirectory;
  unitArgs.push(
    `--timings=${join(timingDirectory, 'unit.json')}`,
    '--update-timings',
    '--reporter=junit',
    `--reporter-outfile=${join(timingDirectory, 'unit-junit.xml')}`,
  );
} else {
  unitArgs.push('tests/ci.test.ts', 'scripts/pullfrog-command-check.test.ts');
  if (checks.simulation) unitArgs.push('tests/engine.test.ts');
  if (checks.deployment) unitArgs.push('tests/deploy.test.ts');
}
// Bun's CI mode rejects focused tests, including during full local verification.
void check('Unit tests', () => spawnCommand('bun', unitArgs, full ? { ...process.env, CI: '1' } : undefined));
void run('Format', 'bun', ['fmt', '--check']);
const needsChromium = checks.browser || checks.distribution;
const dependencies =
  options.includes('--install-dependencies') && (checks.types || needsChromium)
    ? run('Dependency install', 'bun', ['install', '--frozen-lockfile'])
    : Promise.resolve<CheckResult>('passed');

if (checks.types) {
  void run('Test lint', 'bun', ['run', 'lint'], dependencies);
  void run(
    'Native lint',
    'bun',
    [
      'lint',
      '--no-script',
      '--config',
      '.oxlintrc.native.json',
      '--type-aware',
      '--all',
      '--max-warnings',
      '0',
    ],
    dependencies,
  );
  void run('TypeScript', 'bun', ['check'], dependencies);
}

function remainingSetupTime() {
  const elapsed = Date.now() - setupStartedAt;
  return elapsed >= 0 && elapsed < setupBudget ? setupBudget - elapsed : 0;
}

const chromium =
  options.includes('--install-chromium') && needsChromium
    ? run(
        'Chromium setup',
        'bun',
        ['--bun', 'playwright', 'install', '--only-shell', 'chromium'],
        jobStartedAt
          ? dependencies.then((status) => (status === 'passed' && !remainingSetupTime() ? 'blocked' : status))
          : dependencies,
      )
    : dependencies;

let browserSetup = chromium;
if (jobStartedAt) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'expired'>((resolve) => {
    timer = setTimeout(() => resolve('expired'), remainingSetupTime());
  });
  // The browser gate can fail at the deadline while installation still owns its output and result.
  browserSetup = Promise.race([chromium, deadline]).then((status) => {
    clearTimeout(timer);
    const elapsed = Date.now() - setupStartedAt;
    const withinBudget = status !== 'expired' && elapsed >= 0 && elapsed < setupBudget;
    if (withinBudget && status !== 'passed') return 'blocked';
    console.log(
      `Setup budget: ${withinBudget ? 'passed' : 'failed'} in ${elapsed} ms (limit ${setupBudget} ms)`,
    );
    return withinBudget ? 'passed' : 'failed';
  });
  results.set('Setup budget', browserSetup);
}

const playwrightArgs = full ? ['--forbid-only'] : [];
if (checks.browser) {
  void run(
    'Browser controls',
    'bun',
    ['run', 'test:browser', '--output=test-results/browser', ...playwrightArgs],
    browserSetup,
  );
}

if (checks.distribution) {
  const build = run('Production build', 'bun', ['run', 'build'], dependencies);
  if (options.includes('--check-committed')) {
    void check(
      'Standalone parity',
      async () => {
        const generated = await readFile('play.html');
        const { stdout: committed } = await exec('git', ['cat-file', 'blob', 'HEAD:play.html'], {
          encoding: 'buffer',
          maxBuffer: Math.max(1024 * 1024, generated.length + 1),
        });
        if (!generated.equals(committed)) throw new Error('generated play.html differs from HEAD:play.html');
      },
      build,
    );
  }
  void run(
    'Distribution',
    'bun',
    ['run', 'test:distribution', '--output=test-results/distribution', ...playwrightArgs],
    build,
    browserSetup,
  );
}

const completed = await Promise.all(
  Array.from(results, async ([name, status]) => ({ name, status: await status })),
);
if (full && completed.every(({ status }) => status === 'passed')) {
  const name = 'Test inventory';
  const status = await check(name, () => recordTestInventory(timingDirectory));
  completed.push({ name, status });
}
const failed = completed.filter((result) => result.status === 'failed').map((result) => result.name);
const blocked = completed.filter((result) => result.status === 'blocked').map((result) => result.name);
if (failed.length) {
  console.error(`Failed game checks: ${failed.join(', ')}`);
  process.exitCode = 1;
}
if (blocked.length) console.error(`Blocked game checks: ${blocked.join(', ')}`);
