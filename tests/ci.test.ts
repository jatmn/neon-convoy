import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validationChecks } from '../scripts/ci.ts';

const ownedNone = { types: false, browser: false, distribution: false, deployment: false };
const ownedGame = { ...ownedNone, types: true, browser: true, distribution: true };
const none = { ...ownedNone, simulation: false };
const game = { ...ownedGame, simulation: true };
const all = { ...game, deployment: true };
const selector = new URL('../scripts/ci.ts', import.meta.url);

let ownershipFixture: string;
before(() => {
  ownershipFixture = mkdtempSync(join(tmpdir(), 'neon-ownership-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: ownershipFixture });
  git('init', '-q');
  mkdirSync(join(ownershipFixture, 'src'));
  mkdirSync(join(ownershipFixture, 'tests'));
  writeFileSync(join(ownershipFixture, 'tsconfig.json'), '{}');
  writeFileSync(join(ownershipFixture, 'src/levels.ts'), 'export const cellSize = 4;');
  writeFileSync(join(ownershipFixture, 'src/engine.ts'), 'export { cellSize } from "./levels.ts";');
  writeFileSync(
    join(ownershipFixture, 'tests/engine.test.ts'),
    'import { cellSize } from "../src/engine.ts"; console.log(cellSize);',
  );
  git('add', '.');
});
after(() => {
  if (ownershipFixture) rmSync(ownershipFixture, { recursive: true, force: true });
});

function fixtureChecks(paths: string[]) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        '-e',
        'const { checksFor } = await import(process.argv[1]); console.log(JSON.stringify(checksFor(process.argv.slice(2))));',
        selector.href,
        ...paths,
      ],
      { cwd: ownershipFixture, encoding: 'utf8' },
    ),
  );
}

function assertOwnedChecks(paths: string[], expected: typeof ownedNone) {
  assert.deepEqual(fixtureChecks(paths), { ...expected, simulation: false }, paths.join(', '));
}

void test('documentation and screenshots have no owned checks', () => {
  assertOwnedChecks(['README.md', 'docs/validation.md', 'docs/screenshots/mobile.png'], ownedNone);
  assert.deepEqual(fixtureChecks([]), none);
});

void test('shared tooling and unclassified paths validate every surface', () => {
  for (const path of [
    'package.json',
    'bun.lock',
    'bunfig.toml',
    'scripts/install-bun.sh',
    'tsconfig.json',
    'public/terrain/tsconfig.json',
    'public/terrain/tsconfig.paths.json',
    'public/terrain/jsconfig.json',
    '.github/workflows/check.yml',
    '.oxlintrc.json',
    '.oxlintrc.native.json',
    'AGENTS.md',
    'fixtures/new-module.ts',
    'docs/executable.ts',
    'scripts/helper.mjs',
    'src/helper.js',
  ]) {
    assert.deepEqual(fixtureChecks([path]), all, path);
  }
});

void test('core simulation sources select simulation, browser and distribution checks', () => {
  for (const path of ['src/engine.ts', 'src/levels.ts', 'src/types.ts']) {
    assert.deepEqual(fixtureChecks([path]), game, path);
  }
  assert.deepEqual(fixtureChecks(['tests/engine.test.ts']), { ...none, types: true, simulation: true });
});

void test('UI and assets exercise browser and distribution', () => {
  for (const path of ['src/main.ts', 'src/audio.ts', 'src/renderer.ts']) {
    assertOwnedChecks([path], ownedGame);
  }
  for (const path of ['src/style.css', 'index.html', 'favicon.svg', '.gitattributes', 'public/texture.png']) {
    assertOwnedChecks([path], { ...ownedNone, browser: true, distribution: true });
  }
});

void test('auto-discovered Vite and shared Playwright configs exercise browser and distribution', () => {
  for (const name of ['vite', 'playwright']) {
    for (const extension of ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs']) {
      const path = `${name}.config.${extension}`;
      assertOwnedChecks([path], ownedGame);
    }
  }
});

void test('test and packaging changes select their owned checks', () => {
  assertOwnedChecks(['tests/browser.spec.ts'], { ...ownedNone, types: true, browser: true });
  for (const path of [
    'scripts/standalone.ts',
    'tests/distribution.spec.ts',
    'playwright.distribution.config.ts',
  ]) {
    assertOwnedChecks([path], { ...ownedNone, types: true, distribution: true });
  }
  for (const path of ['LICENSE', 'play.html'])
    assertOwnedChecks([path], { ...ownedNone, distribution: true });
  assert.deepEqual(fixtureChecks(['tests/engine.test.ts', 'play.html']), {
    ...none,
    types: true,
    simulation: true,
    distribution: true,
  });
});

void test('deployment and routing changes select their owned checks', () => {
  for (const path of ['scripts/deploy.ts', 'tests/deploy.test.ts']) {
    assertOwnedChecks([path], { ...ownedNone, types: true, deployment: true });
  }
  assertOwnedChecks(['.github/workflows/deploy.yml'], { ...ownedNone, deployment: true });
  for (const path of ['scripts/ci.ts', 'tests/ci.test.ts'])
    assertOwnedChecks([path], { ...ownedNone, types: true });
});

void test('CI entry point handles PR base divergence, deletions, renames and full validation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neon-ci-'));
  const script = fileURLToPath(selector);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  const commit = () => {
    git('add', '.');
    git('commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  const run = (base: string, head: string, temporaryDirectory = tmpdir()) => {
    const output = join(dir, 'outputs');
    writeFileSync(output, '');
    const { status, stdout, stderr } = spawnSync(process.execPath, [script, base, head], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_OUTPUT: output,
        TMPDIR: temporaryDirectory,
        TMP: temporaryDirectory,
        TEMP: temporaryDirectory,
      },
    });
    assert.equal(status, 0, stderr);
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
    mkdirSync(join(dir, 'tests'));
    writeFileSync(join(dir, 'tests/engine.test.ts'), 'console.log("simulation");');
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
    assert.deepEqual(
      run(docs, renamed),
      { ...none, simulation: true, distribution: true },
      'the removed path of a rename selects its checks and may affect simulation resolution',
    );
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
    writeFileSync(join(dir, 'src/audio.ts'), 'export const cellSize = 4;');
    const unlinked = commit();
    writeFileSync(join(dir, 'src/audio.ts'), 'export const cellSize = 5;');
    assert.deepEqual(
      run(unlinked, commit()),
      { ...game, simulation: false },
      'an independent file does not select simulation',
    );
    writeFileSync(
      join(dir, 'tests/engine.test.ts'),
      'import { cellSize } from "../src/engine.ts"; console.log(cellSize);',
    );
    writeFileSync(join(dir, 'src/engine.ts'), 'export { cellSize } from "./audio.ts";');
    const linked = commit();
    writeFileSync(join(dir, 'src/audio.ts'), 'export const cellSize = 8;');
    const changedSource = commit();
    assert.deepEqual(run(linked, changedSource), game, 'a transitive source change selects simulation');
    assert.deepEqual(
      run(linked, changedSource, join(dir, 'missing-tmpdir')),
      game,
      'unavailable scratch space selects simulation',
    );

    mkdirSync(join(dir, 'public'));
    writeFileSync(join(dir, 'public/terrain.json'), '{"cellSize":4}');
    writeFileSync(
      join(dir, 'src/engine.ts'),
      'import terrain from "../public/terrain.json"; export const cellSize = terrain.cellSize;',
    );
    const terrain = commit();
    writeFileSync(join(dir, 'public/terrain.json'), '{"cellSize":8}');
    assert.deepEqual(
      run(terrain, commit()),
      { ...game, types: false },
      'changing only a transitive JSON input selects simulation',
    );

    const terrainPackage = join(dir, 'public/terrain-package');
    mkdirSync(terrainPackage);
    writeFileSync(join(terrainPackage, 'v1.json'), '{"cellSize":4}');
    writeFileSync(join(terrainPackage, 'v2.json'), '{"cellSize":8}');
    const manifest = join(terrainPackage, 'package.json');
    writeFileSync(manifest, '{"main":"./v1.json"}');
    writeFileSync(
      join(dir, 'src/engine.ts'),
      'import terrain from "../public/terrain-package"; export const cellSize = terrain.cellSize;',
    );
    const beforeManifest = commit();
    writeFileSync(manifest, '{"main":"./v2.json"}');
    assert.deepEqual(run(beforeManifest, commit()), all, 'a nested manifest can redirect a simulation input');

    writeFileSync(join(dir, 'src/levels.ts'), 'export const cellSize = 4;');
    writeFileSync(join(dir, 'src/engine.ts'), 'export { cellSize } from "@terrain";');
    writeFileSync(join(dir, 'tsconfig.json'), '{"extends":"./public/terrain-package/shared.json"}');
    writeFileSync(join(terrainPackage, 'shared.json'), '{"extends":"./base.json"}');
    const inheritedConfig = join(terrainPackage, 'base.json');
    writeFileSync(inheritedConfig, '{"compilerOptions":{"paths":{"@terrain":["../../src/audio.ts"]}}}');
    const beforeConfig = commit();
    writeFileSync(
      inheritedConfig,
      '// Prefer the primary level data.\n' +
        '{"compilerOptions":{"paths":{"@terrain":["../../src/levels.ts","../../src/audio.ts"]}}}',
    );
    const redirected = commit();
    assert.deepEqual(
      run(beforeConfig, redirected),
      all,
      'an inherited config alone can redirect a simulation input',
    );
    writeFileSync(join(dir, 'README.md'), 'document the inherited config');
    const unrelated = commit();
    assert.deepEqual(
      run(redirected, unrelated),
      none,
      'unchanged inheritance does not broaden unrelated checks',
    );
    git('rm', 'src/levels.ts');
    assert.deepEqual(
      run(unrelated, commit()),
      game,
      'a deleted alias target can redirect to an unchanged input',
    );

    if (process.platform !== 'win32') {
      writeFileSync(join(dir, 'src/levels-v1.ts'), 'export const cellSize = 4;');
      writeFileSync(join(dir, 'src/levels-v2.ts'), 'export const cellSize = 8;');
      const link = join(dir, 'src/levels.ts');
      symlinkSync('levels-v1.ts', link);
      writeFileSync(join(dir, 'src/engine.ts'), 'export { cellSize } from "./levels.ts";');
      const beforeRetarget = commit();
      rmSync(link);
      symlinkSync('levels-v2.ts', link);
      assert.deepEqual(run(beforeRetarget, commit()), game, 'retargeting a changed link selects simulation');

      mkdirSync(join(dir, 'public/v1'));
      mkdirSync(join(dir, 'public/v2'));
      writeFileSync(join(dir, 'public/v1/terrain.json'), '{"cellSize":4}');
      symlinkSync('../terrain.json', join(dir, 'public/v2/terrain.json'));
      const directoryLink = join(dir, 'public/active');
      symlinkSync('v1', directoryLink, 'dir');
      writeFileSync(
        join(dir, 'src/engine.ts'),
        'import terrain from "../public/active/terrain.json"; export const cellSize = terrain.cellSize;',
      );
      const beforeDirectoryRetarget = commit();
      rmSync(directoryLink);
      symlinkSync('v2', directoryLink, 'dir');
      assert.deepEqual(
        run(beforeDirectoryRetarget, commit()),
        { ...game, types: false },
        'retargeting a directory link selects simulation even if a nested link resolves outside the directory',
      );

      writeFileSync(
        join(dir, 'tsconfig.json'),
        '{"compilerOptions":{"paths":{"@terrain":["./public/active/terrain.json","./public/v1/terrain.json"]}}}',
      );
      writeFileSync(
        join(dir, 'src/engine.ts'),
        'import terrain from "@terrain"; export const cellSize = terrain.cellSize;',
      );
      symlinkSync('terrain.json', join(dir, 'public/terrain-file'));
      const beforeTypeChange = commit();
      rmSync(directoryLink);
      symlinkSync('terrain-file', directoryLink);
      assert.deepEqual(
        run(beforeTypeChange, commit()),
        { ...game, types: false },
        'retargeting a directory link to a file through another link can redirect an import to a fallback',
      );
      rmSync(directoryLink);
      writeFileSync(directoryLink, 'regular file');
      assert.deepEqual(
        run(beforeTypeChange, commit()),
        { ...game, types: false },
        'replacing a directory link with a file can redirect an import to an unchanged fallback',
      );
    }

    writeFileSync(
      join(dir, 'src/engine.ts'),
      'export const loadTerrain = (path: string) => import /* runtime-loaded fixture */ (path);',
    );
    writeFileSync(
      join(dir, 'tests/engine.test.ts'),
      'import { loadTerrain } from "../src/engine.ts"; console.log((await loadTerrain("../public/terrain.json")).default.cellSize);',
    );
    const computedImport = commit();
    writeFileSync(join(dir, 'public/terrain.json'), '{"cellSize":16}');
    assert.deepEqual(
      run(computedImport, commit()),
      { ...game, types: false },
      'an edit to a runtime-loaded asset selects simulation when Bun cannot resolve its computed import',
    );

    writeFileSync(join(dir, 'tsconfig.json'), '{"extends":["./public/terrain-package/shared.json"]}');
    const unsupportedInheritance = commit();
    writeFileSync(join(dir, 'README.md'), 'documentation');
    assert.deepEqual(
      run(unsupportedInheritance, commit()),
      all,
      'unsupported resolver inheritance selects all checks for an otherwise unrelated edit',
    );
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
          env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GAME_CHECK_STARTED_MS: '' },
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
          env: {
            ...process.env,
            PATH: `${dir}:${process.env.PATH}`,
            INSTALL_STATUS: status,
            GAME_CHECK_STARTED_MS: '',
          },
        },
      );
    try {
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'CI fixture');
      git('config', 'user.email', 'ci@example.invalid');
      mkdirSync(join(dir, 'tests'));
      writeFileSync(join(dir, 'tests/engine.test.ts'), 'console.log("simulation");');
      git('add', 'tests/engine.test.ts');
      git('commit', '-qm', 'root');
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
      assert.match(docs.stdout, /^Unit tests: passed in \d+ ms$/m);
      assert.match(docs.stdout, /^Format: passed in \d+ ms$/m);
      assert.throws(() => readFileSync(join(dir, 'installs')), { code: 'ENOENT' });

      const types = run('0', 'selected', 'HEAD~1', 'HEAD');
      assert.equal(types.status, 0, types.stderr);
      assert.match(types.stdout, /^TypeScript: passed in \d+ ms$/m);
      assert.match(types.stdout, /^Test lint: passed in \d+ ms$/m);
      assert.match(types.stdout, /^Native lint: passed in \d+ ms$/m);
      assert.equal(readFileSync(join(dir, 'installs'), 'utf8'), 'install\n');

      const failed = run('1', 'full', '', '');
      assert.equal(failed.status, 1, failed.stderr);
      assert.match(failed.stdout, /^Unit tests: passed in \d+ ms$/m);
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
  'elapsed check budgets apply only when the workflow supplies its clock',
  { skip: process.platform === 'win32' },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'neon-budget-'));
    const script = fileURLToPath(new URL('../scripts/verify.ts', import.meta.url));
    const budgetLog = join(dir, 'budget.log');
    const outputLog = join(dir, 'output.log');
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      writeFileSync(
        join(dir, 'bun'),
        `#!/bin/sh
set -e
wait_for_report() {
  attempts=0
  while [ "$attempts" -lt 50 ]; do
    if grep -q "$1" "$2"; then return 0; fi
    attempts=$((attempts + 1))
    sleep 0.05
  done
  return 9
}
case "$1:$2:$TIMING_FIXTURE" in
  test:--isolate:*)
    echo '{"files":{}}' > "$NEON_TEST_TIMINGS_DIRECTORY/unit.json"
    echo '<testsuites skipped="0"></testsuites>' > "$NEON_TEST_TIMINGS_DIRECTORY/unit-junit.xml"
    ;;
  run:test:browser:*|run:test:distribution:*)
    echo '{"suites":[],"stats":{}}' > "$NEON_TEST_TIMINGS_DIRECTORY/\${2#test:}.json"
    ;;
  fmt:--check:slow) sleep 1.1 ;;
  fmt:--check:stall)
    wait_for_report '^Format: failed (budget 1000 ms)' "$BUDGET_LOG"
    echo "Formatter saw budget failure before exiting"
    ;;
  install:--frozen-lockfile:dependencies|--bun:playwright:chromium)
    wait_for_report '^Setup budget: failed' "$OUTPUT_LOG"
    echo "Installer saw budget failure before exiting"
    ;;
  --bun:playwright:install-error) exit 9 ;;
esac
`,
        { mode: 0o755 },
      );
      const run = (started: string, fixture: string, ...options: string[]) => {
        const stdout = openSync(outputLog, 'w');
        const stderr = openSync(budgetLog, 'w');
        try {
          const result = spawnSync(process.execPath, [script, 'full', '', '', ...options], {
            cwd: dir,
            encoding: 'utf8',
            stdio: ['ignore', stdout, stderr],
            timeout: 5_000,
            env: {
              ...process.env,
              PATH: `${dir}:${process.env.PATH}`,
              CI: '1',
              GAME_CHECK_STARTED_MS: started,
              TIMING_FIXTURE: fixture,
              BUDGET_LOG: budgetLog,
              OUTPUT_LOG: outputLog,
            },
          });
          assert.ifError(result.error);
          return {
            status: result.status,
            stdout: readFileSync(outputLog, 'utf8'),
            stderr: readFileSync(budgetLog, 'utf8'),
          };
        } finally {
          closeSync(stdout);
          closeSync(stderr);
        }
      };
      const local = run('', 'slow');
      assert.equal(local.status, 0, local.stderr);
      assert.match(local.stdout, /^Format: passed in \d+ ms$/m);
      assert.match(local.stdout, /^Test inventory: passed in \d+ ms$/m);
      const hosted = run(String(Date.now()), 'stall');
      assert.equal(hosted.status, 1, hosted.stderr);
      assert.match(hosted.stderr, /^Format: failed \(budget 1000 ms\) in \d+ ms$/m);
      assert.match(hosted.stdout, /^Formatter saw budget failure before exiting$/m);
      assert.match(hosted.stderr, /^Failed game checks: Format$/m);
      assert.match(hosted.stdout, /^Setup budget: passed/m);
      assert.match(hosted.stdout, /^Browser controls: passed/m);
      assert.match(hosted.stdout, /^Distribution: passed/m);

      const expired = run(String(Date.now() - 15_000), 'quick', '--install-chromium');
      assert.equal(expired.status, 1, expired.stderr);
      assert.match(expired.stdout, /^Setup budget: failed/m);
      assert.match(expired.stdout, /^Unit tests: passed/m);
      assert.match(expired.stdout, /^Production build: passed/m);
      assert.doesNotMatch(expired.stdout, /^(Chromium setup|Browser controls|Distribution): started$/m);
      assert.match(expired.stderr, /^Blocked game checks: Chromium setup, Browser controls, Distribution$/m);

      for (const installer of ['dependencies', 'chromium']) {
        const pending = run(
          String(Date.now() - 14_500),
          installer,
          '--install-dependencies',
          '--install-chromium',
        );
        assert.equal(pending.status, 1, pending.stderr);
        assert.match(pending.stdout, /^Setup budget: failed in \d+ ms \(limit 15000 ms\)$/m);
        assert.match(pending.stdout, /^Installer saw budget failure before exiting$/m);
        assert.match(pending.stdout, /^Unit tests: passed/m);
        assert.match(pending.stdout, /^Production build: passed/m);
        assert.doesNotMatch(pending.stdout, /^(Browser controls|Distribution): started$/m);
        assert.match(pending.stderr, /^Failed game checks: Setup budget$/m);
        if (installer === 'dependencies') {
          assert.doesNotMatch(pending.stdout, /^Chromium setup: started$/m);
          assert.match(
            pending.stderr,
            /^Blocked game checks: Chromium setup, Browser controls, Distribution$/m,
          );
        } else {
          assert.match(pending.stdout, /^Chromium setup: started$/m);
          assert.match(pending.stderr, /^Blocked game checks: Browser controls, Distribution$/m);
        }
      }

      const installError = run(String(Date.now()), 'install-error', '--install-chromium');
      assert.equal(installError.status, 1, installError.stderr);
      assert.doesNotMatch(installError.stdout, /^Setup budget:/m);
      assert.match(installError.stderr, /^Failed game checks: Chromium setup$/m);
      assert.match(
        installError.stderr,
        /^Blocked game checks: Setup budget, Browser controls, Distribution$/m,
      );
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
    const startClock = step('Start job timing lookup');
    const lookup = step('Detect the main merge queue');
    const verify = step('Run game checks');
    const enforce = step('Enforce elapsed validation budget');
    assert.ok(
      workflow.indexOf('- name: Enforce elapsed validation budget') <
        workflow.indexOf('actions/upload-artifact@'),
    );
    assert.match(lookup.configuration, /GH_TOKEN:/);
    assert.match(verify.configuration, /QUEUE_ACTIVE: \$\{\{ steps\.queue\.outputs\.active \}\}/);
    assert.doesNotMatch(verify.configuration, /GH_TOKEN|github\.token/);
    try {
      writeFileSync(
        join(dir, 'gh'),
        `#!/bin/sh
if [ "$1:$2" = "api:repos/fixture/game/actions/runs/23/attempts/1/jobs" ]; then
  [ "$3" = --jq ] && [ "$4" = '.jobs[] | select(.name == "Game checks") | .started_at' ] || exit 2
  if [ "$CLOCK_API" = error ]; then
    echo "clock API failed" >&2
    exit 1
  fi
  if [ "$CLOCK_API" = transient ] || [ "$CLOCK_API" = missing ] || [ "$CLOCK_API" = stalled ]; then
    if [ ! -f "$RUNNER_TEMP/first-clock-attempt" ]; then
      touch "$RUNNER_TEMP/first-clock-attempt"
      if [ "$CLOCK_API" = transient ]; then exit 1; fi
      if [ "$CLOCK_API" = stalled ]; then exec "$TEST_BUN" -e 'await Bun.sleep(5000)'; fi
      exit 0
    fi
  fi
  attempts=0
  while [ ! -f "$RUNNER_TEMP/release-clock" ] && [ "$attempts" -lt 100 ]; do
    command -p sleep 0.01
    attempts=$((attempts + 1))
  done
  [ -f "$RUNNER_TEMP/release-clock" ] || exit 2
  echo "1970-01-01T00:01:39Z"
  exit 0
fi
[ "$#" = 5 ] && [ "$1" = api ] && [ "$2" = repos/fixture/game/rules/branches/main ] &&
  [ "$3" = --paginate ] && [ "$4" = --jq ] && [ "$5" = '.[] | select(.type == "merge_queue") | .type' ] || exit 2
[ "$API_RULES" != error ] || exit 1
if [ "$API_RULES" = stalled ]; then exec "$TEST_BUN" -e 'await Bun.sleep(5000)'; fi
"$TEST_BUN" -e 'for (const rule of JSON.parse(process.env.API_RULES)) if (rule.type === "merge_queue") console.log(rule.type)'
`,
        { mode: 0o755 },
      );
      mkdirSync(join(dir, 'scripts'));
      writeFileSync(
        join(dir, 'scripts', 'install-bun.sh'),
        `#!/bin/sh
if [ "$BUN_BOOTSTRAP" = stalled ]; then
  echo 'Pinned Bun installation started'
  exec "$TEST_BUN" -e 'await Bun.sleep(5000)'
fi
if [ -n "$AFTER_BUN_NOW" ]; then echo "$AFTER_BUN_NOW" > "$RUNNER_TEMP/after-bun-time"; fi
exit "\${BUN_BOOTSTRAP:-0}"
`,
      );
      mkdirSync(join(dir, 'neon-bun'));
      writeFileSync(
        join(dir, 'neon-bun', 'bun'),
        `#!/bin/sh
[ "$1 $3 $4 $5 $6 $7" = "scripts/verify.ts base head --install-dependencies --install-chromium --check-committed" ] || exit 2
[ "$GAME_CHECK_STARTED_MS:$GAME_CHECK_DEADLINE_MS" = "99000:132000" ] || exit 2
printf "%s\\n" "$2"
`,
        { mode: 0o755 },
      );
      writeFileSync(
        join(dir, 'date'),
        `#!/bin/sh
if [ "$1" = "-u" ]; then
  [ "$*" = '-u -d 1970-01-01T00:01:39Z +%s%3N' ] || exit 2
  echo 99000
else
  if [ -n "$RUNNER_TEMP" ] && [ -f "$RUNNER_TEMP/after-bun-time" ]; then
    cat "$RUNNER_TEMP/after-bun-time"
  else
    echo "\${MOCK_NOW:-100000}"
  fi
fi
`,
        { mode: 0o755 },
      );
      writeFileSync(
        join(dir, 'sleep'),
        `#!/bin/sh
case "$1" in
  0.1) touch "$RUNNER_TEMP/release-clock"; command -p sleep 0.02 ;;
  0.25) command -p sleep 0.02 ;;
  *) exit 2 ;;
esac
`,
        { mode: 0o755 },
      );
      writeFileSync(
        join(dir, 'timeout'),
        `#!/bin/sh
case "$1 $2 $3 $4" in
  "--kill-after=1s 32.000s bun scripts/verify.ts") shift 2; exec "$@" ;;
  "--kill-after=1s 14.000s bash scripts/install-bun.sh") shift 2; milliseconds=200 ;;
  "--kill-after=1s 14s bash -c") shift 2; milliseconds=900 ;;
  "--kill-after=1s 3s gh api") shift 2; milliseconds=200 ;;
  "--foreground --kill-after=1s 3s gh") shift 3; milliseconds=200 ;;
  *) exit 2 ;;
esac
FIXTURE_TIMEOUT="$milliseconds" exec "$TEST_BUN" -e 'const child = Bun.spawn(process.argv.slice(1), { stdout: "inherit", stderr: "inherit", timeout: Number(process.env.FIXTURE_TIMEOUT) }); const status = await child.exited; process.exit(child.signalCode ? 124 : status);' "$@"
`,
        { mode: 0o755 },
      );
      const output = join(dir, 'outputs');
      const run = (command: string, env: Record<string, string>, expectedStatus = 0) => {
        writeFileSync(output, '');
        const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', command], {
          cwd: dir,
          encoding: 'utf8',
          timeout: 5000,
          env: {
            PATH: `${dir}:${process.env.PATH}`,
            GITHUB_OUTPUT: output,
            TMPDIR: dir,
            TMP: dir,
            TEMP: dir,
            ...env,
          },
        });
        assert.equal(result.status, expectedStatus, result.stderr);
        return { output: readFileSync(output, 'utf8').trim(), stdout: result.stdout.trim() };
      };
      writeFileSync(join(dir, 'game-check-start'), '99000\n');
      const verifyEnv = (queue: string) => ({
        QUEUE_ACTIVE: queue.replace(/^active=/, ''),
        BASE_SHA: 'base',
        HEAD_SHA: 'head',
        RUNNER_TEMP: dir,
        TEST_BUN: process.execPath,
      });
      const mode = (queue: string) => run(verify.command, verifyEnv(queue)).stdout;
      for (const [rules, expected] of [
        ['[{"type":"required_status_checks"},{"type":"merge_queue"}]', 'selected'],
        ['[{"type":"required_status_checks"}]', 'full'],
        ['error', 'full'],
        ['stalled', 'full'],
      ]) {
        const queue = run(lookup.command, {
          GH_REPO: 'fixture/game',
          API_RULES: rules,
          TEST_BUN: process.execPath,
        });
        assert.equal(mode(queue.output), expected, rules);
      }
      assert.equal(mode(''), 'full', 'events that skip lookup run every check');

      const clockEnv = {
        RUNNER_TEMP: dir,
        GITHUB_REPOSITORY: 'fixture/game',
        GITHUB_RUN_ID: '23',
        GITHUB_RUN_ATTEMPT: '1',
        TEST_BUN: process.execPath,
      };
      rmSync(join(dir, 'game-check-start'));
      run(startClock.command, clockEnv);
      assert.equal(mode('active=true'), 'selected', 'a timestamp arriving during the wait is accepted');

      for (const clockApi of ['transient', 'missing', 'stalled']) {
        rmSync(join(dir, 'game-check-start'));
        run(startClock.command, { ...clockEnv, CLOCK_API: clockApi });
        assert.equal(mode(''), 'full', `verification recovers after a ${clockApi} first clock response`);
        rmSync(join(dir, 'first-clock-attempt'));
      }

      rmSync(join(dir, 'game-check-start'));
      run(startClock.command, { ...clockEnv, CLOCK_API: 'error' });
      const failed = run(verify.command, verifyEnv(''), 1);
      assert.match(failed.stdout, /clock API failed/);
      assert.match(failed.stdout, /GitHub job start time is unavailable/);

      rmSync(join(dir, 'game-check-start.failed'));
      const expired = run(verify.command, { ...verifyEnv(''), MOCK_NOW: '115000' }, 1);
      assert.match(expired.stdout, /GitHub job start time is unavailable/);

      const enforceEnv = { RUNNER_TEMP: dir, GITHUB_STEP_SUMMARY: output, CHECKOUT_OUTCOME: 'success' };
      assert.equal(run(enforce.command, enforceEnv).output, '');
      writeFileSync(join(dir, 'game-check-start'), '99000\n');
      assert.match(
        run(enforce.command, enforceEnv).output,
        /runner elapsed before artifact handling: 1000 ms/,
      );
      const belowBudget = run(enforce.command, { ...enforceEnv, MOCK_NOW: '131999' });
      assert.match(belowBudget.output, /runner elapsed before artifact handling: 32999 ms/);
      const overBudget = run(enforce.command, { ...enforceEnv, MOCK_NOW: '132000' }, 1);
      assert.match(
        overBudget.output,
        /runner elapsed before artifact handling: 33000 ms \(33000 ms validation cutoff\)/,
      );
      const cutoffMessage = /reached the 33 s validation cutoff\./;
      assert.match(overBudget.stdout, cutoffMessage);
      const checkoutOverrun = run(
        enforce.command,
        { ...enforceEnv, MOCK_NOW: '114000', CHECKOUT_OUTCOME: 'failure' },
        1,
      );
      assert.match(checkoutOverrun.stdout, /Setup budget: checkout failed after the 15000 ms limit/);
      const setupMessage = /Setup budget: failed before verification \(15000 ms limit\)\./;
      const expiredCheckout = run(verify.command, { ...verifyEnv(''), MOCK_NOW: '114000' }, 1);
      assert.match(expiredCheckout.stdout, setupMessage);
      const stalledBootstrap = run(verify.command, { ...verifyEnv(''), BUN_BOOTSTRAP: 'stalled' }, 124);
      assert.match(stalledBootstrap.stdout, /Pinned Bun installation started/);
      assert.match(stalledBootstrap.stdout, setupMessage);
      const failedBootstrap = run(verify.command, { ...verifyEnv(''), BUN_BOOTSTRAP: '9' }, 9);
      assert.doesNotMatch(failedBootstrap.stdout, setupMessage);
      assert.match(
        run(verify.command, { ...verifyEnv(''), AFTER_BUN_NOW: '132000' }, 1).stdout,
        cutoffMessage,
      );
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
    mkdirSync(join(dir, 'tests'));
    mkdirSync(join(dir, 'scripts'));
    for (const file of [
      'tests/ci.test.ts',
      'tests/engine.test.ts',
      'scripts/pullfrog-command-check.test.ts',
    ]) {
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
        env: { ...process.env, GAME_CHECK_STARTED_MS: '' },
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
    assert.match(local.stdout, /^Distribution: passed in \d+ ms$/m);
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
