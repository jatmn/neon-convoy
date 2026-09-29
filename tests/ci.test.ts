import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedPaths, checksFor, validationKey } from '../scripts/ci.ts';

const none = { types: false, simulation: false, browser: false, distribution: false, deployment: false };
const game = { ...none, types: true, simulation: true, browser: true, distribution: true };
const all = { ...game, deployment: true };

test('documentation and screenshots skip game checks', () => {
  assert.deepEqual(checksFor(['README.md', 'docs/validation.md', 'docs/screenshots/mobile.png']), none);
  assert.deepEqual(checksFor([]), none);
});

test('shared tooling and the workflow validate every surface', () => {
  for (const path of ['package.json', 'package-lock.json', 'tsconfig.json', '.github/workflows/check.yml']) {
    assert.deepEqual(checksFor([path]), all, path);
  }
});

test('simulation changes exercise their browser and build consumers', () => {
  for (const path of ['src/engine.ts', 'src/levels.ts', 'src/types.ts']) assert.deepEqual(checksFor([path]), game, path);
  assert.deepEqual(checksFor(['tests/engine.test.ts']), { ...none, types: true, simulation: true });
});

test('UI and assets skip simulation but exercise browser and distribution', () => {
  for (const path of ['src/main.ts', 'src/audio.ts', 'src/renderer.ts', 'vite.config.ts']) {
    assert.deepEqual(checksFor([path]), { ...game, simulation: false }, path);
  }
  for (const path of ['src/style.css', 'index.html', 'favicon.svg', 'public/texture.png']) {
    assert.deepEqual(checksFor([path]), { ...none, browser: true, distribution: true }, path);
  }
});

test('test and packaging changes only run their related checks', () => {
  assert.deepEqual(checksFor(['tests/browser.spec.ts']), { ...none, types: true, browser: true });
  for (const path of ['scripts/standalone.ts', 'tests/distribution.spec.ts', 'playwright.distribution.config.ts']) {
    assert.deepEqual(checksFor([path]), { ...none, types: true, distribution: true }, path);
  }
  for (const path of ['LICENSE', 'play.html']) assert.deepEqual(checksFor([path]), { ...none, distribution: true });
  assert.deepEqual(checksFor(['playwright.config.ts']), { ...game, simulation: false });
  assert.deepEqual(checksFor(['tests/engine.test.ts', 'play.html']), { ...none, types: true, simulation: true, distribution: true });
});

test('deployment and routing changes skip unrelated game tests', () => {
  for (const path of ['scripts/deploy.ts', 'tests/deploy.test.ts']) {
    assert.deepEqual(checksFor([path]), { ...none, types: true, deployment: true });
  }
  assert.deepEqual(checksFor(['.github/workflows/deploy.yml']), { ...none, deployment: true });
  for (const path of ['scripts/ci.ts', 'tests/ci.test.ts']) assert.deepEqual(checksFor([path]), { ...none, types: true });
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
    return Object.fromEntries(stdout.trim().split('\n').filter(line => !line.startsWith('key=')).map(line => {
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

test('validation reuse ignores docs but includes merge-base inputs, modes, deletions and selected checks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neon-validation-'));
  const original = process.cwd();
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  const commit = () => { git('add', '.'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'CI fixture'); git('config', 'user.email', 'ci@example.invalid');
    writeFileSync(join(dir, 'index.html'), 'game');
    const base = commit();
    process.chdir(dir);
    const key = validationKey(base, game);
    git('switch', '-qc', 'feature');
    writeFileSync(join(dir, 'README.md'), 'docs');
    const docs = commit();
    assert.equal(validationKey(docs, game), key, 'docs-only pushes reuse identical game inputs');
    assert.notEqual(validationKey(docs, none), key, 'partial validation cannot bless other surfaces');
    git('switch', '-q', 'main');
    writeFileSync(join(dir, 'index.html'), 'changed upstream game');
    commit();
    git('merge', '-q', '--no-edit', 'feature');
    assert.notEqual(validationKey('HEAD', game), key, 'actual merge tree detects base-branch code changes');
    const mergedKey = validationKey('HEAD', game);
    git('update-index', '--chmod=+x', 'index.html'); git('commit', '-qm', 'mode');
    assert.notEqual(validationKey('HEAD', game), mergedKey, 'file modes are inputs too');
    const modeKey = validationKey('HEAD', game);
    git('rm', '-qf', 'index.html'); commit();
    assert.notEqual(validationKey('HEAD', game), modeKey, 'deleted files invalidate validation');
  } finally {
    process.chdir(original);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('required aggregate rejects failed selection and selected jobs, including cancelled runs', () => {
  const workflow = readFileSync(new URL('../.github/workflows/check.yml', import.meta.url), 'utf8');
  const source = workflow.match(/python3 - <<'PY'\n([\s\S]*?)          PY/)?.[1];
  assert.ok(source);
  const script = source.split('\n').map(line => line.slice(10)).join('\n');
  const results = {
    changes: { result: 'success', outputs: { ...Object.fromEntries(Object.entries(game).map(([k, v]) => [k, String(v)])), reused: 'false' } },
    types: { result: 'success' }, simulation: { result: 'success' },
    browser: { result: 'success' }, distribution: { result: 'success' },
  };
  const check = () => spawnSync('python3', ['-c', script], { env: { ...process.env, RESULTS: JSON.stringify(results) }, stdio: 'ignore' }).status;
  assert.equal(check(), 0);
  for (const failure of ['failure', 'cancelled', 'skipped']) {
    results.browser.result = failure;
    assert.notEqual(check(), 0, failure);
  }
  results.changes.outputs.reused = 'true';
  for (const job of ['types', 'simulation', 'browser', 'distribution'] as const) results[job].result = 'skipped';
  assert.equal(check(), 0, 'matching successful validation permits skipped jobs');
  results.changes.result = 'failure';
  assert.notEqual(check(), 0, 'cache hit never bypasses failed routing or uploader tests');
});

test('main baseline preserves pending game changes across docs pushes and fails safe without an ancestor', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'neon-main-baseline-'));
  const original = process.cwd();
  const workflow = readFileSync(new URL('../.github/workflows/check.yml', import.meta.url), 'utf8');
  const source = workflow.match(/- name: Find successfully checked main baseline[\s\S]*?run: \|\n((?:          .*\n)+)/)?.[1];
  assert.ok(source);
  const script = source.split('\n').map(line => line.slice(10)).join('\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  const commit = () => { git('add', 'index.html', 'README.md'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'CI fixture'); git('config', 'user.email', 'ci@example.invalid');
    writeFileSync(join(dir, 'index.html'), 'game'); writeFileSync(join(dir, 'README.md'), 'docs');
    const success = commit();
    git('switch', '-qc', 'diverged');
    writeFileSync(join(dir, 'index.html'), 'unrelated branch');
    const unrelated = commit();
    git('switch', '-q', 'main');
    writeFileSync(join(dir, 'index.html'), 'pending game change');
    const pending = commit();
    writeFileSync(join(dir, 'README.md'), 'updated docs');
    const head = commit();
    writeFileSync(join(dir, 'gh'), '#!/bin/sh\n[ "$1" = api ] && [ "$2" = "repos/fixture/game/actions/workflows/check.yml/runs?event=push&branch=main&status=success&per_page=100" ] || exit 2\n[ "$TEST_API_FAILURE" != true ] || exit 1\nprintf "%s\\n" "$TEST_CANDIDATES"\n', { mode: 0o755 });
    const output = join(dir, 'outputs');
    const baseline = (candidates: string, failure = false) => {
      writeFileSync(output, '');
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
        cwd: dir, stdio: 'ignore', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GH_REPO: 'fixture/game', HEAD_SHA: head, GITHUB_OUTPUT: output, TEST_CANDIDATES: candidates, TEST_API_FAILURE: String(failure) },
      });
      assert.equal(result.status, 0);
      return readFileSync(output, 'utf8').trim().slice(4);
    };
    process.chdir(dir);
    assert.deepEqual(checksFor(changedPaths(pending, head, false)), none, 'last-push diff would wrongly skip pending validation');
    const selectedBase = baseline(`${unrelated}\n${success}`);
    assert.equal(selectedBase, success, 'ignore successful runs from nonancestor history');
    assert.deepEqual(checksFor(changedPaths(selectedBase, head, false)), { ...none, browser: true, distribution: true }, 'docs push carries pending game checks');
    assert.equal(baseline(''), '0'.repeat(40));
    assert.equal(baseline(success, true), '0'.repeat(40), 'API failure cannot narrow validation');
  } finally {
    process.chdir(original);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deployment gate waits for exact main CI and rejects failed, cancelled or missing validation', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'neon-deploy-gate-'));
  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  const source = workflow.match(/- name: Wait for successful main CI[\s\S]*?run: \|\n((?:          .*\n)+)/)?.[1];
  assert.ok(source);
  const script = source.split('\n').map(line => line.slice(10)).join('\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'CI fixture'); git('config', 'user.email', 'ci@example.invalid');
    git('commit', '--allow-empty', '-qm', 'fixture');
    const revision = git('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'gh'), '#!/bin/sh\n[ "$1" = api ] && [ "$2" = "repos/fixture/game/actions/workflows/check.yml/runs?event=push&branch=main&head_sha=$TEST_REVISION&per_page=1" ] || exit 2\nprintf "%s\\n" "$TEST_RESULT"\n', { mode: 0o755 });
    writeFileSync(join(dir, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const check = (result: string) => spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
      cwd: dir, stdio: 'ignore', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GH_REPO: 'fixture/game', TEST_REVISION: revision, TEST_RESULT: result },
    }).status;
    assert.equal(check('success'), 0);
    for (const result of ['failure', 'cancelled', 'waiting', 'null']) assert.notEqual(check(result), 0, result);
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
