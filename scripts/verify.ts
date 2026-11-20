import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { validationChecks } from './ci.ts';
import { recordTestInventory } from './test-inventory.ts';

const [mode = 'full', base, head, install] = process.argv.slice(2);
const checks = validationChecks(mode, base, head);
const results = new Map<string, Promise<boolean>>();

const budgets = new Map([
  ['Lint', 1_000],
  ['Format', 1_000],
  ['TypeScript', 5_000],
  ['Unit tests', 30_000],
  ['Browser controls', 30_000],
  ['Distribution', 30_000],
]);

function run(name: string, command: string, ...args: string[]): Promise<boolean> {
  const started = performance.now();
  return new Promise((resolve) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      const elapsed = performance.now() - started;
      const budget = budgets.get(name) ?? Infinity;
      const failure = error
        ? `failed (${error.code ?? error.signal ?? error.message})`
        : elapsed >= budget
          ? `failed (budget ${budget} ms)`
          : 'passed';
      console.log(`${name}: ${failure} in ${elapsed.toFixed(0)} ms`);
      resolve(!error && elapsed < budget);
    });
  });
}

const full = Object.values(checks).every(Boolean);
const directory = 'test-results/timings';
const unitArgs = ['test', '--isolate', '--randomize'];
if (full) {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  process.env.NEON_TEST_TIMINGS_DIRECTORY = directory;
  unitArgs.push(
    `--timings=${join(directory, 'unit.json')}`,
    '--update-timings',
    '--reporter=junit',
    `--reporter-outfile=${join(directory, 'unit-junit.xml')}`,
  );
} else {
  unitArgs.push('tests/ci.test.ts', 'scripts/pullfrog-command-check.test.ts');
  if (checks.simulation) unitArgs.push('tests/engine.test.ts');
  if (checks.deployment) unitArgs.push('tests/deploy.test.ts');
}
results.set('Unit tests', run('Unit tests', 'bun', ...unitArgs));
results.set('Format', run('Format', 'bun', 'fmt', '--check'));
results.set('Lint', run('Lint', 'bun', 'lint', '--type-aware', '--all', '--max-warnings', '0'));
if (checks.types) results.set('TypeScript', run('TypeScript', 'bun', 'check'));

const chromium =
  install === '--install-chromium' && (checks.browser || checks.distribution)
    ? run('Chromium setup', 'bun', '--bun', 'playwright', 'install', '--only-shell', 'chromium')
    : Promise.resolve(true);
results.set('Chromium setup', chromium);
if (process.env.GAME_CHECK_STARTED_MS) {
  const started = Number(process.env.GAME_CHECK_STARTED_MS);
  results.set(
    'Setup budget',
    chromium.then(() => {
      const elapsed = Date.now() - started;
      const withinBudget = elapsed >= 0 && elapsed < 15_000;
      console.log(`Setup budget: ${withinBudget ? 'passed' : 'failed'} in ${elapsed} ms (limit 15000 ms)`);
      return withinBudget;
    }),
  );
}

function browserDeadline() {
  const deadline = process.env.NEON_PUSH_DEADLINE_MS;
  return deadline ? [`--global-timeout=${Math.max(1, Number(deadline) - Date.now())}`] : [];
}

if (checks.browser) {
  results.set(
    'Browser controls',
    chromium.then(
      (ready) =>
        ready &&
        run(
          'Browser controls',
          'bun',
          'run',
          'test:browser',
          '--output=test-results/browser',
          ...browserDeadline(),
        ),
    ),
  );
}

if (checks.distribution) {
  const build = run('Production build', 'bun', 'run', 'build');
  results.set('Production build', build);
  results.set(
    'Standalone parity',
    build.then(
      (ready) =>
        ready &&
        run('Standalone parity', 'bash', '-o', 'pipefail', '-c', 'git show HEAD:play.html | cmp - play.html'),
    ),
  );
  results.set(
    'Distribution',
    Promise.all([build, chromium]).then(
      ([built, browserReady]) =>
        built &&
        browserReady &&
        run(
          'Distribution',
          'bun',
          'run',
          'test:distribution',
          '--output=test-results/distribution',
          ...browserDeadline(),
        ),
    ),
  );
}

const failed = (
  await Promise.all(Array.from(results, async ([name, result]) => ((await result) ? null : name)))
).filter(Boolean);
if (failed.length) {
  console.error(`Failed game checks: ${failed.join(', ')}`);
  process.exitCode = 1;
}

if (!failed.length && full) recordTestInventory(directory);
