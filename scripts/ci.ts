import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function checksFor(paths: string[]) {
  const shared = paths.some(path => /^(package(-lock)?\.json|tsconfig[^/]*\.json|\.github\/workflows\/check\.yml|scripts\/ci\.ts|tests\/ci\.test\.ts)$/.test(path));
  const app = paths.some(path => path.startsWith('src/') || /^(index\.html|favicon\.svg|vite\.config\.ts)$/.test(path));
  return {
    types: shared || paths.some(path => /\.([cm]?ts|tsx)$/.test(path)),
    simulation: shared || paths.some(path => /^(src\/(engine|levels|types)\.ts|tests\/engine\.test\.ts)$/.test(path)),
    browser: shared || app || paths.some(path => /^(tests\/browser\.spec\.ts|playwright\.config\.ts)$/.test(path)),
    distribution: shared || app || paths.some(path => /^(scripts\/standalone\.ts|playwright\.distribution\.config\.ts|LICENSE|play\.html|tests\/distribution\.spec\.ts|playwright\.config\.ts)$/.test(path)),
  };
}

// No API token or dependencies: works with fork PRs, deletions and large diffs.
// Disabling rename detection includes both old and new paths when a file moves.
export function changedPaths(base: string, head: string, pullRequest: boolean): string[] {
  const start = pullRequest
    ? execFileSync('git', ['merge-base', base, head], { encoding: 'utf8' }).trim()
    : base;
  return execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', start, head], { encoding: 'utf8' }).split('\0').filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [base, head, event] = process.argv.slice(2);
  if (!base || !head) throw new Error('Expected base SHA, head SHA, and event name');
  // A new branch has no before commit; validate every surface.
  const checks = checksFor(/^0+$/.test(base) ? ['package.json'] : changedPaths(base, head, event === 'pull_request'));
  const output = Object.entries(checks).map(([name, run]) => `${name}=${run}`).join('\n') + '\n';
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  process.stdout.write(output);
}
