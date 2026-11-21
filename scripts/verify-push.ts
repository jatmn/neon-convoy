import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const verificationTimeout = 20_000;
const setupTimeout = 120_000;

function verifyTips(input: string) {
  const tips = new Set<string>();
  for (const line of input.split('\n')) {
    if (!line.trim()) continue;
    const [, tip] = line.trim().split(/\s+/);
    if (!tip || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(tip))
      throw new Error('Pre-push did not receive a Git commit SHA');
    if (!/^0+$/.test(tip)) tips.add(tip);
  }
  if (!tips.size) return;

  const source = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    encoding: 'utf8',
  }).trimEnd();
  const localEnv = execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' });
  const env: NodeJS.ProcessEnv = { ...process.env, CI: 'true', NEON_ISOLATE_TEST_SERVERS: '1' };
  // Clear the calling repository's context before any command touches a snapshot.
  for (const name of localEnv.trim().split('\n')) delete env[name];
  delete env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

  for (const tip of tips) {
    console.log(`Verifying pushed commit ${tip}`);
    const checkout = mkdtempSync(join(tmpdir(), 'neon-pre-push-'));
    const options = { cwd: checkout, env, stdio: 'inherit' as const, timeout: setupTimeout };
    try {
      execFileSync('git', ['clone', '--shared', '--quiet', '--no-checkout', '--', source, checkout], options);
      execFileSync('git', ['checkout', '--quiet', '--detach', tip], options);
      execFileSync(process.execPath, ['install', '--frozen-lockfile'], options);
      execFileSync(process.execPath, ['--bun', 'playwright', 'install', '--only-shell', 'chromium'], options);
      execFileSync(process.execPath, ['scripts/verify.ts', 'full', 'HEAD', 'HEAD', '--check-committed'], {
        ...options,
        timeout: verificationTimeout,
        env: { ...env, GAME_CHECK_DEADLINE_MS: String(Date.now() + verificationTimeout) },
      });
    } finally {
      rmSync(checkout, { recursive: true, force: true });
    }
  }
}

verifyTips(readFileSync(0, 'utf8'));
