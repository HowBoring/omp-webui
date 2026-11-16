#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
fixture_out=vendor/submission-fixture/controls
mkdir -p "$fixture_out"
cp -r experiments/draft-seam/fixture/navigation vendor/submission-fixture/
cp experiments/draft-seam/fixture/package.json experiments/draft-seam/fixture/index.js "$fixture_out/"
bun build experiments/submission-seam/fixture/client.js --target=browser --format=iife --outfile="$fixture_out/client.js"
