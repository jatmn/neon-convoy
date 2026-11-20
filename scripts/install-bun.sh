#!/usr/bin/env bash
set -euo pipefail

# This registry release contains Bun 1.4.6-canary.1+7bb427f3b.
version=1.4.5-canary.20261120.1
digest=59e3917ba5a107440484fbbbdfd58258a16cc1aa65388a0fdb5460124dcd9870b980d38e2a61cc89066ecb6f5b9c4c2d1aa43c2ee059f92239ed11f16ce85f65
archive=$(mktemp)
trap 'rm -f "$archive"' EXIT
directory="${RUNNER_TEMP:?}/neon-bun"
mkdir -p "$directory"
curl --fail --silent --show-error --location --output "$archive" \
  "https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-$version.tgz"
printf '%s  %s\n' "$digest" "$archive" | sha512sum --check --status
tar -xzf "$archive" -C "$directory" --strip-components=2 package/bin/bun
"$directory/bun" --revision
printf '%s\n' "$directory" >> "${GITHUB_PATH:?}"
