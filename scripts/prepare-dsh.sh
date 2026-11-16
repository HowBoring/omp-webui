#!/usr/bin/env bash
set -euo pipefail
# Invoke with Node 24.22.1 and Corepack/pnpm 11.28.5 on this task's PATH.
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"
dsh_source="${DSH_SOURCE:-vendor/dsh}"
dsh_base=38a6a5c965aa99ab525161efb7cc5cf1fe62fced
[[ "$(node --version)" == v24.22.1 ]]
if [[ -L "$dsh_source" ]]; then
  echo 'Use an owned DSH clone for source builds; do not mutate a shared checkout.' >&2
  exit 1
fi
dsh_source="$(realpath -m "$dsh_source")"
if [[ ! -d "$dsh_source/.git" ]]; then
  git init "$dsh_source"
  git -C "$dsh_source" remote add origin https://github.com/deepseek-ai/deepseek-harness.git
  git -C "$dsh_source" fetch --depth=1 origin "$dsh_base"
  git -C "$dsh_source" checkout --detach "$dsh_base"
fi
bun --no-env-file scripts/dsh-source.ts "$dsh_source" --apply
cd "$dsh_source"
export PNPM_CONFIG_STORE_DIR="${DSH_STORE_DIR:-$repo_root/vendor/pnpm-store}"
[[ "$(corepack pnpm --version)" == 11.28.5 ]]
corepack pnpm install --frozen-lockfile --ignore-scripts
bun --no-env-file "$repo_root/scripts/dsh-source.ts" "$dsh_source"
corepack pnpm run build:artifacts --serial
corepack pnpm run build:check --serial

bun --no-env-file "$repo_root/scripts/dsh-source.ts" "$dsh_source" > "$dsh_source/.dsh-build/omp-webui-source.json"
