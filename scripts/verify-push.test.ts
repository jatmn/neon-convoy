import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./verify-push.ts', import.meta.url));
const repository = fileURLToPath(new URL('..', import.meta.url));
const zero = '0'.repeat(40);
const absent = '1'.repeat(40);

// Each record below ends before any snapshot is created, so no verification runs.
function push(records: string) {
  return spawnSync(process.execPath, [script], { cwd: repository, encoding: 'utf8', input: records });
}

void test('ref names may contain whitespace other than the ASCII field separator', () => {
  const ref = 'refs/heads/no\u00a0break';
  const result = push(`${ref} ${zero} ${ref} ${absent}\n`);
  assert.equal(result.status, 0, result.stderr);
});

void test('notes ref updates are not verified as game snapshots', () => {
  const result = push(`refs/notes/commits ${absent} refs/notes/commits ${zero}\n`);
  assert.equal(result.status, 0, result.stderr);
});

void test('a missing pushed object is reported by its object ID', () => {
  const result = push(`refs/heads/missing ${absent} refs/heads/missing ${zero}\n`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`Pushed Git object is missing: ${absent}$`, 'm'));
});
