# Source45 offline model discovery candidate

`--offline` already sets `models.offline` before the CLI constructs ModelRegistry. The candidate maps the registry's `online-if-uncached` strategy to its existing `offline` strategy when the supplied settings enable it. This covers CLI background discovery, SDK extension discovery and cache-aware startup selector retries through one boundary. The cache can still supply models and the background refresh still settles. Ordinary online startup and explicit `online` refreshes keep their strategies. Selected-model metadata, connection prewarm and inference retain their existing behavior.

The [patch](model-registry-offline.patch) applies to the pinned Source45 ModelRegistry under Native base `7c49c11aa5bbaf3f418406583096168ad5b8c6dc`. The candidate is outside the active compatibility patch order. Both actual Linux runs used a Bun preload that served the patched bytes only for ModelRegistry at its existing path. The guard preload ran first and the original Native CLI still handled the public RPC protocol. A matched Native rebuild and product admission remain pending.

## Observed Linux results

- Direct public protocol v2 `strict_start` opened one synthetic Session. The guard counted zero denials at extension load, Native `session_start` and exit. The controlled provider was never called. The original traced process returned 0, both streams reached EOF without forced cleanup, and strace observed zero Internet-family socket creations in that lineage.
- The browser used the authenticated V2 client assets and a new Host fixture bundle with 290 unchanged non-entry compiler inputs. One HTTP prompt caused one controlled provider call and a visible failed settlement. The draft stayed editable. No automatic retry, additional Native input, or unresolved-outcome notice appeared. The original Host, catalog, Native worker and strace exited 0. Both original readers joined through EOF and the retained wait domain reached ECHILD. The guard recorded zero denials and dispatches, and the catalog and Native worker lineages had zero Internet-family socket, bind or connect calls.
- The baseline strict-start driver failed response correlation. Its separate receipt counted 16 `fetch` denials by `session_start` and at exit, with fourteen attributed to listed discovery sites. The earlier browser cases retain their `CATALOG_NOT_DRAINED` and `CONTROLLED_NATIVE_NETWORK_GUARD_NOT_ZERO` failures. The earlier V1 TypeScript failure and V2 outer compiler readback failure also stand. A later independent readback verified the 65 V2 client assets and the byte identity of all 95 duplicate Zod module pairs.

[Bounded evidence and original tool receipt identities](evidence.json)

## Reproduction inputs

Use the assembled Source45 donor at `54545e62489ce13c2328f14c0882abc0c1c7d87c`, its pinned Native tree and Bun 1.4.4. `evidence.json` identifies the exact patch, original and patched source, guard, runtime, installation and compiler inputs. Both compiler cache flags are required for these commands.

From this directory, with `OMP_SOURCE45_ROOT` and `BUN` set to absolute paths for the selected donor and runtime, the following runs the opt-in registry regression. Ordinary test discovery skips it before importing any Native module. The original donor failed with 15 injected built-in fetch attempts, two extension attempts and two preloaded guard denials. With the overlay, the offline phase settled with all counters at zero. The explicit and default online controls each reached the preserved rejecting guard exactly once, with zero dispatches.

```bash
git -C "$OMP_SOURCE45_ROOT/vendor/omp" apply --check "$PWD/model-registry-offline.patch"
env -i HOME=/tmp PATH=/usr/bin:/bin BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 NODE_DISABLE_COMPILE_CACHE=1 \
  OMP_SOURCE45_ROOT="$OMP_SOURCE45_ROOT" OMP_TEST_OFFLINE_REGISTRY=1 "$BUN" --no-env-file test \
  --preload "$OMP_SOURCE45_ROOT/compatibility/omp/fixtures/no-provider.ts" ./model-registry.test.ts
env -i HOME=/tmp PATH=/usr/bin:/bin BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 NODE_DISABLE_COMPILE_CACHE=1 \
  OMP_SOURCE45_ROOT="$OMP_SOURCE45_ROOT" OMP_TEST_OFFLINE_REGISTRY=1 OMP_TEST_OFFLINE_OVERLAY=1 \
  "$BUN" --no-env-file test \
  --preload "$OMP_SOURCE45_ROOT/compatibility/omp/fixtures/no-provider.ts" ./model-registry.test.ts
env -i HOME=/tmp PATH=/usr/bin:/bin BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 NODE_DISABLE_COMPILE_CACHE=1 \
  python3 -B -m unittest -v test_startup_frames
```

The startup frame tests cover the public driver regression. Only documented non-error presentation and settlement notifications can precede the correlated `strict_start` reply. A dialog, draft mutation, error, unexpected type, or miscorrelated reply fails with a fixed frame-type label.

The original live harnesses are in the local `mvp-implementation/recovery` workspace. Use their documented allowlisted environment and exact input checks. The direct harness at `restore18-45-offline-startup-source-v1/run.py` takes `--check` for source preflight and `--run` for a fresh synthetic home. The browser harness at `restore18-45-offline-provider-error-source-v1` requires a fresh prepared scope. Its original invocations from the Source45 root were `build.py --build`, `seed.py`, `browser-proof.py --check` and `browser-proof.py --run` with the pinned capable Python. The build and seed are independent. The proof requires the original seed tool EOF0 receipt and its exact two-file home, the matched V2 installation and asset roster, and the new strictly typechecked Host bundle. The original browser scope is consumed. A repeat requires a fresh explicit case scope through the same harness.
