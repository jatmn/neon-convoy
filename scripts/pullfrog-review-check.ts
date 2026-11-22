import { appendFileSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
const OWNER_ID = 12479882;

const REVIEW_TRIGGERS = new Set([
  'pull_request_opened',
  'pull_request_ready_for_review',
  'pull_request_synchronize',
]);

interface ReviewDispatch {
  '~pullfrog'?: unknown;
  triggerer?: string;
  event?: { is_pr?: unknown; trigger?: string; issue_number?: unknown };
}

interface GitHubApi {
  apiUrl: string;
  repository: string;
  token: string;
}

export async function isAuthorizedReview(
  payload: ReviewDispatch | null,
  { apiUrl, repository, token }: GitHubApi,
) {
  const event = payload?.event;
  if (
    payload?.['~pullfrog'] !== true ||
    event?.is_pr !== true ||
    !REVIEW_TRIGGERS.has(event.trigger ?? '') ||
    typeof event.issue_number !== 'number' ||
    !Number.isSafeInteger(event.issue_number) ||
    event.issue_number <= 0
  ) {
    return false;
  }

  // Read the PR author from GitHub because a different account may have pushed the commit.
  const number = event.issue_number;
  const url = `${apiUrl}/repos/${repository}/pulls/${number}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  const delays = [250, 750];

  async function lookup(attempt: number): Promise<boolean> {
    let lastError;
    let retryable;
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
      if (response.ok) {
        const pr = await response.json();
        return pr?.user?.id === OWNER_ID && pr.user.login === 'jatmn';
      }

      lastError = new Error(`GitHub HTTP ${response.status}`);
      retryable = (response.status === 408 || response.status >= 500) && !response.headers.has('Retry-After');
      await response.body?.cancel();
    } catch (error) {
      lastError = error;
      retryable =
        error instanceof Error &&
        (error instanceof TypeError || error.name === 'TimeoutError' || error.name === 'AbortError');
    }
    const delay = delays[attempt];
    if (!retryable || delay === undefined) {
      throw new Error(`Could not verify PR #${number} author.`, { cause: lastError });
    }
    await wait(delay);
    return lookup(attempt + 1);
  }
  return lookup(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { PULLFROG_PROMPT, GITHUB_API_URL, GITHUB_REPOSITORY, GH_TOKEN, GITHUB_OUTPUT } = process.env;
  if (!PULLFROG_PROMPT || !GITHUB_API_URL || !GITHUB_REPOSITORY || !GH_TOKEN || !GITHUB_OUTPUT)
    throw new Error('Missing Pullfrog review environment');
  const authorized = await isAuthorizedReview(JSON.parse(PULLFROG_PROMPT), {
    apiUrl: GITHUB_API_URL,
    repository: GITHUB_REPOSITORY,
    token: GH_TOKEN,
  });
  if (authorized) {
    appendFileSync(GITHUB_OUTPUT, 'authorized=true\n');
  } else {
    console.log('Skipping automatic review. The dispatch must target an owner-authored PR.');
  }
}
