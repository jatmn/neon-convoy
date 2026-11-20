import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function checksFor(paths: string[]) {
  const shared = paths.some(path => /^(package(-lock)?\.json|tsconfig[^/]*\.json|scripts\/verify\.ts|\.github\/workflows\/check\.yml)$/.test(path));
  const app = paths.some(path => /^(src|public)\//.test(path) || /^(index\.html|favicon\.svg|vite\.config\.[cm]?[jt]s|\.gitattributes)$/.test(path));
  const playwrightConfig = paths.some(path => /^playwright\.config\.[cm]?[jt]s$/.test(path));
  return {
    types: shared || paths.some(path => path === '.oxlintrc.json' || /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)),
    simulation: shared || paths.some(path => /^(src\/(engine|levels|types)\.ts|tests\/engine\.test\.ts)$/.test(path)),
    browser: shared || app || playwrightConfig || paths.some(path => path === 'tests/browser.spec.ts'),
    distribution: shared || app || playwrightConfig || paths.some(path => /^(scripts\/standalone\.ts|playwright\.distribution\.config\.ts|LICENSE|play\.html|tests\/distribution\.spec\.ts)$/.test(path)),
    deployment: shared || paths.some(path => /^(scripts\/deploy\.ts|tests\/deploy\.test\.ts|\.github\/workflows\/deploy\.yml)$/.test(path)),
  };
}

// No API token or dependencies: works with fork PRs, deletions and large diffs.
// Disabling rename detection includes both old and new paths when a file moves.
function changedPaths(base: string, head: string): string[] {
  const start = execFileSync('git', ['merge-base', base, head], { encoding: 'utf8' }).trim();
  return execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', start, head], { encoding: 'utf8' }).split('\0').filter(Boolean);
}

export function validationChecks(mode: string, base: string, head: string) {
  if (mode === 'full') return { types: true, simulation: true, browser: true, distribution: true, deployment: true };
  if (mode === 'selected' && base && head) return checksFor(changedPaths(base, head));
  throw new Error('Expected full validation or selected validation with base and head SHAs');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [base, head] = process.argv.slice(2);
  const checks = validationChecks('selected', base, head);
  const output = Object.entries(checks).map(([name, run]) => `${name}=${run}`).join('\n') + '\n';
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  process.stdout.write(output);
}
