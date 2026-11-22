import { execFileSync } from 'node:child_process';
import { appendFileSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

declare const Bun: { JSONC: { parse(text: string): unknown } };

const fullChecks = { types: true, simulation: true, browser: true, distribution: true, deployment: true };

// Resolver configs can redirect imports without appearing in Bun's metafile.
const resolverConfig = /(?:^|\/)(?:package|[jt]sconfig(?:\.[^/]+)?)\.json$/;
const documentedInputs = /^(?:[^/]+\.md|docs\/.*\.md|docs\/screenshots\/[^/]+\.(?:png|jpg|webp))$/;
const appEntries = /^(?:index\.html|favicon\.svg|vite\.config\.[cm]?[jt]s|\.gitattributes)$/;
const sharedPlaywrightConfig = /^playwright\.config\.[cm]?[jt]s$/;
const ownedInputs = [
  appEntries,
  sharedPlaywrightConfig,
  /^(?:LICENSE|play\.html|playwright\.distribution\.config\.ts)$/,
  /^src\/(?:audio|engine|env\.d|levels|main|renderer|types)\.ts$|^src\/style\.css$|^public\//,
  /^tests\/(?:engine\.test|browser\.spec|distribution\.spec|deploy\.test|ci\.test)\.ts$/,
  /^scripts\/(?:ci|deploy|standalone|pullfrog-command-check(?:\.test)?|pullfrog-review-check)\.ts$/,
  /^\.github\/workflows\/deploy\.yml$/,
];

function inheritedResolverChanged(paths: string[]) {
  if (paths.length === 0) return false;
  try {
    const root = realpathSync('.');
    const changed = new Set(paths.map((path) => resolve(root, path)));
    const configs = execFileSync(
      'git',
      ['ls-files', '-z', '--', ':(glob)**/tsconfig.json', ':(glob)**/jsconfig.json'],
      { encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean)
      .map((path) => resolve(root, path));
    const seen = new Set<string>();
    for (let config = configs.pop(); config; config = configs.pop()) {
      if (changed.has(config)) return true;
      if (seen.has(config)) continue;
      seen.add(config);
      // A symlink in the config path can redirect resolution without changing the config itself.
      if (!config.startsWith(join(root, sep)) || realpathSync(config) !== config) return true;
      const { extends: parent } = Bun.JSONC.parse(readFileSync(config, 'utf8')) as { extends?: unknown };
      if (parent === undefined) continue;
      // Follow local inheritance. Other forms may involve resolution outside this checkout.
      if (typeof parent !== 'string' || !/^\.\.?[\\/]/.test(parent)) return true;
      configs.push(resolve(dirname(config), parent));
    }
    return false;
  } catch {
    // An incomplete config chain cannot prove the change is unrelated to resolution.
    return true;
  }
}

function simulationImports(paths: string[]) {
  if (paths.length === 0) return false;
  try {
    // A changed link can redirect an import to a fallback that bypasses the link in the head graph.
    if (paths.some((path) => lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink())) return true;
    const directory = mkdtempSync(join(tmpdir(), 'neon-simulation-'));
    try {
      const metadata = join(directory, 'bundle.json');
      // Unresolved computed imports can hide inputs from the metafile.
      execFileSync(
        process.execPath,
        [
          'build',
          '--target=bun',
          '--packages=external',
          '--reject-unresolved',
          `--metafile=${metadata}`,
          'tests/engine.test.ts',
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      const graph: { inputs: Record<string, { imports: { path: string; external?: boolean }[] }> } =
        JSON.parse(readFileSync(metadata, 'utf8'));
      for (const { imports } of Object.values(graph.inputs)) {
        if (imports.some((entry) => entry.external && !isBuiltin(entry.path))) return true;
      }
      return paths.some((path) => Object.hasOwn(graph.inputs, path));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  } catch (error) {
    console.warn('Simulation dependency analysis failed; running the simulation suite.', error);
    return true;
  }
}

export function checksFor(paths: string[], hasDeletionOrTypeChange = false) {
  if (
    paths.some(
      (path) =>
        path === 'AGENTS.md' ||
        resolverConfig.test(path) ||
        (!documentedInputs.test(path) && !ownedInputs.some((pattern) => pattern.test(path))),
    ) ||
    inheritedResolverChanged(paths)
  )
    return fullChecks;
  const app = paths.some((path) => /^(src|public)\//.test(path) || appEntries.test(path));
  const playwrightConfig = paths.some((path) => sharedPlaywrightConfig.test(path));
  return {
    types: paths.some((path) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)),
    // Deleting a path or changing its file type can redirect an import to an unchanged fallback.
    simulation:
      hasDeletionOrTypeChange ||
      paths.includes('src/types.ts') ||
      paths.includes('tests/engine.test.ts') ||
      simulationImports(paths),
    browser: app || playwrightConfig || paths.some((path) => path === 'tests/browser.spec.ts'),
    distribution:
      app ||
      playwrightConfig ||
      paths.some((path) =>
        /^(scripts\/standalone\.ts|playwright\.distribution\.config\.ts|LICENSE|play\.html|tests\/distribution\.spec\.ts)$/.test(
          path,
        ),
      ),
    deployment: paths.some((path) =>
      /^(scripts\/deploy\.ts|tests\/deploy\.test\.ts|\.github\/workflows\/deploy\.yml)$/.test(path),
    ),
  };
}

// No API token or dependencies: works with fork PRs, deletions and large diffs.
// Disabling rename detection includes both old and new paths when a file moves.
function changesBetween(base: string, head: string) {
  const start = execFileSync('git', ['merge-base', base, head], { encoding: 'utf8' }).trim();
  const entries = execFileSync('git', ['diff', '--no-renames', '--name-status', '-z', start, head], {
    encoding: 'utf8',
  }).split('\0');
  const paths: string[] = [];
  let hasDeletionOrTypeChange = false;
  for (let index = 0; index + 1 < entries.length; index += 2) {
    paths.push(entries[index + 1]);
    if (entries[index] === 'D' || entries[index] === 'T') hasDeletionOrTypeChange = true;
  }
  return { paths, hasDeletionOrTypeChange };
}

export function validationChecks(mode: string, base: string, head: string) {
  if (mode === 'full') return fullChecks;
  if (mode === 'selected' && base && head) {
    const { paths, hasDeletionOrTypeChange } = changesBetween(base, head);
    return checksFor(paths, hasDeletionOrTypeChange);
  }
  throw new Error('Expected full validation or selected validation with base and head SHAs');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [base, head] = process.argv.slice(2);
  const checks = validationChecks('selected', base, head);
  const output =
    Object.entries(checks)
      .map(([name, run]) => `${name}=${run}`)
      .join('\n') + '\n';
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  process.stdout.write(output);
}
