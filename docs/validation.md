# Release validation

Install Playwright's pinned Chromium and run `bun run verify` to validate a release.
The verifier runs `bun run lint` for the Landmines testing rules. See the
[README validation commands](../README.md#validate) for setup and the full list.

Run `bun scripts/check-browser-deadline.ts` to check failure reporting and
trace finalization with a deliberately stalled browser font.

## TypeScript migration results

TypeScript migration validated on September 29, 2026 with Node 22.23.1 and the Chromium revision installed by pinned Playwright 1.63.0.

- `npm run typecheck`: strict checking passed for source, test, script, and configuration files.
- `npm test`: 10 simulation tests and seven CI-routing tests passed. Simulation tests include deterministic completion of all ten campaign sectors. Routing tests cover isolated surfaces, mixed changes, real Git diffs, PR base divergence, deletions, renames, initial pushes, and the committed standalone build gate.
- `npm run build`: production site and standalone `play.html` generated successfully.
- `npm run test:browser`: 10 tests passed across desktop Chromium and Pixel 7 emulation.
- `npm run test:distribution`: four tests passed across the same profiles, opening both the production site and standalone `file://` build, deploying the convoy, advancing its timer, pausing, rendering Canvas, and checking for page errors with external network requests blocked.

Browser integration covers campaign navigation, play/pause, restart, speed, tool assignment, terrain editing, hints/settings dialogs, music state, a real simulation-driven victory, score/progress persistence, and advancing to the next sector. No simulation assertions were removed during migration.

CI uses pinned Bun and Playwright's pinned Chromium headless shell. It passes
`--check-committed` to the verifier to compare its rebuilt `play.html` with the
committed file. The [README](../README.md#continuous-integration) describes
file-based job selection and the aggregate check to require in branch protection.

Firefox and Safari have not been separately tested. The mobile project emulates a Pixel 7 in Chromium; it does not exercise a physical device.
