# Operations — running the validated OMP WebUI combination

This page is the operator runbook for the combination frozen in
`docs/evidence/ticket-61-freeze.json`. Everything below was executed on Linux (WSL2) with the
recorded identities; the Windows-browser half of the story is covered in
`docs/evidence/ticket-61-platforms.json`.

## 1. Prepare (once per checkout)

```bash
bun install --frozen-lockfile
DSH_SOURCE=vendor/dsh DSH_STORE_DIR=$PWD/vendor/pnpm-store \
  fnm exec --using=24.22.1 -- bash scripts/prepare-dsh.sh   # DSH source + patched build inputs
bun run compat:prepare                                       # OMP source at the pinned base
bun run compat:build                                         # bundle candidate + schema
bun run dsh:link && bun run product:build                    # Client assets
bun run product:verify                                       # re-derives the bundle from source
bun run product:enroll                                       # writes vendor/product/installation.json
```

`product:verify` fails with `PRODUCT_BUNDLE_SOURCE_MISMATCH` when the enrolled bundle no longer
matches its source; re-run `product:build` and `product:enroll` rather than editing identities.
Re-enrolling changes the manifest digest (`docs/evidence/ticket-61-freeze.json` records the digest
this evidence was taken with).

## 2. Start the Host

```bash
export OMP_WEB_MANIFEST=$PWD/vendor/product/installation.json
export OMP_WEB_LAUNCHER=$PWD/vendor/omp-candidate/omp
export OMP_WEB_MANIFEST_SHA256=$(sha256sum "$OMP_WEB_MANIFEST" | cut -d' ' -f1)
export OMP_WEB_PORT=3180                  # default; loopback only
export OMP_WEB_ORIGIN=http://127.0.0.1:$OMP_WEB_PORT
export OMP_WEB_DATA_DIR=$HOME/.local/share/omp-webui   # access db, attachments, index, ops log
bun --no-env-file apps/host/src/main.ts
```

The Host binds `127.0.0.1` only. `--print-bootstrap` prints one login link and exits; if admission
is blocked it exits 1 with `{"code":"PRODUCT_BOOTSTRAP_BLOCKED","reason":…}`. Read the reason; do
not bypass it.

## 3. Log in and grant a directory

1. Open the printed `http://127.0.0.1:<port>/?bootstrap=…` link. It is single use.
2. Browser authorization is absolute: 30 days at the same origin **and** data directory
   (`packages/access/store.ts:7`). Refreshing or opening a second tab never extends it.
3. Type the canonical working-directory root into *Directory to authorize*, press *Review
   directory*, then *Grant this directory and descendants*.
4. *Refresh grants and catalog*, then *New Session here* (or open a catalog Session). Attachments,
   drafts and prompts only become available after a native identity is confirmed.

## 4. Manual recovery

| Situation | Action |
|---|---|
| Worker died / outcome unknown | The attempt stays explicit; use *Refresh worker* or *Recheck this Session*, then decide. Nothing is replayed automatically. |
| Session occupied by the native TUI | The catalog shows metadata only until that owner exits; then *Recheck* and open. |
| Attachment preparation failed | The draft is retained and prompt admission stays blocked until the file is removed or accepted. |
| Stale page after a branch or projection rebuild | Reload the page; the projection is rebuilt from native facts. |
| Access lost | Re-run `--print-bootstrap` for a fresh link. |

## 5. Revocation and shutdown

* `kill -USR1 <host pid>` revokes **all** browser authorizations (`apps/host/src/main.ts:69`). Open
  pages fall back to 401; previously issued bootstrap links stop working.
* *Log out this browser* revokes one browser's credential and its tabs.
* `SIGTERM` drains owned processes and reports what actually exited; it does not wait on elapsed
  time. A forced worker kill is a separate, explicit operator choice.

## 6. Original cleanup

Originals live under `<data>/attachments` in private storage with display-only filenames.

* Unreferenced unsent originals become eligible 24 h after the last explicit edit or active
  renewal; committed originals attached to native input do **not** expire on time.
* Reference-protected originals survive ordinary cleanup; the attachment budget is 10 GiB /
  100000 objects / 16 MiB per object.
* A full budget rejects new intake; free space deliberately. Deleting an original lists known
  impacts and needs confirmation, and never rewrites native messages or saved model input.

## 7. Upgrade / rollback

1. Build and enroll the new combination as in §1, then run `product:verify`.
2. Run `bun test tests/product/freeze.test.ts` — it fails when the enrolled installation and the
   frozen identities diverge.
3. Validate current native data with the new build before relying on it: open a representative
   Session in the native TUI and in the WebUI, on **copies** of real data or on synthetic data.
   `tests/continuation/native-data.py` is the harness for that check.
4. Incompatible or changed installations must block Session admission; re-enroll rather than
   editing identities or Session files.
5. Rollback means re-launching the previous enrolled combination after the step-3 check. Older
   builds may open newer data append-only (lossless resume) or refuse it; there is no automatic
   downgrade and the Host never rewrites native history.

## 8. Known gaps

* Public distribution and automatic update are out of MVP scope (spec *Out of Scope*). The unwired
  inventory module `packages/delivery/gate.ts` still reports `blocked` /
  `GLOBAL_TARGET_NOT_SELECTED`; installation is reproducible from source instead
  (`bun run product:build && bun run product:verify && bun run product:enroll`).
* Real model-provider inference is out of scope for every recorded product run; the controlled
  provider is always labelled `realProviderInference: false`.
* Windows input (keyboard, menus, paste, drop) was **not** executed on this combination; see
  `docs/evidence/ticket-61-platforms.json`.
