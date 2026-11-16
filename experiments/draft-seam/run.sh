#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
dsh_source="${DSH_SOURCE:-vendor/dsh}"
evidence="${1:-experiments/draft-seam/evidence}"
mkdir -p "$evidence"
bun --no-env-file scripts/link-dsh.ts "$dsh_source"
bun --no-env-file apps/diagnostics/build.ts > vendor/draft-diagnostics-build.log
bun --no-env-file scripts/build-diagnostics-host.ts >> vendor/draft-diagnostics-build.log
experiments/draft-seam/build-fixture.sh
rm -f "$evidence/server.json"
bun --no-env-file experiments/draft-seam/host.mjs "$dsh_source" "$evidence" > vendor/draft-fixture-host.log 2>&1 &
fixture_pid=$!
cleanup() {
  kill -TERM "$fixture_pid" 2>/dev/null || true
  wait "$fixture_pid" 2>/dev/null || true
}
trap cleanup EXIT
for _ in {1..200}; do
  [[ -f "$evidence/server.json" ]] && break
  kill -0 "$fixture_pid" 2>/dev/null || { cat vendor/draft-fixture-host.log; exit 1; }
  sleep 0.1
done
[[ -f "$evidence/server.json" ]]
python experiments/draft-seam/browser.py "$evidence"
