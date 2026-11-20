import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checksFor } from '../scripts/ci.ts';

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

test('lint configuration and JavaScript changes run the types and lint job', () => {
  for (const path of ['.oxlintrc.json', 'scripts/helper.mjs']) {
    assert.deepEqual(checksFor([path]), { ...none, types: true }, path);
  }
  assert.deepEqual(checksFor(['src/helper.js']), { ...game, simulation: false });
});

test('simulation changes exercise their browser and build consumers', () => {
  for (const path of ['src/engine.ts', 'src/levels.ts', 'src/types.ts']) assert.deepEqual(checksFor([path]), game, path);
  assert.deepEqual(checksFor(['tests/engine.test.ts']), { ...none, types: true, simulation: true });
});

test('UI and assets skip simulation but exercise browser and distribution', () => {
  for (const path of ['src/main.ts', 'src/audio.ts', 'src/renderer.ts']) {
    assert.deepEqual(checksFor([path]), { ...game, simulation: false }, path);
  }
  for (const path of ['src/style.css', 'index.html', 'favicon.svg', 'public/texture.png']) {
    assert.deepEqual(checksFor([path]), { ...none, browser: true, distribution: true }, path);
  }
});

test('auto-discovered Vite and shared Playwright configs exercise browser and distribution', () => {
  for (const name of ['vite', 'playwright']) {
    for (const extension of ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs']) {
      const path = `${name}.config.${extension}`;
      assert.deepEqual(checksFor([path]), { ...game, simulation: false }, path);
    }
  }
});

test('test and packaging changes only run their related checks', () => {
  assert.deepEqual(checksFor(['tests/browser.spec.ts']), { ...none, types: true, browser: true });
  for (const path of ['scripts/standalone.ts', 'tests/distribution.spec.ts', 'playwright.distribution.config.ts']) {
    assert.deepEqual(checksFor([path]), { ...none, types: true, distribution: true }, path);
  }
  for (const path of ['LICENSE', 'play.html']) assert.deepEqual(checksFor([path]), { ...none, distribution: true });
  assert.deepEqual(checksFor(['tests/engine.test.ts', 'play.html']), { ...none, types: true, simulation: true, distribution: true });
});

test('deployment and routing changes skip unrelated game tests', () => {
  for (const path of ['scripts/deploy.ts', 'tests/deploy.test.ts']) {
    assert.deepEqual(checksFor([path]), { ...none, types: true, deployment: true });
  }
  assert.deepEqual(checksFor(['.github/workflows/deploy.yml']), { ...none, deployment: true });
  for (const path of ['scripts/ci.ts', 'tests/ci.test.ts']) assert.deepEqual(checksFor([path]), { ...none, types: true });
});

test('CI entry point handles PR base divergence, deletions and renames', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neon-ci-'));
  const script = fileURLToPath(new URL('../scripts/ci.ts', import.meta.url));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  const commit = () => { git('add', '.'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  const run = (base: string, head: string) => {
    const output = join(dir, 'outputs');
    writeFileSync(output, '');
    const stdout = execFileSync(process.execPath, [script, base, head], {
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
    assert.deepEqual(run(advancedBase, docs), none, 'base-only changes are excluded');
    git('switch', '-q', 'docs');
    git('mv', 'play.html', 'old-play.html');
    const renamed = commit();
    assert.deepEqual(run(docs, renamed), { ...none, distribution: true }, 'old path of rename is included');
    git('switch', '-q', 'main');
    git('rm', 'package.json');
    const deleted = commit();
    assert.deepEqual(run(advancedBase, deleted), all, 'deleted paths are included');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('required aggregate rejects malformed selections and unsuccessful checks', () => {
  const workflow = readFileSync(new URL('../.github/workflows/check.yml', import.meta.url), 'utf8');
  const source = workflow.match(/python3 - <<'PY'\n([\s\S]*?)          PY/)?.[1];
  assert.ok(source);
  const script = source.split('\n').map(line => line.slice(10)).join('\n');
  const results = {
    changes: { result: 'success', outputs: { types: 'true', simulation: 'true', browser: 'true', distribution: 'true', deployment: 'true', uploader_result: 'success' } },
    types: { result: 'success' }, simulation: { result: 'success' },
    browser: { result: 'success' }, distribution: { result: 'success' },
  };
  const check = () => spawnSync('python3', ['-c', script], { env: { ...process.env, RESULTS: JSON.stringify(results) }, stdio: 'ignore' }).status;
  assert.equal(check(), 0);
  for (const failure of ['failure', 'cancelled', 'skipped']) {
    results.browser.result = failure;
    assert.notEqual(check(), 0, failure);
  }
  results.browser.result = 'success';
  Reflect.deleteProperty(results.changes.outputs, 'browser');
  assert.notEqual(check(), 0, 'an invalid selection cannot bless a job');
  results.changes.outputs.browser = 'true';
  assert.equal(check(), 0, 'restored valid selection');
  results.changes.result = 'failure';
  assert.notEqual(check(), 0, 'selection or tooling test failure always fails the aggregate');
  results.changes.result = 'success';

  const outputs = results.changes.outputs;
  outputs.uploader_result = 'skipped';
  assert.notEqual(check(), 0, 'a selected uploader test must succeed');
  outputs.deployment = 'false';
  assert.equal(check(), 0, 'an unselected uploader test may be skipped');
  outputs.deployment = 'invalid';
  assert.notEqual(check(), 0, 'an invalid uploader selection fails the aggregate');
  Reflect.deleteProperty(outputs, 'deployment');
  assert.notEqual(check(), 0, 'a missing uploader selection fails the aggregate');
});

test('PR selection requires an active merge queue; merge groups and pushes always run every check', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'neon-queue-'));
  const workflow = readFileSync(new URL('../.github/workflows/check.yml', import.meta.url), 'utf8');
  assert.match(workflow, /^  merge_group:\n    types: \[checks_requested\]$/m);
  assert.match(workflow, /id: queue\n        if: github\.event_name == 'pull_request' && github\.event\.pull_request\.base\.ref == 'main'/);
  const step = (name: string) => {
    const match = workflow.match(new RegExp(`- name: ${name}\\n([\\s\\S]*?)        run: \\|\\n((?:          .*\\n)+)`));
    assert.ok(match, name);
    return { configuration: match[1], command: match[2].split('\n').map(line => line.slice(10)).join('\n') };
  };
  const lookup = step('Detect the main merge queue');
  const selection = step('Select checks to run');
  assert.match(lookup.configuration, /GH_TOKEN:/);
  assert.match(selection.configuration, /QUEUE_ACTIVE: \$\{\{ steps\.queue\.outputs\.active \}\}/);
  assert.doesNotMatch(selection.configuration, /GH_TOKEN|github\.token/);
  try {
    writeFileSync(join(dir, 'gh'), '#!/bin/sh\n[ "$1" = api ] && [ "$2" = "repos/fixture/game/rules/branches/main" ] || exit 2\n[ "$API_RESULT" != error ] || exit 1\nprintf "%s\\n" "$API_RESULT"\n', { mode: 0o755 });
    writeFileSync(join(dir, 'node'), '#!/bin/sh\n[ "$1 $2 $3" = "scripts/ci.ts base head" ] || exit 2\nprintf "%s=false\\n" types simulation browser distribution deployment > "$GITHUB_OUTPUT"\n', { mode: 0o755 });
    const output = join(dir, 'outputs');
    const run = (command: string, env: Record<string, string>) => {
      writeFileSync(output, '');
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', command], {
        cwd: dir, encoding: 'utf8',
        env: { PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: output, ...env },
      });
      assert.equal(result.status, 0, result.stderr);
      return readFileSync(output, 'utf8').trim();
    };
    const select = (queue: string) => run(selection.command, {
      QUEUE_ACTIVE: queue.replace(/^active=/, ''), BASE_SHA: 'base', HEAD_SHA: 'head',
    });
    const outputFor = (checks: typeof all) => Object.entries(checks).map(([name, enabled]) => `${name}=${enabled}`).join('\n');
    for (const rules of ['merge_queue', '', 'error']) {
      const queue = run(lookup.command, { GH_REPO: 'fixture/game', API_RESULT: rules });
      assert.equal(select(queue), outputFor(rules === 'merge_queue' ? none : all), rules || 'no rule');
    }
    assert.equal(select(''), outputFor(all), 'events that skip lookup run every check');
  } finally {
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
