import { execFile, spawn } from 'node:child_process';
import type { StdioOptions } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { validationChecks } from './ci.ts';

type CheckResult = 'passed' | 'failed' | 'blocked';

const [mode = 'full', base, head, ...options] = process.argv.slice(2);
const checks = validationChecks(mode, base, head);
const results = new Map<string, Promise<CheckResult>>();
const exec = promisify(execFile);

function check(name: string, start: () => Promise<void>, ...prerequisites: Promise<CheckResult>[]) {
  const result = Promise.all(prerequisites).then(async (ready): Promise<CheckResult> => {
    if (ready.some(status => status !== 'passed')) return 'blocked';

    console.log(`${name}: started`);
    try {
      await start();
      console.log(`${name}: passed`);
      return 'passed';
    } catch (error) {
      console.error(`${name}: failed (${error instanceof Error ? error.message : error})`);
      return 'failed';
    }
  });
  results.set(name, result);
  return result;
}

function run(name: string, command: string, args: string[], ...prerequisites: Promise<CheckResult>[]) {
  return check(name, () => new Promise<void>((resolve, reject) => {
    const stdio: StdioOptions = ['ignore', 'inherit', 'inherit'];
    const child = spawn(command, args, { stdio });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(signal ?? `exit code ${code}`));
    });
  }), ...prerequisites);
}

const unitFiles = ['tests/ci.test.ts', 'scripts/pullfrog-command-check.test.ts'];
if (checks.simulation) unitFiles.push('tests/engine.test.ts');
if (checks.deployment) unitFiles.push('tests/deploy.test.ts');
run('Unit tests', 'bun', ['test', '--isolate', '--randomize', ...unitFiles]);
const needsChromium = checks.browser || checks.distribution;
const dependencies = options.includes('--install-dependencies') && (checks.types || needsChromium)
  ? run('Dependency install', 'bun', ['install', '--frozen-lockfile'])
  : Promise.resolve<CheckResult>('passed');

if (checks.types) {
  run('Test lint', 'bun', ['run', 'lint'], dependencies);
  run('TypeScript', 'bun', ['check'], dependencies);
}

const chromium = options.includes('--install-chromium') && needsChromium
  ? run('Chromium setup', 'bun', ['--bun', 'playwright', 'install', '--only-shell', 'chromium'], dependencies)
  : dependencies;

if (checks.browser) {
  run('Browser controls', 'bun', ['run', 'test:browser', '--output=test-results/browser'], chromium);
}

if (checks.distribution) {
  const build = run('Production build', 'bun', ['run', 'build'], dependencies);
  if (options.includes('--check-committed')) {
    check('Standalone parity', async () => {
      const generated = await readFile('play.html');
      const { stdout: committed } = await exec('git', ['cat-file', 'blob', 'HEAD:play.html'], {
        encoding: 'buffer',
        maxBuffer: Math.max(1024 * 1024, generated.length + 1),
      });
      if (!generated.equals(committed)) throw new Error('generated play.html differs from HEAD:play.html');
    }, build);
  }
  run('Distribution', 'bun', ['run', 'test:distribution', '--output=test-results/distribution'], build, chromium);
}

const completed = await Promise.all(Array.from(results, async ([name, status]) => ({ name, status: await status })));
const failed = completed.filter(result => result.status === 'failed').map(result => result.name);
const blocked = completed.filter(result => result.status === 'blocked').map(result => result.name);
if (failed.length) {
  console.error(`Failed game checks: ${failed.join(', ')}`);
  process.exitCode = 1;
}
if (blocked.length) console.error(`Blocked game checks: ${blocked.join(', ')}`);
