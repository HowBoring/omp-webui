#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
fixture_out=vendor/projection-fixture/controls
mkdir -p "$fixture_out"
cp -r experiments/projection-seam/fixture/navigation vendor/projection-fixture/
cp experiments/projection-seam/fixture/package.json experiments/projection-seam/fixture/index.js "$fixture_out/"
bun --no-env-file experiments/projection-seam/build.ts
