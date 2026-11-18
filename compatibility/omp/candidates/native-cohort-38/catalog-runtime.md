# Isolated Source38 catalog runtime

The staging recipe builds a Linux x64 catalog scope from the exact compiler receipt and the 12-patch Git tree
`b102d9db2b9b91e7baa1de484ca901705785993b`. The archived package sources and all 16 `@oh-my-pi` workspace links live in
new scratch. The older #36 preparation recipe pointed the Native checkout at a separate published-package install.
That install omitted the private `@oh-my-pi/browser-relay` workspace. The pinned `bun.lock` points the package name
at `packages/browser-relay`. Its manifest has no runtime `exports`. Staging the workspace link gives build tools the
actual pinned source package. [Historical preparation recipe](https://github.com/HowBoring/omp-webui/blob/bc6dda2bb7766b28695394793cc49df4308f6096/scripts/prepare-compatibility.ts)

The catalog loads Native Session lease observation through `pi-natives`. The source loader checks its own workspace
`native` directory for the add-on, so the recipe copies the frozen baseline binary there. The standalone catalog
command validator uses Ajv's Unicode string-length helper. The recipe verifies all 466 files in the Ajv donor package,
the Native add-on, Bun, the compiler receipt and the selected generated files against exact pins. It copies those
files into scratch and uses disposable `Bun.build` output to check the catalog import graph. The published package
install and compiler proof serve as read-only inputs. [Exact runtime inputs](catalog-runtime-inputs.json)

## Reproduce

Run with Python 3.9 or newer, Git, tar and the exact Bun 1.4.4 executable. The catalog staging used 240 MiB under
`/dev/shm` and took its compiler input from `/dev/shm/omp-webui-native-compiler-v2-fvYEdK/checked`.

```bash
python3 -B compatibility/omp/candidates/native-cohort-38/stage-catalog-runtime.py \
  /path/to/compiler-proof /path/to/vendor/omp-runtime/node_modules \
  /path/to/bun /dev/shm/path-to-new-catalog-candidate
```

The [proof driver](catalog-runtime-proof.ts) uses the Host's existing `CatalogTransport` and its package dependencies.
Give Bun a separate empty HOME and TMPDIR, an existing empty proof directory and an environment with local IPC
available. The child gets a separate isolated profile, the baseline Native variant and the pinned no-provider
preload before any Native import. It opens the staged launcher through Bun and selects `--rpc-catalog`.

```bash
candidate=/dev/shm/path-to-new-catalog-candidate
proof=/dev/shm/path-to-empty-proof
proof_runner_home=/dev/shm/path-to-empty-runner-home
env -i PATH=/usr/bin:/bin LANG=C.UTF-8 HOME="$proof_runner_home" TMPDIR="$proof_runner_home" \
  BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 NODE_DISABLE_COMPILE_CACHE=1 \
  /path/to/bun --no-env-file --no-install --preload "$candidate/no-provider.ts" \
  compatibility/omp/candidates/native-cohort-38/catalog-runtime-proof.ts "$candidate" "$proof"
```

## Observed results

The unstaged catalog build failed to resolve `pi-utils/dirs`, `pi-utils/type-guards` and
`ajv/dist/runtime/ucs2length` (`01e56b`). After staging, Bun resolved 34 modules and emitted a disposable bundle
(`38132e`). The resulting 1,607-byte `catalog-runtime.json` had SHA-256
`c37717db56ef1808921f7e5f63b86fff9304f18a1cafeb15aef202164820b6dd`. A one-byte mismatch in an owned copy of the
compiler receipt was rejected before staging (`91c0f8`). The proof driver passed scoped strict TypeScript and Oxlint.

The first catalog attempt ended with `RPC_STDIN`, outer exit 1 and no child guard audit (`271d17`). A `/bin/cat`
control reproduced `EPERM` during Bun's pipe flush in that sandbox. A POSIX pipe echoed the same payload (`6d06fd`).
Bun's echo succeeded after the executor enabled local IPC (`852711`). Those controls used the same Bun binary,
cache flags and preload. The successful catalog attempt used the same driver and staged artifacts in a fresh
proof directory under the local IPC grant.

The successful attempt (`a2ea06`) negotiated public RPC v2 and ran `catalog_sources`, `catalog_page` and
`describe_session`. It returned one ready default source, one complete page with the synthetic Session, and a
verified description of the same native instance. The page reported the Session's actual working directory and a free lease. The driver rechecked the journal bytes, modification and change timestamps,
profile entries and working directory entries after closing stdin. The original child, PID `751731`, exited 0 with
empty stderr and EOF on both streams. No termination signals were sent. The preload recorded 0 denials and
0 dispatches. The sanitized 734-byte result under the proof scope had SHA-256
`26bd456efea293deddf296ff6f899672542d159ef4183f686abc2e8a1df1ca2b`.

The returned budgets were 256 entries per scan, 8,192 entries per snapshot, 2,048 directories per snapshot,
4,096 Sessions per snapshot, 16,384 bytes for the journal header or generation header, 6,144 bytes for generation
control, 32 items per page, 262,144 bytes per response, 16,777,216 bytes per snapshot, four snapshots, a 250 ms scan
window, a 10 s total scan and a 60 s cursor lifetime. The Host enforced the catalog's 16,384-byte command and
262,144-byte physical response limits. This run read these limits from the catalog and exercised one ordinary
listing and description.

The candidate remains unregistered. Ordinary `rpc-ui` and TUI Session tests still require their generated assets
and wider dependency graph. Global installation, production admission and paired DSH acceptance require their own
evidence under [the candidate admission issue](https://github.com/HowBoring/omp-webui/issues/41).
