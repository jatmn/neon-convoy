import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' });
const input = readFileSync(0, 'utf8').trim();
const tips = input ? input.split('\n').map((line) => line.trim().split(/\s+/)[1]) : [head];

for (const tip of new Set(tips)) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(tip))
    throw new Error('Pre-push did not receive a Git commit SHA');
  if (/^0+$/.test(tip)) continue;
  if (tip === head && !dirty) {
    execFileSync('bun', ['run', 'verify'], { stdio: 'inherit' });
    continue;
  }

  const checkout = mkdtempSync(`${tmpdir()}/neon-pre-push-`);
  try {
    execFileSync('git', ['clone', '--shared', '--quiet', '--no-checkout', '--', '.', checkout], {
      stdio: 'inherit',
    });
    execFileSync('git', ['checkout', '--quiet', '--detach', tip], { cwd: checkout, stdio: 'inherit' });
    execFileSync('bun', ['install', '--frozen-lockfile'], { cwd: checkout, stdio: 'inherit' });
    execFileSync('bun', ['run', 'verify'], { cwd: checkout, stdio: 'inherit' });
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
}
