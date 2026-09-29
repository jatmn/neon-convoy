import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  for (const path of ['package.json', 'package-lock.json', 'tsconfig.json', '.github/workflows/check.yml', '.github/workflows/deploy.yml', 'scripts/ci.ts', 'scripts/deploy.ts', 'tests/ci.test.ts', 'tests/deploy.test.ts']) {
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
  for (const path of ['LICENSE', 'play.html']) assert.deepEqual(checksFor([path]), { ...none, distribution: true });
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

test('distribution gate compares the generated file with the committed standalone', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'neon-standalone-'));
  const workflow = readFileSync(new URL('../.github/workflows/check.yml', import.meta.url), 'utf8');
  const command = workflow.match(/- name: Check committed standalone build\s*\n\s*run: ([^\n]+)/)?.[1];
  assert.ok(command, 'distribution workflow must define its committed-build check');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  const check = () => spawnSync('bash', ['-e', '-o', 'pipefail', '-c', command], { cwd: dir, stdio: 'ignore' }).status;
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'CI fixture'); git('config', 'user.email', 'ci@example.invalid');
    writeFileSync(join(dir, 'play.html'), 'standalone');
    git('add', 'play.html'); git('commit', '-qm', 'fixture');
    assert.equal(check(), 0, 'matching committed build passes');
    writeFileSync(join(dir, 'play.html'), 'stale');
    assert.notEqual(check(), 0, 'stale generated bytes fail');
    writeFileSync(join(dir, 'play.html'), 'standalone');
    git('rm', '-q', 'play.html'); git('commit', '-qm', 'delete standalone');
    writeFileSync(join(dir, 'play.html'), 'standalone');
    assert.notEqual(check(), 0, 'regenerated untracked file cannot replace a committed artifact');
    rmSync(join(dir, 'play.html'));
    writeFileSync(join(dir, 'target.html'), 'standalone');
    symlinkSync('target.html', join(dir, 'play.html'));
    git('add', 'play.html', 'target.html'); git('commit', '-qm', 'link standalone');
    assert.notEqual(check(), 0, 'a committed link cannot replace the standalone HTML bytes');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
