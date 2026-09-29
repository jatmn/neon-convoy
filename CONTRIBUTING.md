# Contributing to Neon Convoy

Contributions are welcome. Neon Convoy is a small, maintainer-directed browser
rescue-puzzle game. Changes should improve the existing game while preserving
its technical direction and manageable maintenance cost.

Submitting a pull request does not guarantee review or acceptance. Maintainers
may decline or close work that does not fit the project's scope, priorities,
or maintenance budget, even when the code is technically sound.

Anyone with a GitHub account may open an issue or propose a pull request from
a fork. Merge access is limited to the repository owner and invited
maintainers; contributors do not need collaborator access. Report suspected
vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

Fork pull request workflows may wait for maintainer approval. Maintainers
should inspect the proposed changes, including workflows, dependencies, and
install scripts, before approving a run. Workflow approval permits execution
of the proposed code; it does not approve merging the pull request.

## Start With Scope

Before starting work:

1. Search existing issues and pull requests, including overlapping open work.
2. Read [README.md](README.md) for gameplay, setup, validation, and project layout.
3. Read [docs/inspiration.md](docs/inspiration.md) for the game's design references
   and original-content boundaries.
4. For anything beyond a small, obvious fix, open an issue and agree on the
   problem and proposed direction with a maintainer before writing code.

Keep each PR focused on one clearly defined problem. Do not bundle unrelated
cleanup, formatting, dependency updates, or refactoring into a fix.

## Project Direction

Good contributions include:

- Fixing simulation, terrain, tool, scoring, or progress-persistence bugs.
- Improving readable gameplay, responsive controls, keyboard and touch support,
  or accessibility.
- Correcting campaign levels, briefings, and hints with evidence that the
  affected sector remains completable.
- Improving tests, documentation, rendering, or audio within the existing design.

Preserve the static browser game and self-contained `play.html` distribution.
Gameplay must remain playable locally without a backend, account, API key, or
required external media. Preserve the original sci-fi identity and synthwave
presentation.

Discuss new game modes, major mechanics, campaign expansion, persistence-format
changes, or external services before implementing them.

## Technical Direction

Use TypeScript for game code, tests, and repository scripts, with the existing
HTML, CSS, Canvas, Web Audio, Node, Vite, and Playwright setup. Keep explicit
`.ts` imports and erasable TypeScript syntax as described in the README.

Do not introduce a new implementation language, runtime, build system, or
framework without prior agreement. Dependency additions or replacements need a
concrete benefit and maintainer agreement; personal preference is not enough.
Reuse existing code paths and test harnesses before adding new abstractions.

## What May Be Closed Without Review

Maintainers may close a PR without further review or explanation when it:

- Duplicates existing work or disregards an agreed implementation decision.
- Rewrites or reformats large areas without a demonstrated functional benefit.
- Changes architecture, dependencies, or project scope without prior agreement.
- Bundles unrelated changes or drifts beyond the agreed problem.
- Provides no clear benefit, reproducible evidence, or appropriate validation.
- Removes useful coverage or weakens checks to make a change pass.

## Pull Request Expectations

Every PR should:

- Explain the problem, what changed, and why it belongs in Neon Convoy.
- Link related issues or discussion and confirm that overlapping PRs were checked.
- Include a reproducer for bug fixes and regression coverage where appropriate.
- Describe the exact validation performed and any checks that remain unverified.
- Include before/after screenshots or a short recording for visible changes,
  with browser and viewport details.
- Keep credentials, private logs, personal data, and local machine paths out of
  committed files and shared evidence.

Use Node.js 22.18 or newer. Install dependencies with `npm ci`; use
`npm run dev` for local development.

For code, tooling, dependency, or build changes, run the full local validation:

```sh
npx playwright install chromium
npm run check
```

This checks types, simulation, the production build, browser controls, and both
site and standalone distribution paths. When build inputs change, run
`npm run build` and commit the regenerated `play.html`; do not hand-edit it.

For documentation-only changes, check links and formatting and run
`git diff --check`. CI selects checks by changed surface; the stable
**Game checks** aggregate must pass. See the README for routing details and
individual validation commands.

For gameplay changes, verify the affected sectors through the simulation tests
and check the player-facing behavior. For control or layout changes, check both
desktop and mobile views. State whether browser results came from emulation or
physical devices; do not claim coverage for browsers you did not test.

## Review And Follow-Up

Keep your PR green after every update. Re-run the affected checks after review
fixes and confirm CI passes before requesting another review.

Respond to maintainer questions or requested changes within one week. PRs with
no response for one week after review feedback may be closed as abandoned.
If you return later, ask whether the old PR should be reopened or submit a fresh
PR that accounts for intervening changes.

## Art, Audio, And Attribution

Contribute original work or assets with documented permission and compatible
licensing. Include provenance and required attribution for proposed assets.
Do not copy Lemmings art, music, levels, or other proprietary material.
Keep new assets compatible with the game's local and standalone distribution.
