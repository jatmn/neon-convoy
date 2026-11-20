import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checksFor, validationChecks } from '../scripts/ci.ts';

const none = { types: false, simulation: false, browser: false, distribution: false, deployment: false };
const game = { ...none, types: true, simulation: true, browser: true, distribution: true };
const all = { ...game, deployment: true };

void test('documentation and screenshots skip game checks', () => {
  assert.deepEqual(checksFor(['README.md', 'docs/validation.md', 'docs/screenshots/mobile.png']), none);
  assert.deepEqual(checksFor([]), none);
});

void test('shared tooling and unclassified paths validate every surface', () => {
  for (const path of [
    'package.json',
    'bun.lock',
    'bunfig.toml',
    'scripts/install-bun.sh',
    'tsconfig.json',
    '.github/workflows/check.yml',
    '.oxlintrc.json',
    '.oxlintrc.native.json',
    'AGENTS.md',
    'fixtures/new-module.ts',
    'docs/executable.ts',
    'scripts/helper.mjs',
    'src/helper.js',
  ]) {
    assert.deepEqual(checksFor([path]), all, path);
  }
});

void test('simulation changes exercise their browser and build consumers', () => {
  for (const path of ['src/engine.ts', 'src/levels.ts', 'src/types.ts'])
    assert.deepEqual(checksFor([path]), game, path);
  assert.deepEqual(checksFor(['tests/engine.test.ts']), { ...none, types: true, simulation: true });
});

void test('UI and assets exercise browser and distribution', () => {
  for (const path of ['src/main.ts', 'src/audio.ts', 'src/renderer.ts']) {
    const checks = checksFor([path]);
    assert.equal(checks.types && checks.browser && checks.distribution, true, path);
  }
  for (const path of ['src/style.css', 'index.html', 'favicon.svg', '.gitattributes', 'public/texture.png']) {
    assert.deepEqual(checksFor([path]), { ...none, browser: true, distribution: true }, path);
  }
});

void test('auto-discovered Vite and shared Playwright configs exercise browser and distribution', () => {
  for (const name of ['vite', 'playwright']) {
    for (const extension of ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs']) {
      const path = `${name}.config.${extension}`;
      assert.deepEqual(checksFor([path]), { ...game, simulation: false }, path);
    }
  }
});

void test('test and packaging changes only run their related checks', () => {
  assert.deepEqual(checksFor(['tests/browser.spec.ts']), { ...none, types: true, browser: true });
  for (const path of [
    'scripts/standalone.ts',
    'tests/distribution.spec.ts',
    'playwright.distribution.config.ts',
  ]) {
    assert.deepEqual(checksFor([path]), { ...none, types: true, distribution: true }, path);
  }
  for (const path of ['LICENSE', 'play.html'])
    assert.deepEqual(checksFor([path]), { ...none, distribution: true });
  assert.deepEqual(checksFor(['tests/engine.test.ts', 'play.html']), {
    ...none,
    types: true,
    simulation: true,
    distribution: true,
  });
});

void test('deployment and routing changes skip unrelated game tests', () => {
  for (const path of ['scripts/deploy.ts', 'tests/deploy.test.ts']) {
    assert.deepEqual(checksFor([path]), { ...none, types: true, deployment: true });
  }
  assert.deepEqual(checksFor(['.github/workflows/deploy.yml']), { ...none, deployment: true });
  for (const path of ['scripts/ci.ts', 'tests/ci.test.ts'])
    assert.deepEqual(checksFor([path]), { ...none, types: true });
});

void test('CI entry point handles PR base divergence, deletions, renames and full validation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neon-ci-'));
  const script = fileURLToPath(new URL('../scripts/ci.ts', import.meta.url));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  const commit = () => {
    git('add', '.');
    git('commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  const run = (base: string, head: string) => {
    const output = join(dir, 'outputs');
    writeFileSync(output, '');
    const stdout = execFileSync(process.execPath, [script, base, head], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: output },
    });
    assert.equal(stdout, readFileSync(output, 'utf8'));
    return Object.fromEntries(
      stdout
        .trim()
        .split('\n')
        .map((line) => {
          const [key, value] = line.split('=');
          return [key, value === 'true'];
        }),
    );
  };
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'CI fixture');
    git('config', 'user.email', 'ci@example.invalid');
    writeFileSync(join(dir, 'play.html'), 'standalone');
    writeFileSync(join(dir, '.gitignore'), 'outputs\n');
    commit();
    git('switch', '-qc', 'docs');
    writeFileSync(join(dir, 'README with spaces.md'), 'documentation');
    const docs = commit();
    git('switch', '-q', 'main');
    writeFileSync(join(dir, 'package.json'), '{}');
    const advancedBase = commit();
    assert.deepEqual(run(advancedBase, docs), none, 'base-only changes are excluded');
    git('switch', '-qc', 'runner', docs);
    mkdirSync(join(dir, 'scripts'));
    writeFileSync(join(dir, 'scripts/verify.ts'), 'export {};');
    const runner = commit();
    assert.deepEqual(run(advancedBase, runner), all, 'runner-only changes exercise every surface');
    git('switch', '-q', 'docs');
    git('mv', 'play.html', 'archived.md');
    const renamed = commit();
    assert.deepEqual(run(docs, renamed), { ...none, distribution: true }, 'old path of rename is included');
    git('switch', '-q', 'main');
    git('rm', 'package.json');
    const deleted = commit();
    assert.deepEqual(run(advancedBase, deleted), all, 'deleted paths are included');
    assert.deepEqual(
      validationChecks('full', '', docs),
      all,
      'full validation runs everything on a docs-only revision',
    );
    mkdirSync(join(dir, 'src'));
    mkdirSync(join(dir, 'tests'));
    writeFileSync(join(dir, 'src/audio.ts'), 'export const cellSize = 4;');
    writeFileSync(join(dir, 'tests/engine.test.ts'), 'console.log("simulation");');
    const unlinked = commit();
    writeFileSync(join(dir, 'src/audio.ts'), 'export const cellSize = 5;');
    assert.deepEqual(
      run(unlinked, commit()),
      { ...game, simulation: false },
      'an independent file does not select simulation',
    );
    writeFileSync(
      join(dir, 'tests/engine.test.ts'),
      'import { cellSize } from "../src/audio.ts"; console.log(cellSize);',
    );
    const linked = commit();
    writeFileSync(join(dir, 'src/audio.ts'), 'export const cellSize = 8;');
    assert.deepEqual(run(linked, commit()), game, 'a transitive source change selects simulation');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test(
  'required game checks fail and report all unsuccessful commands',
  { skip: process.platform === 'win32' },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'neon-verify-'));
    const script = fileURLToPath(new URL('../scripts/verify.ts', import.meta.url));
    try {
      writeFileSync(
        join(dir, 'bun'),
        [
          '#!/bin/sh',
          'case "$1:$2" in',
          '  test:*) exit 2 ;;',
          '  check:*|run:build) exit 1 ;;',
          '  lint:--no-script) exit 4 ;;',
          '  fmt:--check) exit 5 ;;',
          '  --bun:playwright) exit 3 ;;',
          'esac',
        ].join('\n'),
        { mode: 0o755 },
      );
      const run = (...args: string[]) =>
        spawnSync(process.execPath, [script, ...args], {
          cwd: dir,
          encoding: 'utf8',
          env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
        });
      const result = run();
      assert.equal(result.status, 1, result.stderr);
      assert.match(
        result.stderr,
        /^Failed game checks: Unit tests, Format, Native lint, TypeScript, Production build$/m,
      );
      assert.match(result.stderr, /^Blocked game checks: Distribution$/m);
      assert.match(result.stdout, /Browser controls: passed/);
      const install = run('full', '', '', '--install-chromium', '--check-committed');
      assert.equal(install.status, 1, install.stderr);
      assert.match(
        install.stderr,
        /^Failed game checks: Unit tests, Format, Native lint, TypeScript, Chromium setup, Production build$/m,
      );
      assert.match(
        install.stderr,
        /^Blocked game checks: Browser controls, Standalone parity, Distribution$/m,
      );
      assert.doesNotMatch(install.stdout, /^Browser controls: started$/m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

void test(
  'the CI runner installs packages once, only when a selected check needs them',
  { skip: process.platform === 'win32' },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'neon-dependencies-'));
    const script = fileURLToPath(new URL('../scripts/verify.ts', import.meta.url));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    const run = (status: string, ...args: string[]) =>
      spawnSync(
        process.execPath,
        [script, ...args, '--install-dependencies', '--install-chromium', '--check-committed'],
        {
          cwd: dir,
          encoding: 'utf8',
          env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, INSTALL_STATUS: status },
        },
      );
    try {
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'CI fixture');
      git('config', 'user.email', 'ci@example.invalid');
      git('commit', '-qm', 'root', '--allow-empty');
      writeFileSync(join(dir, 'README.md'), 'docs');
      git('add', 'README.md');
      git('commit', '-qm', 'docs');
      mkdirSync(join(dir, 'scripts'));
      writeFileSync(join(dir, 'scripts/ci.ts'), 'export {};');
      git('add', 'scripts/ci.ts');
      git('commit', '-qm', 'types');
      writeFileSync(
        join(dir, 'bun'),
        [
          '#!/bin/sh',
          'case "$*" in',
          '  "test --isolate --randomize "*|"fmt --check") exit 0 ;;',
          '  "install --frozen-lockfile") echo install >> installs; exit "$INSTALL_STATUS" ;;',
          '  check|"run lint") test -f installs ;;',
          '  "lint --no-script --config .oxlintrc.native.json --type-aware --all --max-warnings 0") test -f installs ;;',
          '  *) exit 7 ;;',
          'esac',
        ].join('\n'),
        { mode: 0o755 },
      );

      const docs = run('1', 'selected', 'HEAD~2', 'HEAD~1');
      assert.equal(docs.status, 0, docs.stderr);
      assert.match(docs.stdout, /^Unit tests: passed$/m);
      assert.match(docs.stdout, /^Format: passed$/m);
      assert.throws(() => readFileSync(join(dir, 'installs')), { code: 'ENOENT' });

      const types = run('0', 'selected', 'HEAD~1', 'HEAD');
      assert.equal(types.status, 0, types.stderr);
      assert.match(types.stdout, /^TypeScript: passed$/m);
      assert.match(types.stdout, /^Test lint: passed$/m);
      assert.match(types.stdout, /^Native lint: passed$/m);
      assert.equal(readFileSync(join(dir, 'installs'), 'utf8'), 'install\n');

      const failed = run('1', 'full', '', '');
      assert.equal(failed.status, 1, failed.stderr);
      assert.match(failed.stdout, /^Unit tests: passed$/m);
      assert.match(failed.stderr, /^Failed game checks: Dependency install$/m);
      assert.match(
        failed.stderr,
        /^Blocked game checks: Test lint, Native lint, TypeScript, Chromium setup, Browser controls, Production build, Standalone parity, Distribution$/m,
      );
      assert.equal(readFileSync(join(dir, 'installs'), 'utf8'), 'install\ninstall\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

void test(
  'PR selection requires an active merge queue; merge groups and pushes always run every check',
  { skip: process.platform === 'win32' },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'neon-queue-'));
    const workflow = readFileSync(new URL('../.github/workflows/check.yml', import.meta.url), 'utf8');
    assert.doesNotMatch(workflow, /^ +-[^\n]*run: bun install\b/m);
    assert.match(workflow, /^  merge_group:\n    types: \[checks_requested\]$/m);
    assert.match(
      workflow,
      /id: queue\n        if: github\.event_name == 'pull_request' && github\.event\.pull_request\.base\.ref == 'main'/,
    );
    const step = (name: string) => {
      const match = workflow.match(
        new RegExp(`- name: ${name}\\n([\\s\\S]*?)        run: \\|\\n((?:          .*\\n)+)`),
      );
      assert.ok(match, name);
      return {
        configuration: match[1],
        command: match[2]
          .split('\n')
          .map((line) => line.slice(10))
          .join('\n'),
      };
    };
    const lookup = step('Detect the main merge queue');
    const verify = step('Run game checks');
    assert.match(lookup.configuration, /GH_TOKEN:/);
    assert.match(verify.configuration, /QUEUE_ACTIVE: \$\{\{ steps\.queue\.outputs\.active \}\}/);
    assert.doesNotMatch(verify.configuration, /GH_TOKEN|github\.token/);
    try {
      writeFileSync(
        join(dir, 'gh'),
        `#!/bin/sh
[ "$#" = 5 ] && [ "$1" = api ] && [ "$2" = repos/fixture/game/rules/branches/main ] &&
  [ "$3" = --paginate ] && [ "$4" = --jq ] && [ "$5" = '.[] | select(.type == "merge_queue") | .type' ] || exit 2
[ "$API_RULES" != error ] || exit 1
"$TEST_BUN" -e 'for (const rule of JSON.parse(process.env.API_RULES)) if (rule.type === "merge_queue") console.log(rule.type)'
`,
        { mode: 0o755 },
      );
      writeFileSync(
        join(dir, 'bun'),
        '#!/bin/sh\n[ "$1 $3 $4 $5 $6 $7" = "scripts/verify.ts base head --install-dependencies --install-chromium --check-committed" ] || exit 2\nprintf "%s\\n" "$2"\n',
        { mode: 0o755 },
      );
      const output = join(dir, 'outputs');
      const run = (command: string, env: Record<string, string>) => {
        writeFileSync(output, '');
        const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', command], {
          cwd: dir,
          encoding: 'utf8',
          env: { PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: output, ...env },
        });
        assert.equal(result.status, 0, result.stderr);
        return { output: readFileSync(output, 'utf8').trim(), stdout: result.stdout.trim() };
      };
      const mode = (queue: string) =>
        run(verify.command, {
          QUEUE_ACTIVE: queue.replace(/^active=/, ''),
          BASE_SHA: 'base',
          HEAD_SHA: 'head',
        }).stdout;
      for (const [rules, expected] of [
        ['[{"type":"required_status_checks"},{"type":"merge_queue"}]', 'selected'],
        ['[{"type":"required_status_checks"}]', 'full'],
        ['error', 'full'],
      ]) {
        const queue = run(lookup.command, {
          GH_REPO: 'fixture/game',
          API_RULES: rules,
          TEST_BUN: process.execPath,
        });
        assert.equal(mode(queue.output), expected, rules);
      }
      assert.equal(mode(''), 'full', 'events that skip lookup run every check');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

void test(
  'deployment gate waits for exact main CI and rejects failed, cancelled or missing validation',
  { skip: process.platform === 'win32' },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'neon-deploy-gate-'));
    const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
    const source = workflow.match(
      /- name: Wait for successful main CI[\s\S]*?run: \|\n((?:          .*\n)+)/,
    )?.[1];
    assert.ok(source);
    const script = source
      .split('\n')
      .map((line) => line.slice(10))
      .join('\n');
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    try {
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'CI fixture');
      git('config', 'user.email', 'ci@example.invalid');
      git('commit', '--allow-empty', '-qm', 'fixture');
      const revision = git('rev-parse', 'HEAD');
      writeFileSync(
        join(dir, 'gh'),
        '#!/bin/sh\n[ "$1" = api ] && [ "$2" = "repos/fixture/game/actions/workflows/check.yml/runs?event=push&branch=main&head_sha=$TEST_REVISION&per_page=1" ] || exit 2\nprintf "%s\\n" "$TEST_RESULT"\n',
        { mode: 0o755 },
      );
      writeFileSync(join(dir, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      const check = (result: string) =>
        spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
          cwd: dir,
          stdio: 'ignore',
          env: {
            ...process.env,
            PATH: `${dir}:${process.env.PATH}`,
            GH_REPO: 'fixture/game',
            TEST_REVISION: revision,
            TEST_RESULT: result,
          },
        }).status;
      assert.equal(check('success'), 0);
      for (const result of ['failure', 'cancelled', 'waiting', 'null'])
        assert.notEqual(check(result), 0, result);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

void test('distribution gate compares the generated file with the committed standalone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neon-standalone-'));
  const script = fileURLToPath(new URL('../scripts/verify.ts', import.meta.url));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'CI fixture');
    git('config', 'user.email', 'ci@example.invalid');
    git('config', 'core.autocrlf', 'false');
    // Feed controlled build bytes through the verifier and Git.
    writeFileSync(join(dir, 'bunfig.toml'), '[fmt]\nignorePatterns = ["play.html", "generated.html"]\n');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        scripts: {
          build: `bun -e "await Bun.write('play.html', Bun.file('generated.html'))"`,
          'test:distribution': 'bun -e "0" --',
        },
      }),
    );
    for (const file of ['tests/ci.test.ts', 'scripts/pullfrog-command-check.test.ts']) {
      mkdirSync(join(dir, file.split('/')[0]));
      writeFileSync(join(dir, file), 'import { test } from "node:test"; test("fixture", () => {});');
    }
    execFileSync(process.execPath, ['fmt'], { cwd: dir });
    git('add', '.');
    git('commit', '-qm', 'fixture');
    const base = git('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'play.html'), 'standalone\n');
    writeFileSync(join(dir, 'generated.html'), 'standalone\n');
    git('add', 'play.html');
    git('commit', '-qm', 'add standalone');
    const head = git('rev-parse', 'HEAD');
    const check = (...options: string[]) =>
      spawnSync(process.execPath, [script, 'selected', base, head, ...options], {
        cwd: dir,
        encoding: 'utf8',
      });
    const expectParityFailure = () => {
      const result = check('--check-committed');
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /^Failed game checks: Standalone parity$/m);
    };
    const matching = check('--check-committed');
    assert.equal(matching.status, 0, matching.stderr);
    assert.match(matching.stdout, /Standalone parity: passed/);
    writeFileSync(join(dir, 'generated.html'), 'standalone\r\n');
    writeFileSync(join(dir, 'play.html'), 'standalone\r\n');
    git('add', 'play.html');
    const local = check();
    assert.equal(local.status, 0, local.stderr);
    assert.match(local.stdout, /^Distribution: passed$/m);
    expectParityFailure();
    git('restore', '--source=HEAD', '--staged', '--worktree', 'play.html');
    writeFileSync(join(dir, 'generated.html'), 'standalone\n');
    git('rm', '-q', 'play.html');
    git('commit', '-qm', 'delete standalone');
    writeFileSync(join(dir, 'play.html'), 'standalone\n');
    expectParityFailure();
    if (process.platform !== 'win32') {
      rmSync(join(dir, 'play.html'));
      writeFileSync(join(dir, 'target.html'), 'standalone\n');
      symlinkSync('target.html', join(dir, 'play.html'));
      git('add', 'play.html', 'target.html');
      git('commit', '-qm', 'link standalone');
      expectParityFailure();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
