import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checksFor } from '../scripts/ci.ts';

const none = { types: false, simulation: false, browser: false, distribution: false };
const all = { types: true, simulation: true, browser: true, distribution: true };

test('documentation and screenshots skip game checks', () => {
  assert.deepEqual(checksFor(['README.md', 'docs/validation.md', 'docs/screenshots/mobile.png']), none);
  assert.deepEqual(checksFor([]), none);
});

test('shared tooling and the workflow validate every surface', () => {
  for (const path of ['package.json', 'package-lock.json', 'tsconfig.json', '.github/workflows/check.yml', 'scripts/ci.ts', 'tests/ci.test.ts']) {
    assert.deepEqual(checksFor([path]), all, path);
  }
});

test('simulation changes exercise their browser and build consumers', () => {
  for (const path of ['src/engine.ts', 'src/levels.ts', 'src/types.ts']) assert.deepEqual(checksFor([path]), all, path);
  assert.deepEqual(checksFor(['tests/engine.test.ts']), { ...none, types: true, simulation: true });
});

test('UI and assets skip simulation but exercise browser and distribution', () => {
  for (const path of ['src/main.ts', 'src/audio.ts', 'src/renderer.ts', 'vite.config.ts']) {
    assert.deepEqual(checksFor([path]), { ...all, simulation: false }, path);
  }
  for (const path of ['src/style.css', 'index.html', 'favicon.svg']) {
    assert.deepEqual(checksFor([path]), { ...none, browser: true, distribution: true }, path);
  }
});

test('test and packaging changes only run their related checks', () => {
  assert.deepEqual(checksFor(['tests/browser.spec.ts']), { ...none, types: true, browser: true });
  for (const path of ['scripts/standalone.ts', 'tests/distribution.spec.ts', 'playwright.distribution.config.ts']) {
    assert.deepEqual(checksFor([path]), { ...none, types: true, distribution: true }, path);
  }
  assert.deepEqual(checksFor(['play.html']), { ...none, distribution: true });
  assert.deepEqual(checksFor(['playwright.config.ts']), { ...all, simulation: false });
  assert.deepEqual(checksFor(['tests/engine.test.ts', 'play.html']), { ...none, types: true, simulation: true, distribution: true });
});

test('CI entry point handles PR base divergence, push deletions, renames and new branches', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neon-ci-'));
  const script = fileURLToPath(new URL('../scripts/ci.ts', import.meta.url));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  const commit = () => { git('add', '.'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  const run = (base: string, head: string, event: string) => {
    const output = join(dir, 'outputs');
    writeFileSync(output, '');
    const stdout = execFileSync(process.execPath, [script, base, head, event], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output },
    });
    assert.equal(stdout, readFileSync(output, 'utf8'));
    return Object.fromEntries(stdout.trim().split('\n').map(line => {
      const [key, value] = line.split('='); return [key, value === 'true'];
    }));
  };
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'CI fixture'); git('config', 'user.email', 'ci@example.invalid');
    writeFileSync(join(dir, 'play.html'), 'standalone');
    writeFileSync(join(dir, '.gitignore'), 'outputs\n');
    const base = commit();
    git('switch', '-qc', 'docs');
    writeFileSync(join(dir, 'README with spaces.md'), 'documentation');
    const docs = commit();
    git('switch', '-q', 'main');
    writeFileSync(join(dir, 'package.json'), '{}');
    const advancedBase = commit();
    assert.deepEqual(run(advancedBase, docs, 'pull_request'), none, 'base-only changes are excluded');
    git('switch', '-q', 'docs');
    git('mv', 'play.html', 'old-play.html');
    const renamed = commit();
    assert.deepEqual(run(docs, renamed, 'push'), { ...none, distribution: true }, 'old path of rename is included');
    git('switch', '-q', 'main');
    git('rm', 'package.json');
    const deleted = commit();
    assert.deepEqual(run(advancedBase, deleted, 'push'), all, 'deleted paths are included');
    assert.deepEqual(run('0'.repeat(40), base, 'push'), all, 'initial push validates everything');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
