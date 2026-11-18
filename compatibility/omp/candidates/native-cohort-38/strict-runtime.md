# Isolated Source38 StrictStart runtime

The StrictStart stage uses the same 12-patch Source38 tree and schema as the Catalog stage.
It compiles the pinned OMP CLI entry point for `--mode rpc-ui --strict-start`. The Host opens the resulting child
through the existing public `SessionWorker` transport. [Catalog stage](catalog-runtime.md) · [Source and patch identities](candidate.json)

## Build and verify

Use Python 3.9 or newer and the pinned Linux x64 Bun 1.4.4 executable. Give the recipe the verified Catalog
and compiler stages and the frozen StrictStart registry directory. The registry directory contains the 38
archives, the locked Puppeteer patch and an expanded `node_modules`. [Compiler stage](compiler.md) · [Input manifest](strict-runtime-inputs.json)

```bash
recipe=compatibility/omp/candidates/native-cohort-38/stage-strict-runtime.py
python3 -B "$recipe" stage /path/to/catalog-stage /path/to/bun /path/to/new/strict-stage \
  /path/to/compiler-stage /path/to/registry
python3 -B "$recipe" verify /path/to/catalog-stage /path/to/bun /path/to/strict-stage
```

### Prepare the registry expansion

Use a fresh registry directory containing the archives under their manifest `archive` names. The public npm
archive URL for each entry uses `https://registry.npmjs.org/NAME/-/BASENAME-VERSION.tgz`, where `BASENAME` is
the last component of `NAME`. Extract the patch from the pinned Native tree. The commands below check sizes
and hashes before extracting, preserve scoped names such as `@puppeteer/browsers` under `node_modules`, and
verify the patched `ElementHandle.js` Git blob.

```bash
registry=/path/to/registry
native_git=/path/to/compiler-stage/vendor/omp
manifest=compatibility/omp/candidates/native-cohort-38/strict-runtime-inputs.json
tree=b102d9db2b9b91e7baa1de484ca901705785993b
git -C "$native_git" show "$tree:patches/puppeteer-core@25.3.0.patch" > "$registry/puppeteer-core.patch"
python3 -B - "$registry" "$manifest" <<'PYCODE'
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import sys

registry, manifest = (Path(value).resolve(strict=True) for value in sys.argv[1:])
pins = json.loads(manifest.read_text(encoding="utf-8"))
patch_pin = pins["puppeteerPatch"]
patch = registry / patch_pin["path"]
if patch.stat().st_size != patch_pin["bytes"] or hashlib.sha256(patch.read_bytes()).hexdigest() != patch_pin["sha256"]:
    raise SystemExit("Puppeteer patch identity differs")
for pin in pins["registry"]["archives"]:
    archive = registry / pin["archive"]
    if archive.stat().st_size != pin["bytes"]:
        raise SystemExit(f"Archive byte count differs: {archive}")
    digest = base64.b64encode(hashlib.sha512(archive.read_bytes()).digest()).decode("ascii")
    if "sha512-" + digest != pin["integrity"]:
        raise SystemExit(f"Archive integrity differs: {archive}")

modules = registry / "node_modules"
modules.mkdir()
for pin in pins["registry"]["archives"]:
    package = modules / pin["name"]
    package.mkdir(parents=True)
    subprocess.run(["tar", "-xzf", registry / pin["archive"], "--strip-components=1", "-C", package], check=True)
puppeteer = modules / "puppeteer-core"
subprocess.run(["git", "apply", patch], cwd=puppeteer, check=True)
blob = subprocess.check_output(["git", "hash-object", "lib/puppeteer/api/ElementHandle.js"], cwd=puppeteer, text=True)
if blob.strip() != "ee6b042c87861f00d7fcbb6e3eb6e87af232ebbd":
    raise SystemExit("Puppeteer ElementHandle postimage differs")
PYCODE
```

Staging checks each of the 38 archives against the frozen Native Bun lock and hashes the 6,361-entry
expansion with a 47,958,074-byte regular-file bound and a maximum depth of nine. Readback of the existing
expansion matched every archive member outside the 12 locked Puppeteer patch targets. Git reverse patch
validation and the `ElementHandle.js` blob check passed. The archives total 6,734,034 bytes. No lifecycle scripts run.
The staging and rebuild here reused that verified expansion.

The staging command verifies the Catalog inventory and exact compiler receipt and checks the 25 generated
files before using them. Bun uses the pinned upstream legacy Pi module plugin, the two verified Puppeteer
exports, a fresh build home and both disabled compile caches. The compile-only predecessor produced
37,234,507 and 203,402 in-memory bytes from the StrictStart source entry point. Its report SHA-256 was
`4bc8c73ee05c780854edfabe450ec4c8e748ce100aa3fe37f25fb6bab2803284`.
Bun's split CLI build returned duplicate chunk names. The staged build uses one whitespace-minified CLI file and
its changelog asset. The compiled StrictStart path retains deferred initialization calls for SessionManager,
StrictSessionStorage and the ordinary CLI. The output is hashed before writing to the new private directory.

| Staged regular file | Bytes | SHA-256 |
| --- | ---: | --- |
| `bundle/cli.js` | 29,981,874 | `5658c2d6991e86b66761b68c97779189509345c2177bbe04631b8a4494ec37e8` |
| `bundle/CHANGELOG-dtzqjxwh.md` | 203,402 | `a626a12a05a2399ce825ae445b56285a238238c56e690a84f56cb00a27505f70` |
| `rpc-wire.schema.json` | 229,463 | `81a3ffc9ebcf5c929c39995cdc6350b56796782353f87a6a9c274153baffe958` |
| `no-provider.ts` | 3,122 | `c413f208c3a0849c2b37726d05e4533144a36bf420b8ec3cbfb3fdfa28346497` |

The stage contains about 29 MiB of regular files. It links `bundle/omp` to `cli.js` and uses two checked links
to the existing Catalog stage. `native` supplies the baseline add-on at the loader's `../native` location.
`package` supplies upstream package assets for `PI_PACKAGE_DIR`. The old Catalog receipt and inventory were unchanged.
The StrictStart receipt binds both links to that Catalog stage's absolute path. The verifier authenticates
Bun, the Catalog inventory, the staged files, the exact link targets and the receipt. A rebuild in fresh scratch
produced the same output file hashes and passed independent readback. Run `strict-runtime-stage.test.py` with
the Catalog stage, compiler stage, registry, Bun and a scratch parent to repeat this check.

## Ordinary public RPC observations

The staging and readback used
`/dev/shm/omp-webui-strict-stage41.f8XkazZa/candidate`. Its 1,705-byte `strict-runtime.json` SHA-256 was
`9c0ae64d63cb6dffe8658d1fb593af09acab753111675cc41f4062c768131a1c`.
The separate RPC runs verified the candidate, set up a fresh working directory and isolated profile, and
spawned the verified Bun with `--no-env-file --no-install` and the pinned no-provider preload ahead of
`bundle/omp --mode rpc-ui --strict-start`. They used the baseline add-on, offline mode, disabled extensions,
skills, rules, tools, context files, judge, spotlight, LSP and title generation, and both disabled caches.

- The unopened worker passed the advertised ready-frame checks, negotiated RPC v2 and returned
  `{version: "strict-start-v1", phase: "waiting"}` through `get_strict_state`. Its original stdout
  and stderr reached EOF with exit 0 and no stderr, termination or force. Cwd and profile stayed unchanged.
  The preload recorded 0 denials and 0 dispatches. The sanitized 366-byte result SHA-256 was
  `be240b1308c1c583e91ecc1669831199fbb7d6c667e1e31000f5e86e7b215bf6`.
- The seeded run obtained one free opaque reference through the public Catalog, negotiated v2 and continued it
  in the staged StrictStart worker. `strict_start` transitioned from waiting to open with the same native
  Session ID and instance ID and confirmed the canonical cwd. `get_state` agreed, and the public History tree
  page contained the synthetic entry. Catalog and worker finished with clean EOF. The worker exited 0
  with no stderr, termination or force. Each preload recorded 0 denials and 0 dispatches. The synthetic
  journal bytes, Session file list and cwd were unchanged. The sanitized 457-byte result SHA-256 was
  `66df53274638d8341f1776f44d2564bfe9259af348807285481481ba1edc0cef`.

- A separate seeded run supplied a different authorized scratch cwd for the verified Catalog reference.
  The worker reported `STRICT_CWD_MISMATCH` and a failed StrictStart state with no native binding.
  Both children exited 0 after stdout and stderr EOF, with no termination or force. Each preload
  recorded 0 denials and 0 dispatches, and the journal bytes and Session file list were unchanged.
  The sanitized 474-byte result SHA-256 was
  `28f72a0c455fc7984ba609361ac0ed06d983f502d0c8ca5db174a850567d615e`.

The worker accepted 1,048,576-byte physical and 67,108,864-byte reassembled frame limits with a
16,384-byte outbound command bound. These ordinary exchanges exercised small frames.
Busy-worker shutdown, contention, writes and history migration, TUI, paired DSH acceptance and the actual
global installation remain pending. [Candidate admission #41](https://github.com/HowBoring/omp-webui/issues/41)
and [supervised Session delivery #44](https://github.com/HowBoring/omp-webui/issues/44)
