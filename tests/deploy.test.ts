import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deploy } from '../scripts/deploy.ts';

const env = {
  BUNNY_STORAGE_ZONE: 'neon-convoy',
  BUNNY_STORAGE_HOST: 'ny.storage.bunnycdn.com',
  BUNNY_STORAGE_PASSWORD: 'storage-secret',
};

test('deployment uploads only built files, assets before HTML, without an account API key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'neon-deploy-'));
  const previous = process.cwd();
  const calls: { url: string; method: string; key: string; body: string }[] = [];
  const request: typeof fetch = async (input, init) => {
    assert.ok(init);
    calls.push({
      url: String(input), method: init.method!,
      key: new Headers(init.headers).get('AccessKey')!,
      body: typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as Uint8Array),
    });
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal);
    return new Response(null, { status: 201 });
  };
  try {
    await mkdir(join(dir, 'dist/assets'), { recursive: true });
    await writeFile(join(dir, 'dist/index.html'), '<html>game</html>');
    await writeFile(join(dir, 'dist/assets/game #1.js'), 'game bytes');
    await writeFile(join(dir, 'README.md'), 'private development docs');
    await writeFile(join(dir, 'play.html'), 'offline download');
    process.chdir(dir);
    await deploy(env, request);
    assert.deepEqual(calls, [
      { url: 'https://ny.storage.bunnycdn.com/neon-convoy/assets/game%20%231.js', method: 'PUT', key: 'storage-secret', body: 'game bytes' },
      { url: 'https://ny.storage.bunnycdn.com/neon-convoy/index.html', method: 'PUT', key: 'storage-secret', body: '<html>game</html>' },
    ]);

    for (const failedCall of [1, 2]) {
      let count = 0;
      await assert.rejects(deploy(env, async () => {
        count++;
        return new Response(null, { status: count === failedCall ? 401 : 201 });
      }), /HTTP 401/);
      assert.equal(count, failedCall, 'stop immediately after failed uploads');
    }
    let count = 0;
    await assert.rejects(deploy(env, async () => { count++; throw new Error('network failure'); }), /network failure/);
    assert.equal(count, 1);
    for (const invalid of [
      { BUNNY_STORAGE_PASSWORD: '' },
      { BUNNY_STORAGE_HOST: 'storage.bunnycdn.com.attacker.invalid' },
      { BUNNY_STORAGE_ZONE: '../another-zone' },
    ]) {
      await assert.rejects(deploy({ ...env, ...invalid }, async () => {
        assert.fail('invalid configuration must not send credentials');
      }), /Missing BUNNY_STORAGE_PASSWORD|Expected a Bunny storage hostname|Invalid storage zone name/);
    }
    await rm(join(dir, 'dist/index.html'));
    await assert.rejects(deploy(env, request), /Build dist\/index.html/);
    assert.equal(calls.length, 2, 'missing entry point must not start an upload');
  } finally {
    process.chdir(previous);
    await rm(dir, { recursive: true, force: true });
  }
});
