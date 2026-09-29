# Security policy

## Supported versions

Security fixes target the current `main` branch. Use the latest source or
regenerate the standalone `play.html` from that branch.

## Report a vulnerability

Report suspected vulnerabilities privately through GitHub's
[Report a vulnerability](https://github.com/jatmn/neon-convoy/security/advisories/new)
form. Include the affected commit or release, reproduction steps, impact, and
any proposed fix. Do not include live credentials or other people's personal
data.

Keep vulnerability details out of public issues and pull requests until a
maintainer has coordinated a fix and disclosure. Ordinary bugs and feature
requests belong in public issues.

## Dependency updates

Dependabot checks npm dependencies and GitHub Actions weekly. Updates require
maintainer review and the existing validation checks. When a dependency update
changes the generated standalone build, regenerate and commit `play.html` as
described in [CONTRIBUTING.md](CONTRIBUTING.md).
