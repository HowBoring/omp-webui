# Final release record — validated combination

Status of this record: **combination validated for build/verify/enroll, the Linux product flow
and the final-tuple performance gate; installation reproducible; no public distribution.** Decision 4's auditable deltas plus immutable build/schema/asset identities are
recorded and drift-tested here; the automatic update/distribution framework is out of MVP scope, so
the unused inventory module `packages/delivery/gate.ts` (only caller `scripts/inspect-delivery.ts`)
keeps reporting `blocked`/`GLOBAL_TARGET_NOT_SELECTED` and nothing here claims a released package.

## The combination

| Part | Identity |
|---|---|
| Host source | `mvp/spec-29-review-stock` @ `5c4eebe05411ce761c4452dbe917ed14f1a7daab`; product entry `apps/host/src/main.ts` |
| Host runtime | bun 1.4.4, sha256 `10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235` |
| OMP base | `57771ae562b9345e0579bceb2d68d585e3e6927e` |
| OMP source / patch / schema | `fbe8188cb6d7fc55680dd7c41f3f456122169d7c7a652df335cb11c14dcd86ae` / `ec7bb9c8b255725fbc628664f807376dfd3c172bd75fa515928f9e1c817f83d1` / `bf29808523c0d3217729b1398c1fa7932f45c5f9298a49f713f2386bec9fbfc2` |
| OMP launcher | `vendor/omp-candidate/omp` → `cli.js` (identity in the installation manifest) |
| DSH base / source tree | `38a6a5c965aa99ab525161efb7cc5cf1fe62fced` / `f5cc084f803a001930f8d1c6fa1abba5bd78e08f`, 11 pinned patches (includes `0013` checkout-relative CSS-module hashing) |
| DSH client | Stock DSH release `0.1.0` @ `f5cc084f…` served from `vendor/dsh-product`; boot graph rev `1d19a9695e2d`, roster 34 entries (33 DSH packages + `@omp-webui/product-enrollment`), 136 assets sha256 `efae7cbebff1b1e7aa010325e099a481812d5243dcb3bfd146ad320383b46908`; `index.html` `0aa1ab0f1bab550a2d730b9d85401a361a19efab508c1c9664d8cf45f244fb7e`; no `/client.js` |
| Installation manifest | `vendor/product/installation.json`; the gate compares the checkout-canonical digest `aae65242822552be450d340acaf0e6e2bc9bc67f1f7b3690f8b18f17e9113da8` (the raw file also carries this checkout's paths, so its own sha256 is per-checkout and not a release identity) |
| Platform | Linux (WSL2) x64 `127.0.0.1` loopback, Linux Chromium 157.0.8103.38; Windows Chrome Dev 160.0.8171.0 is available but the #63 stock-shell browser rerun is not in this record |
| Previous build (rollback) | `@oh-my-pi/pi-coding-agent@18.20.2`, `dist/cli.js` sha256 `648be0034d37318687525546dcbef0bd1596dda87d008cc14fecc801c821ac76` |

The performance corpus is frozen separately: `tests/product/evidence/performance-corpus-2026-11-22.json`
records the seed `omp-webui-s5-performance-v1`, the generator digest
`33626c5d…20dcd3`, the catalog identity `88143d46…35063b` (1000 native Session files) and the history
identity `55f7bca1…54dcd` (10000 entries). Ids and timestamps are pinned; each Session's cwd is the corpus
project directory, because the gate grants exactly that directory and the product lists only granted
directories. Recorded identity fields (`canonicalFilesSha256`, `canonicalBytes`, `canonicalSha256`) replace
that path with `<corpus>/project`, so two generations in different directories agree, while `bytes` and
`sha256` report the actual serialised payload of the corpus as written. A seed is only comparable against
the same generator digest, and `createdAt` records when a corpus was made; corpora generated before this
canonicalisation are superseded.

Full machine-readable identities, keymap chords and budgets: `docs/evidence/ticket-63-freeze.json`.
`tests/product/freeze.test.ts` fails if the enrolled installation drifts from that record. The gate
canonicalizes checkout paths, so the same closure enrolls in any worktree without weakening the pinned
source, patch, schema or asset identities: system dependency paths reduce to their basename, and the
content identity and byte count of every archive entry must still match, so a foreign closure with the
same file names fails.

Reproducing this tuple needs the recorded native closure (`stage-strict-runtime.py`, recorded as
`enrolled: false` in `docs/evidence/ticket-41-navigation-roster.json` because `vendor/omp-strict` holds only
the installed validators). `.github/workflows/check.yml` pins `ubuntu-24.04`, stages the continuation
fixtures, the navigation pins and the enrollment, and runs the full provisioned suite. The one narrowing is
explicit: `tests/product/freeze.test.ts` is the only test held out of the general suite, because it asserts
this checkout's native closure equals the recorded tuple. It runs in its own step instead: with the
recorded closure provisioned the step requires the gate to pass, and without it the step requires the gate
to reject, so a foreign runner reports the expected rejection and stays green without erasing an identity
or claiming tuple reproduction, which remains local.

## What was executed on this combination

| Area | Result | Evidence |
|---|---|---|
| Build → verify → enroll | PASS (`product:verify` `{"status":"verified","files":136}`; installation `289e94d2…f649d4`) | `ticket-63-freeze.json` |
| Frozen stock-shell composition | PASS: 10/10 freeze tests, roster 34, stock assets 136, no custom `/client.js` | `tests/product/freeze.test.ts`; `ticket-63-freeze.json` |
| Linux product flow on the stock DSH shell: model/thinking, preferences reload, explicit continue, new native Session, Stop, send after Stop, Enter/New Session, draft reload, unsupported attachment refusal, PNG+TXT send, byte-exact Originals, and the retained 200×200 image rendered as a stock `<img>` after reload | PASS: 10 scenarios, 25 s, zero console errors | `docs/evidence/ticket-63-product-flow.json`; `tests/product/product-flow.py` |
| Linux Host start, bootstrap admission, assets, revoke-all | PASS | `docs/evidence/ticket-59-platforms.json` `linux` |
| Windows Chrome (real Win32 browser) stock-shell shell/admission/input | NOT RERUN for #63; the recorded Windows evidence belongs to the superseded #61 custom-shell tuple and is not a claim about this composition | `ticket-61-windows-chrome.json`, `ticket-61-windows-input.json` |
| Native TUI/history/upgrade/current-data rollback on isolated data | PASS on the same OMP base (shell-independent); not rerun in this session because `vendor/omp-previous` is not provisioned in this worktree | `docs/evidence/ticket-61-native-data.json` |
| Performance (3 s / 1 s / 512 MiB) | PASS: 30 samples on the restart-auth tuple — first page P95 968.1 ms, old page P95 382.2 ms, Host peak RSS 248.4 MiB, reachability complete | `tests/product/evidence/performance-2026-11-23-product.json` |
| Public distribution / automatic update | out of MVP scope | spec *Out of Scope*; `packages/delivery/gate.ts` is unwired |
| Maintainer operational acceptance | NOT RUN | `ticket-61-acceptance.md` checklist |

The performance artifact was produced on the final restart-auth tuple (installation manifest
`289e94d2…f649d4`, source tree `f5cc084…e08f`) by the unchanged gate: 30 samples, 4 of 20 processors by
affinity (`taskset`), a hard `MemoryMax=8 GiB` cgroup, 31 first-page values — the 30 measured reloads plus
the cold open (18784.0 ms), with two warmups discarded — reachability 49 steps / 12783 nodes with
`allNativeReachable: true` and the duplicate-preserving reset check intact, and
`BLOCKED_CLASSES=[] REACH_FAILED_CLASSES=[] FAILED_CLASSES=[]`. It is not 4-vCPU hardware and not a
different machine, and it is only valid for the recorded corpus identity in
`tests/product/evidence/performance-corpus-2026-11-22.json`.

## Known limits

* One supported combination only. Upgrading OMP, DSH or runtime means re-enrolling and re-running
  this evidence; incompatible installations must block admission, not degrade.
* The controlled provider (`compatibility/omp/fixtures/live-provider.ts`) is not real inference.
* Native data evidence uses synthetic isolated Sessions; real user history is never migrated or
  rewritten by tests.
* The recorded Windows browser evidence predates the #63 stock shell: it is real Win32 Chrome over CDP
  against the superseded custom-shell tuple. The stock-shell Windows shell/admission/keyboard rerun is
  still required before #63 acceptance; OS clipboard paste and Explorer-originated drag need a visible
  Windows desktop and are not claimed.
