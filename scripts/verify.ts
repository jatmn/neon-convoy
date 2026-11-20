import { execFile } from 'node:child_process';
import { validationChecks } from './ci.ts';

const [mode = 'full', base, head, install] = process.argv.slice(2);
const checks = validationChecks(mode, base, head);
const results = new Map<string, Promise<boolean>>();

function run(name: string, command: string, ...args: string[]): Promise<boolean> {
  return new Promise(resolve => {
    execFile(command, args, (error, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      console.log(`${name}: ${error ? `failed (${error.code ?? error.signal ?? error.message})` : 'passed'}`);
      resolve(!error);
    });
  });
}

const unitFiles = ['tests/ci.test.ts', 'scripts/pullfrog-command-check.test.ts'];
if (checks.simulation) unitFiles.push('tests/engine.test.ts');
if (checks.deployment) unitFiles.push('tests/deploy.test.ts');
results.set('Unit tests', run('Unit tests', 'bun', 'test', '--isolate', '--randomize', ...unitFiles));
if (checks.types) results.set('TypeScript', run('TypeScript', 'bun', 'check'));

const chromium = install === '--install-chromium' && (checks.browser || checks.distribution)
  ? run('Chromium setup', 'bun', '--bun', 'playwright', 'install', '--only-shell', 'chromium')
  : Promise.resolve(true);
results.set('Chromium setup', chromium);

if (checks.browser) {
  results.set('Browser controls', chromium.then(ready => ready
    && run('Browser controls', 'bun', 'run', 'test:browser', '--output=test-results/browser')));
}

if (checks.distribution) {
  const build = run('Production build', 'bun', 'run', 'build');
  results.set('Production build', build);
  results.set('Standalone parity', build.then(ready => ready
    && run('Standalone parity', 'bash', '-o', 'pipefail', '-c', 'git show HEAD:play.html | cmp - play.html')));
  results.set('Distribution', Promise.all([build, chromium]).then(([built, browserReady]) => built && browserReady
    && run('Distribution', 'bun', 'run', 'test:distribution', '--output=test-results/distribution')));
}

const failed = (await Promise.all(Array.from(results, async ([name, result]) => await result ? null : name))).filter(Boolean);
if (failed.length) {
  console.error(`Failed game checks: ${failed.join(', ')}`);
  process.exitCode = 1;
}
