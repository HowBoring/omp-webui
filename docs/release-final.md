# Final release record — validated combination

Status of this record: **combination validated, installation reproducible, no public
distribution.** Decision 4's auditable deltas plus immutable build/schema/asset identities are
recorded and drift-tested here; the automatic update/distribution framework is out of MVP scope, so
the unused inventory module `packages/delivery/gate.ts` (only caller `scripts/inspect-delivery.ts`)
keeps reporting `blocked`/`GLOBAL_TARGET_NOT_SELECTED` and nothing here claims a released package.

## The combination

| Part | Identity |
|---|---|
| Host source | `mvp/ticket-61-delivery` @ the merged integration tip; product entry `apps/host/src/main.ts` |
| Host runtime | bun 1.4.4, sha256 `10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235` |
| OMP base | `57771ae562b9345e0579bceb2d68d585e3e6927e` |
| OMP source / patch / schema | `66552c62…cb551` / `265e1741…7f1d23` / `bf298085…9fbfc2` |
| OMP launcher | `vendor/omp-candidate/omp` → `cli.js` (identity in the installation manifest) |
| DSH base / source tree | `38a6a5c9…2fced` / `52c982f3…6d0309`, 7 pinned patches |
| DSH client assets | `client.js` `4884905c…dd45d9`, `index.html` `f19cdbe5…ba7315` |
| Installation manifest | `vendor/product/installation.json` (raw sha256 `d5f48716…a9ee924`; freeze gate compares the checkout-canonical `5796b8e4…cf5b93ba`) |
| Platform | Linux (WSL2) x64 `127.0.0.1` loopback, Linux Chromium 157.0.8103.38; Windows Chrome Dev 160.0.8171.0 for the browser half |
| Previous build (rollback) | `@oh-my-pi/pi-coding-agent@18.20.2`, `dist/cli.js` sha256 `648be0034d37318687525546dcbef0bd1596dda87d008cc14fecc801c821ac76` |

Full machine-readable identities, keymap chords and budgets: `docs/evidence/ticket-61-freeze.json`.
`tests/product/freeze.test.ts` fails if the enrolled installation drifts from that record. The gate
canonicalizes checkout paths, so the same closure enrolls in any worktree without weakening the pinned
source, patch, schema or asset identities.

## What was executed on this combination

| Area | Result | Evidence |
|---|---|---|
| Build → verify → enroll | PASS (`product:verify` `{"status":"verified","files":4}`) | `ticket-61-freeze.json` |
| Linux Host start, bootstrap admission, assets, revoke-all | PASS | `ticket-61-platforms.json` `linux` |
| Linux product flow: new native Session, live attach, send/stream, Stop, retry, keymap chords | PASS | `ticket-61-platforms.json` `linux.productFlow`; `tests/product/product-flow.py` |
| Windows Chrome (real Win32 browser) shell, admission, console | PASS | `ticket-61-platforms.json` `windowsChrome` |
| Windows input (keyboard, menus, file input) | PASS; CDP drop not surfaced, OS clipboard/Explorer drag unavailable | `ticket-61-platforms.json` `windowsChrome.inputInjection`; `docs/evidence/ticket-61-windows-input.json` |
| Native TUI/history/upgrade/current-data rollback on isolated data | PASS, 6/6 checks | `ticket-61-native-data.json` + `.md` |
| Performance (3 s / 1 s / 512 MiB) | PASS on the source-identical #60 build | `tests/product/evidence/performance-2026-11-22-product.json` |
| Public distribution / automatic update | out of MVP scope | spec *Out of Scope*; `packages/delivery/gate.ts` is unwired |
| Maintainer operational acceptance | NOT RUN | `ticket-61-acceptance.md` checklist |

The #60 performance artifact is recorded against a build whose source/patch/schema and DSH assets
are identical to this one; only bundler comment paths and the content-derived chunk filename differ,
so the thresholds carry over while the artifact digests do not.

## Known limits

* One supported combination only. Upgrading OMP, DSH or runtime means re-enrolling and re-running
  this evidence; incompatible installations must block admission, not degrade.
* The controlled provider (`compatibility/omp/fixtures/live-provider.ts`) is not real inference.
* Native data evidence uses synthetic isolated Sessions; real user history is never migrated or
  rewritten by tests.
* The Windows browser half is real Win32 Chrome driven over CDP. Its keyboard, menu and file-input
  paths are PASS; OS clipboard paste and an Explorer-originated drag need a visible Windows desktop
  and are not claimed.
