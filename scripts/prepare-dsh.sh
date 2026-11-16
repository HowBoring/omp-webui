#!/usr/bin/env bash
set -euo pipefail
# Invoke with Node 24.22.1 and Corepack/pnpm 11.28.5 on this task's PATH.
dsh_source="${DSH_SOURCE:-vendor/dsh}"
dsh_base=38a6a5c965aa99ab525161efb7cc5cf1fe62fced
[[ "$(node --version)" == v24.22.1 ]]
if [[ -L "$dsh_source" ]]; then
  echo 'Use an owned DSH clone for source builds; do not mutate a shared checkout.' >&2
  exit 1
fi
if [[ ! -d "$dsh_source/.git" ]]; then
  git init "$dsh_source"
  git -C "$dsh_source" remote add origin https://github.com/deepseek-ai/deepseek-harness.git
  git -C "$dsh_source" fetch --depth=1 origin "$dsh_base"
  git -C "$dsh_source" checkout --detach "$dsh_base"
fi
[[ "$(git -C "$dsh_source" rev-parse HEAD)" == "$dsh_base" ]]
git -C "$dsh_source" diff --exit-code HEAD --
cd "$dsh_source"
[[ "$(corepack pnpm --version)" == 11.28.5 ]]
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm run build:artifacts --serial
corepack pnpm run build:check --serial
