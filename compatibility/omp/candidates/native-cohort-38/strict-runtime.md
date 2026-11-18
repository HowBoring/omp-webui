# Isolated Source38 StrictStart runtime

The StrictStart stage uses the same 12-patch Source38 tree and schema as the Catalog stage.
It compiles the pinned OMP CLI entry point for `--mode rpc-ui --strict-start` and its attachment worker.
The Host opens the resulting child through the existing public `SessionWorker` transport. [Catalog stage](catalog-runtime.md) · [Source and patch identities](candidate.json)

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
the last component of `NAME`. Extract the patch from the pinned Native tree and prepare the expansion locally.

```bash
recipe=compatibility/omp/candidates/native-cohort-38/stage-strict-runtime.py
registry=/path/to/registry
native_git=/path/to/compiler-stage/vendor/omp
tree=b102d9db2b9b91e7baa1de484ca901705785993b
git -C "$native_git" show "$tree:patches/puppeteer-core@25.3.0.patch" > "$registry/puppeteer-core.patch"
python3 -B "$recipe" prepare-registry "$registry"
```

Preparation checks the pinned archive sizes and SHA-512 values and the patch SHA-256 before extraction.
It stages scoped names such as `@puppeteer/browsers` beneath a private `node_modules`, applies the patch
with explicitly isolated Git metadata, and publishes the expansion after the complete inventory matches.
A small local fixture nested under a Git checkout checked scoped extraction, patch application, refusal on
inventory mismatch, and refusal to overwrite an existing expansion.

Staging checks the 38 archives against the frozen Native Bun lock and hashes the 6,361-entry expansion with
a 47,958,074-byte regular-file bound and a maximum depth of nine. Readback of the existing expansion matched
every archive member outside the 12 locked Puppeteer patch targets. Git reverse patch validation and the
`ElementHandle.js` blob check (`ee6b042c87861f00d7fcbb6e3eb6e87af232ebbd`) passed. The archives total
6,734,034 bytes. The earlier staging and rebuild reused that verified expansion. No lifecycle scripts run.

The staging command verifies the Catalog inventory and exact compiler receipt and checks the 25 generated
files before using them. Bun uses the pinned upstream legacy Pi module plugin, the two verified Puppeteer
exports, a fresh build home and both disabled compile caches. A build refuses competing ancestor
`node_modules` along the Catalog Native root, registry root and private build entry paths. It uses the workspace
links in the verified Catalog tree and the verified expanded registry. The compile-only predecessor produced
37,234,507 and 203,402 in-memory bytes from the StrictStart source entry point. Its report SHA-256 was
`4bc8c73ee05c780854edfabe450ec4c8e748ce100aa3fe37f25fb6bab2803284`.
Bun's split CLI build returned duplicate chunk names. The staged build uses one whitespace-minified CLI file and
its changelog asset. The compiled StrictStart path retains deferred initialization calls for SessionManager,
StrictSessionStorage and the ordinary CLI. A separate Bun build compiles
`packages/coding-agent/src/attachments/worker.ts` from the verified Catalog tree to the CLI's sibling
`bundle/worker.ts`. Both staging and readback check the source pin, and the receipt records its path,
size and SHA-256. The build checks the size and SHA-256 of each output before writing it to the new private directory.

| Staged regular file | Bytes | SHA-256 |
| --- | ---: | --- |
| `bundle/cli.js` | 29,981,874 | `5658c2d6991e86b66761b68c97779189509345c2177bbe04631b8a4494ec37e8` |
| `bundle/CHANGELOG-dtzqjxwh.md` | 203,402 | `a626a12a05a2399ce825ae445b56285a238238c56e690a84f56cb00a27505f70` |
| `bundle/worker.ts` | 5,158,693 | `d17945e1c0f73bf9417769aaae337ff4472fbd7fb1b0aae0074e294c558feb3c` |
| `rpc-wire.schema.json` | 229,463 | `81a3ffc9ebcf5c929c39995cdc6350b56796782353f87a6a9c274153baffe958` |
| `no-provider.ts` | 3,122 | `c413f208c3a0849c2b37726d05e4533144a36bf420b8ec3cbfb3fdfa28346497` |

The stage contains about 34 MiB of regular files. It links `bundle/omp` to `cli.js` and uses two checked links
to the existing Catalog stage. `native` supplies the baseline add-on at the loader's `../native` location.
`package` supplies upstream package assets for `PI_PACKAGE_DIR`. The old Catalog receipt and inventory were unchanged.
The StrictStart receipt binds both links to that Catalog stage's absolute path. The verifier authenticates
Bun, the Catalog inventory, the staged files, the exact link targets and the receipt. A rebuild in fresh scratch
produced the same output file hashes and passed independent readback. Run `strict-runtime-stage.test.py` with
the Catalog stage, compiler stage, registry, Bun and a scratch parent to repeat this check.
The test also checks that verification rejects a missing worker, an altered worker of the same size and a
launcher link changed from `cli.js` to `cli.js/`.

### Fresh expansion and rebuild

At Host integration `507290f7fbd891be17f5dcd694e91f4fc15c397b`, a fresh private directory
started with only the 38 pinned archives and the pinned Puppeteer patch. The recipe ran
`prepare-registry`, `stage` and `verify` with the recorded Catalog and compiler stages. The
new expansion matched `30f1ce38c58bd9752e466ae2ddf3fdaaba5aa355d371aaa77b2f267dc0721a8d`.
The independent comparison found byte-identical CLI, changelog, attachment worker, schema, guard
and runtime receipt against the previously verified complete-worker stage. The receipt SHA-256
was `7e22b591a5f63dbeece7631e96f596f89e02b324f41ebae0e3d99957c15f0830`.

The freshly built worker then negotiated public v2 with the Host and returned `waiting`. The
synthetic HOME and cwd stayed empty. The process exited 0 with both pipe EOFs, zero stderr,
zero guard denials or dispatches, and no termination or force signal. This run verifies the
isolated build and unopened StrictStart path. A selected global installation and retained-helper
lifecycle require their own acceptance evidence.

Build and verification ran in `06604d` (session `89144`). The fresh worker run `8ff990`
(session `97671`) exited zero. The reports and fresh stage are under
`/dev/shm/omp-webui-strict-fresh-replay.vt7aMf99`. The waiting result SHA-256 is
`325b14d221edfb4a31ff5688bc65e2a36b6665d9af654d74febcfaf154a4f4ca`. The temporary dependency
expansion was removed after verifying the stage.

## Ordinary public RPC observations from the earlier stage

The observations below used the earlier stage at
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

- The staged `bundle/omp --rpc-preflight` negotiated v2 and reported the expected build, patch and schema
  identities. The matched validator rejected a report with a null submission policy. Private Session admission
  remained blocked. The child exited 0 with stdout and stderr EOF, no stderr or termination, and zero guard
  denials and dispatches. Cwd and HOME stayed empty. The sanitized 726-byte result SHA-256 was
  `a40d4952ec6cc29a81a0e7561f1d60d6ade3e3d66d0f20efe8bf5797fa305d66`.

The worker accepted 1,048,576-byte physical and 67,108,864-byte reassembled frame limits with a
16,384-byte outbound command bound. These ordinary exchanges exercised small frames.
Busy-worker shutdown, contention, writes and history migration, TUI, paired DSH acceptance and the actual
global installation remain pending. [Candidate admission #41](https://github.com/HowBoring/omp-webui/issues/41)
and [supervised Session delivery #44](https://github.com/HowBoring/omp-webui/issues/44)

## Attachment preparation

### UTF-8 text

An isolated comparison used the earlier stage and the stage built at
`27978cf524b9142f8ffdd5fb50b26f7694b655e9`. The two stages had identical CLI and schema hashes.
Both runs used the same driver and a fresh synthetic profile and working directory. The driver negotiated
public RPC v2, continued the Catalog-selected Session, and prepared one `utf8` attachment.

| Stage | Receipt SHA-256 | Sanitized result SHA-256 |
| --- | --- | --- |
| Earlier stage | `9c0ae64d63cb6dffe8658d1fb593af09acab753111675cc41f4062c768131a1c` | `0be22ec3ca5e83bb04f580d6df772c9150d983925e97c1c1d96052bbd53c1097` |
| Stage with `bundle/worker.ts` | `7e22b591a5f63dbeece7631e96f596f89e02b324f41ebae0e3d99957c15f0830` | `9936410bbd2bc88307b10bddc9aa62a9c400e24cfbdffa3b4be495f09d52cbbd` |

- The earlier stage lacked `bundle/worker.ts`. `attachment_prepare` returned a failed receipt with item code
  `attachment_converter_resource_failure`.
- The stage with the worker returned a ready receipt with the exact text representation
  `Isolated attachment test.` and an empty degradation list. `attachment_cancel` returned `{cancelled: true}`.

Each run read the same seeded entry and History tree cut before and after preparation. The working
directories remained empty. Both Catalog and Session processes in each run exited 0 with stdout and
stderr EOF, empty stderr, and no termination or force. Each provider audit recorded zero denials and
zero dispatches. The retained driver SHA-256 is
`f86173833e5378526c4fa2f099d88782ff44ad4de21ebc398205cfa00891b585`.

### PNG

A fresh synthetic Session on the stage with the worker prepared a 72-byte, 2 × 2 PNG over public RPC v2.
The ready receipt contained a 591-byte, 200 × 200 PNG. The SHA-256 of the serialized representation was
`8290c8bb2f0b95d5d070becfa0f3844cf10a18a2f6eb19f2f3d258369407eab5`. The receipt reported the original
2 × 2 dimensions separately and included `image_transformed`. Cancellation returned `{cancelled: true}`.
The History tree readback matched, and the working directory remained empty. Catalog and Session
both exited 0 with stdout and stderr EOF, empty stderr, and no termination or force. Both audits
recorded zero denials and zero dispatches. The sanitized result SHA-256 was
`9a9bac04ecd54c619cace0de7e5f5878209a2952911e31af64e24257189c1179` and the driver SHA-256 was
`612dbe0e2766d64b5b51ff9dfbfd92832e80837c84d3139822e138b9a2b094c1`.

The first driver stopped after the ready receipt when its assertion expected unchanged dimensions.
That log has SHA-256 `6b914da3289e5ca707bf0d6f057c1ae29bc08806c59aa1eb46a897c952ea3640`.
The successful run used Source38's 200-pixel minimum as the expected result.

Consumption of prepared inputs, consent handling and the full attachment format matrix remain open.
[Attachment preparation #38](https://github.com/HowBoring/omp-webui/issues/38)
