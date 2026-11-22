import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const verificationTimeout = 20_000;
const setupTimeout = 120_000;
const shutdownGrace = 1_000;
const shutdownTimeout = 2_000;
const objectId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const windows = process.platform === 'win32';

const interruptSignals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
const interruption = new AbortController();
const interrupt = () => interruption.abort();

class CheckoutProcessError extends Error {}

function pushedCommits(input: string) {
  const objects = new Set<string>();
  for (const line of input.split('\n')) {
    if (!line) continue;
    // Git separates the fields with single ASCII spaces. The source expression can contain more of them,
    // and ref names can contain other whitespace.
    const fields = line.split(' ');
    const local = fields.at(-3);
    const remoteRef = fields.at(-2);
    const remote = fields.at(-1);
    if (
      fields.length < 4 ||
      !local ||
      !remoteRef ||
      !remote ||
      !objectId.test(local) ||
      !objectId.test(remote)
    )
      throw new Error('Pre-push received an invalid Git ref update');
    // Notes refs record annotations, not game snapshots.
    if (remoteRef.startsWith('refs/notes/')) continue;
    if (!/^0+$/.test(local)) objects.add(local);
  }
  if (!objects.size) return new Set<string>();

  const requested = [...objects];
  const peeled = execFileSync('git', ['cat-file', '--batch-check=%(objectname) %(objecttype)'], {
    encoding: 'utf8',
    input: requested.map((oid) => `${oid}^{}\n`).join(''),
  });
  const commits = new Set<string>();
  // Batch output follows input order; a missing object echoes its peel expression instead of an ID.
  for (const [index, line] of peeled.trimEnd().split('\n').entries()) {
    const [oid, type] = line.split(' ');
    if (type === 'missing') throw new Error(`Pushed Git object is missing: ${requested[index]}`);
    if (type === 'commit') commits.add(oid);
  }
  return commits;
}

function signalGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

function liveProcessGroups(root: number, tracked: Map<number, string>) {
  const table = execFileSync(
    'ps',
    ['-A', '-o', 'pid=', '-o', 'ppid=', '-o', 'pgid=', '-o', 'stat=', '-o', 'lstart='],
    {
      encoding: 'utf8',
    },
  );
  const processes = table
    .trim()
    .split('\n')
    .map((line) => {
      const [pid, parent, group, state, ...start] = line.trim().split(/\s+/);
      return {
        pid: Number(pid),
        parent: Number(parent),
        group: Number(group),
        state,
        start: start.join(' '),
      };
    })
    .filter(({ state }) => state && !state.startsWith('Z'));

  const groups = new Set<number>();
  const owned = new Set<number>();
  const firstSnapshot = tracked.size === 0;
  for (const entry of processes) {
    if (tracked.get(entry.pid) === entry.start || (firstSnapshot && entry.group === root)) {
      owned.add(entry.pid);
      groups.add(entry.group);
    }
  }

  // Discover separate groups by ancestry, then keep their identities across reparenting.
  let previousSize = -1;
  while (owned.size !== previousSize) {
    previousSize = owned.size;
    for (const entry of processes) {
      if (owned.has(entry.parent) || groups.has(entry.group)) {
        owned.add(entry.pid);
        groups.add(entry.group);
        tracked.set(entry.pid, entry.start);
      }
    }
  }
  return groups;
}

async function killAndWait(root: number, tracked: Map<number, string>, deadline: number): Promise<void> {
  const groups = liveProcessGroups(root, tracked);
  if (!groups.size) return;
  if (Date.now() >= deadline) throw new Error('Verification processes are still running');
  for (const group of groups) signalGroup(group, 'SIGKILL');
  await delay(25);
  await killAndWait(root, tracked, deadline);
}

async function stopCommand(pid: number) {
  if (windows) {
    execFileSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }

  const tracked = new Map<number, string>();
  const groups = liveProcessGroups(pid, tracked);
  if (!groups.size) return;
  // Give Playwright a chance to close its separately launched browser and server groups.
  if (groups.has(pid)) signalGroup(pid, 'SIGINT');
  await delay(shutdownGrace);
  await killAndWait(pid, tracked, Date.now() + shutdownTimeout);
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
  timeout: number,
) {
  const label = [command, ...args].join(' ');
  if (interruption.signal.aborted) throw new Error(`${label} was interrupted`);
  const child = spawn(command, args, { ...options, detached: !windows, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(process.stdout, { end: false });
  child.stderr.pipe(process.stderr, { end: false });
  const closed = new Promise<number | NodeJS.Signals | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve(signal ?? code));
  });
  const controller = new AbortController();
  try {
    const outcome = await Promise.race([
      closed,
      delay(timeout, 'timed out', {
        signal: AbortSignal.any([controller.signal, interruption.signal]),
      }).catch(() => 'was interrupted'),
    ]);
    if (outcome === 'timed out' || outcome === 'was interrupted') {
      try {
        if (child.pid) await stopCommand(child.pid);
        const drained = await Promise.race([
          closed.then(() => true),
          delay(shutdownTimeout, false, { ref: false }),
        ]);
        if (!drained) throw new Error('Verification output is still open');
      } catch (cause) {
        throw new CheckoutProcessError(`Could not stop ${label} in ${options.cwd}`, { cause });
      }
      throw new Error(`${label} ${outcome}`);
    }
    if (outcome !== 0) throw new Error(`${label} failed (${outcome})`);
  } finally {
    controller.abort();
  }
}

async function verifyCommit(commit: string, source: string, env: NodeJS.ProcessEnv) {
  console.log(`Verifying pushed commit ${commit}`);
  const checkout = mkdtempSync(join(tmpdir(), 'neon-pre-push-'));
  const options = { cwd: checkout, env };
  let retainCheckout = false;
  try {
    await runCommand(
      'git',
      ['clone', '--shared', '--quiet', '--no-checkout', '--', source, checkout],
      options,
      setupTimeout,
    );
    // Git clones a shallow source over its transport, which copies only objects its refs reach.
    await runCommand('git', ['fetch', '--quiet', '--no-tags', '--', source, commit], options, setupTimeout);
    await runCommand('git', ['checkout', '--quiet', '--detach', commit], options, setupTimeout);
    await runCommand(process.execPath, ['install', '--frozen-lockfile'], options, setupTimeout);
    await runCommand(
      process.execPath,
      ['--bun', 'playwright', 'install', '--only-shell', 'chromium'],
      options,
      setupTimeout,
    );
    await runCommand(
      process.execPath,
      ['scripts/verify.ts', 'full', 'HEAD', 'HEAD', '--check-committed'],
      { ...options, env: { ...env, GAME_CHECK_DEADLINE_MS: String(Date.now() + verificationTimeout) } },
      verificationTimeout,
    );
  } catch (error) {
    retainCheckout = error instanceof CheckoutProcessError;
    throw error;
  } finally {
    if (!retainCheckout) rmSync(checkout, { recursive: true, force: true });
  }
}

async function verifyTips(input: string) {
  const commits = pushedCommits(input);
  if (!commits.size) return;

  const source = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    encoding: 'utf8',
  }).trimEnd();
  const localEnv = execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' });
  const env: NodeJS.ProcessEnv = { ...process.env, CI: 'true', NEON_ISOLATE_TEST_SERVERS: '1' };
  // Clear the calling repository's context before any command touches a snapshot.
  for (const name of localEnv.trim().split(/\s+/)) delete env[name];
  delete env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

  // Every interrupt, including a repeated one, must stop verification and remove its snapshot.
  for (const signal of interruptSignals) process.on(signal, interrupt);
  try {
    // One snapshot at a time keeps the per-commit setup and verification budgets independent.
    let verification = Promise.resolve();
    for (const commit of commits) verification = verification.then(() => verifyCommit(commit, source, env));
    await verification;
  } finally {
    for (const signal of interruptSignals) process.off(signal, interrupt);
  }
}

await verifyTips(readFileSync(0, 'utf8'));
