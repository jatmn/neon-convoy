# CI test-failure audit

For two weeks beginning November 20, 2026, record each fixed test failure in
[the CI test-failure log](docs/ci-test-failures.md). Include the failing behavior,
the run or reproducer, what changed, and whether it caught a regression or only
detected an implementation change.

After the window, remove a file only if the observations show it exclusively
detects implementation changes. Record the evidence and the disallowed pattern
here at that point. Preserve test files covering authorization, privacy,
migration, or concurrency.
