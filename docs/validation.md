# Release validation

Validated on September 28, 2026 using Node 22.23.1 and Chromium.

- `npm test`: 10 simulation tests passed, including deterministic completion of all ten campaign sectors.
- `npm run build`: production site and standalone `play.html` generated successfully.
- `npm run test:browser`: 10 tests passed across desktop Chromium and Pixel 7 emulation.
- Standalone `play.html`: opened successfully using a `file://` URL on desktop and mobile viewport profiles; deployment advanced the timer, Canvas rendered, no page errors, and no horizontal page overflow.
- Audio: browser interaction unlocked a running AudioContext; volume, mute, level changes, pause/resume, and effects executed without page errors.
- Screenshots: desktop and mobile layouts were inspected visually.

The integration suite covers campaign navigation, play/pause, restart, speed, tool assignment, terrain editing, hints/settings dialogs, music state, a real simulation-driven victory, score/progress persistence, and advancing to the next sector. The simulation suite verifies all campaign routes independently from rendering.

Local browser tests used a cached Chromium executable through `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; CI installs the browser matching the pinned Playwright dependency. Firefox and Safari have not been separately tested.
