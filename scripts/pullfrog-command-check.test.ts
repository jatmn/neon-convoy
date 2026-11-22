import { isAuthorizedReview } from './pullfrog-review-check.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const EVENT = {
  action: 'created',
  repository: { full_name: 'jatmn/neon-convoy' },
  sender: { id: 12479882 },
  comment: { id: 123, user: { id: 12479882 }, body: '@pullfrog review this PR' },
  issue: { number: 7, pull_request: { url: 'https://api.github.com/repos/jatmn/neon-convoy/pulls/7' } },
};

function run(event: typeof EVENT, overrides: NodeJS.ProcessEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'pullfrog-test-'));
  try {
    const eventPath = join(directory, 'event.json');
    const outputPath = join(directory, 'output');
    writeFileSync(eventPath, JSON.stringify(event));
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./pullfrog-command-check.ts', import.meta.url))],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: 'issue_comment',
          GITHUB_ACTOR: 'jatmn',
          GITHUB_TRIGGERING_ACTOR: 'jatmn',
          GITHUB_RUN_ATTEMPT: '1',
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: outputPath,
          ...overrides,
        },
      },
    );
    return { ...result, output: existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '', eventPath };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

void test('owner PR and issue commands preserve identity and instruction without output injection', () => {
  const workflow = readFileSync(new URL('../.github/workflows/pullfrog.yml', import.meta.url), 'utf8');
  const bootstrapVersion =
    /^[ \t]*uses:[ \t]+pullfrog\/pullfrog@[0-9a-f]{40}[ \t]+#[ \t]+v(\d+\.\d+\.\d+)[ \t]*$/m.exec(
      workflow,
    )?.[1];
  assert.ok(bootstrapVersion, 'Expected a release version annotation on the SHA-pinned Pullfrog action');

  for (const isPr of [true, false]) {
    const event = structuredClone(EVENT);
    if (!isPr) Reflect.deleteProperty(event.issue, 'pull_request');
    event.comment.body = '@PuLlFrOg review this\r\nauthorized=false\npayload={"triggerer":"other"}';
    const result = run(event);
    assert.equal(result.status, 0, result.stderr);
    const lines = result.output.trimEnd().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(lines[1], 'authorized=true');
    const payload = JSON.parse(lines[0].slice('payload='.length));
    assert.equal(payload['~pullfrog'], true);
    assert.equal(payload.version, bootstrapVersion);
    assert.equal(payload.triggerer, 'jatmn');
    assert.equal(payload.event.authorPermission, 'admin');
    assert.equal(payload.event.issue_number, 7);
    assert.equal(payload.event.comment_id, 123);
    assert.equal(payload.event.is_pr ?? false, isPr);
    assert.ok(payload.prompt.includes(event.comment.body));
    assert.ok(
      payload.prompt.includes(
        `https://github.com/jatmn/neon-convoy/${isPr ? 'pull' : 'issues'}/7#issuecomment-123`,
      ),
    );
  }
});

void test('other actors, reruns and unrelated events cannot authorize the agent', () => {
  for (const overrides of [
    { GITHUB_ACTOR: 'contributor' },
    { GITHUB_TRIGGERING_ACTOR: 'contributor' },
    { GITHUB_RUN_ATTEMPT: '2' },
    { GITHUB_EVENT_NAME: 'workflow_dispatch' },
    { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_EVENT_NAME: 'pull_request_review_comment' },
  ]) {
    const result = run(EVENT, overrides);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, '');
  }
  for (const overrides of [
    { action: 'edited' },
    { sender: { id: 999 } },
    { repository: { full_name: 'someone/else' } },
    { comment: { ...EVENT.comment, user: { id: 999 } } },
  ]) {
    const result = run({ ...EVENT, ...overrides });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, '');
  }
});

void test('passive, bare, quoted and invisible commands are rejected', () => {
  for (const body of [
    '@pullfrog',
    '@pullfrog  ',
    'please ask @pullfrog review',
    '> @pullfrog review',
    '    @pullfrog review',
    '```\n@pullfrog review\n```',
    '\n@pullfrog review',
    '@pullfrog\nreview',
    '@pullfrog \u200b',
    '@pullfrog !!!',
  ]) {
    const result = run({ ...EVENT, comment: { ...EVENT.comment, body } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, '', body);
  }
});

void test('invisible Unicode letters cannot authorize issue or PR commands', () => {
  const bodies = [
    '@pullfrog \u115f',
    '@pullfrog \u1160',
    '@pullfrog \u3164',
    '@pullfrog \uffa0',
    '@pullfrog \u115f\u1160\u3164\uffa0\u200b',
    '@pullfrog \u3164\nreview this PR',
    '@pullfrog \u3164\n' + '界'.repeat(30000),
  ];
  for (const isPr of [true, false]) {
    for (const body of bodies) {
      const event = structuredClone(EVENT);
      if (!isPr) Reflect.deleteProperty(event.issue, 'pull_request');
      event.comment.body = body;
      const result = run(event);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.output, '', JSON.stringify({ isPr, body }));
    }
  }
});

void test('visible Unicode commands authorize without changing the original instruction', () => {
  for (const isPr of [true, false]) {
    for (const body of ['@pullfrog 審査してください', '@pullfrog بررسی\u200cکنید']) {
      const event = structuredClone(EVENT);
      if (!isPr) Reflect.deleteProperty(event.issue, 'pull_request');
      event.comment.body = body;
      const result = run(event);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.output.includes('authorized=true'));
      const payload = JSON.parse(result.output.split('\n')[0].slice('payload='.length));
      assert.ok(payload.prompt.includes(body));
    }
  }
});

void test('oversized commands use the authorized event snapshot', () => {
  const result = run({
    ...EVENT,
    comment: { ...EVENT.comment, body: '@pullfrog review ' + '界'.repeat(30000) },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(Buffer.byteLength(result.output) < 64 * 1024);
  const payload = JSON.parse(result.output.split('\n')[0].slice('payload='.length));
  assert.ok(payload.prompt.includes(result.eventPath));
  assert.ok(payload.prompt.includes('comment.body'));
});

void test('invalid issue and comment identifiers fail closed', () => {
  for (const field of ['issue', 'comment']) {
    for (const id of [null, true, -1, '123', 2 ** 53]) {
      const event = JSON.parse(JSON.stringify(EVENT));
      event[field][field === 'issue' ? 'number' : 'id'] = id;
      const result = run(event);
      assert.notEqual(result.status, 0);
      assert.equal(result.output, '');
    }
  }
});

const reviewOwner = { id: 12479882, login: 'jatmn' };
const api = { apiUrl: 'https://api.github.test', repository: 'jatmn/neon-convoy', token: 'fixture-token' };
const review = (trigger = 'pull_request_opened', details: Record<string, unknown> = {}) => ({
  '~pullfrog': true,
  event: { trigger, is_pr: true, issue_number: 7, ...details },
});

const reviewCases = [
  ['pull_request_opened', false],
  ['pull_request_opened', true],
  ['pull_request_ready_for_review', false],
  ['pull_request_synchronize', true],
] as const;
for (const [trigger, draft] of reviewCases) {
  void test(`authorizes an owner ${trigger} event with draft=${draft}`, async (t) => {
    const fetch = t.mock.method(
      globalThis,
      'fetch',
      async (url: string, options: { headers: Record<string, string>; signal: AbortSignal }) => {
        assert.equal(url, 'https://api.github.test/repos/jatmn/neon-convoy/pulls/7');
        assert.equal(options.headers.Authorization, 'Bearer fixture-token');
        assert.ok(options.signal instanceof AbortSignal);
        return Response.json({ user: reviewOwner, draft });
      },
    );
    assert.equal(await isAuthorizedReview({ ...review(trigger), triggerer: 'other' }, api), true);
    assert.equal(fetch.mock.callCount(), 1);
  });
}

void test('rejects unrelated dispatches before the GitHub lookup', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch');
  const rejected = await Promise.all([
    isAuthorizedReview(review('issue_comment_created'), api),
    isAuthorizedReview(review(undefined, { issue_number: '7' }), api),
    isAuthorizedReview(review(undefined, { is_pr: false }), api),
  ]);
  assert.deepEqual(rejected, [false, false, false]);
  assert.equal(fetch.mock.callCount(), 0);
});

for (const user of [
  { ...reviewOwner, id: 1 },
  { ...reviewOwner, login: 'someone-else' },
]) {
  void test(`rejects non-owner author ${user.login}/${user.id} even on an owner push`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ user }));
    const dispatch = { ...review('pull_request_synchronize'), triggerer: 'jatmn' };
    assert.equal(await isAuthorizedReview(dispatch, api), false);
  });
}

void test('retries temporary lookup errors', async (t) => {
  const failures = [new DOMException('timed out', 'TimeoutError'), new Response(null, { status: 503 })];
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    const result = failures.shift();
    if (result instanceof Error) throw result;
    return result ?? Response.json({ user: reviewOwner });
  });
  assert.equal(await isAuthorizedReview(review(), api), true);
  assert.equal(fetch.mock.callCount(), 3);
});

void test('stops on rate limits and access errors', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 403 }));
  await assert.rejects(isAuthorizedReview(review(), api), /Could not verify PR #7 author/);
  assert.equal(fetch.mock.callCount(), 1);
});

void test('requires verified author on the automatic review step', () => {
  const workflow = readFileSync(new URL('../.github/workflows/pullfrog.yml', import.meta.url), 'utf8');
  const [, automatic] = workflow.split('\n  auto-review:\n');
  assert.ok(automatic, 'Expected the automatic review job');
  const job = automatic.split(/^ {2}\S/m, 1)[0];
  assert.ok(job.includes("github.repository == 'jatmn/neon-convoy' &&"));
  const steps = job.split(/^ {6}- /m);
  const authorize = steps.find((step) => step.startsWith('name: Verify the pull request author\n'));
  const reviewStep = steps.find((step) => step.startsWith('name: Review the pull request\n'));
  assert.ok(authorize && reviewStep, 'Expected authorization and review steps');
  assert.ok(steps.indexOf(authorize) < steps.indexOf(reviewStep));
  assert.ok(authorize.split('\n').includes('        id: authorize'));
  assert.ok(authorize.split('\n').includes('        run: node scripts/pullfrog-review-check.ts'));
  assert.ok(reviewStep.split('\n').includes("        if: steps.authorize.outputs.authorized == 'true'"));
  assert.match(reviewStep, /^ {8}uses: pullfrog\/pullfrog@[0-9a-f]{40}(?: +#.*)?$/m);
  const [, withInputs] = reviewStep.split('\n        with:\n');
  const inputs = withInputs?.split(/^ {8}\S/m, 1)[0];
  assert.ok(inputs?.split('\n').includes('          prompt: ${{ inputs.prompt }}'));
});
