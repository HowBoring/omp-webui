# Ticket 32 strict continuation candidate

This is an isolated component review candidate. Product Session admission remains blocked pending the complete #41/#43/#44 gates. The protocol policy remains marked prototype pending independent review; this report does not approve the storage format for general deployment.

The implementation uses the actual authored native CLI, wire/schema/client/server and native persistence, with a real Bun Host and typed DSH acceptance page. Continue preserves the selected native ID and physical carrier through real exclusive ownership and every storage critical section. Explicit New has a separate public intent and native identity. Host never parses or repairs native Session files.

## Acceptance evidence

| Ticket acceptance criterion | Actual boundary and evidence |
| --- | --- |
| Preserve source/instance through acquisition and first write | Native pinned root/parent/cwd/carrier fds, actual exclusive lock, bounded native-ID checks, guarded EOF/control writes and source-binding refresh; ownership/startup-order/fault suites include first-write and commit namespace swaps and in-place native-ID replacement. A lease probe is never accepted as ownership. |
| Races, copies, replacement, missing, unknown owner | Two actual rpc-ui workers contend; missing physical selection cannot pick a same-ID sibling; hardlink alias is catalog partial; real AF_UNIX EMFILE is unknown. No fallback, forced takeover, backup guessing or foreign TUI termination. |
| New versus Continue and public identity | Actual `strict_start`, `get_strict_state`, same-source generated validators/client and typed Remote show intent, binding, native ID and cwd; successful continuation preserves existing entries, explicit New has a fresh UUID. |
| Success, conflict, cancellation and unknown result through typed page | Chromium → real DSH Remote/Connection → Bun → public strict rpc-ui. Browser cases cover identity/reload/repeated Continue, actual ordinary native owner, cancellation, dropped successful startup reply with read-only recovery, and explicit New. The Host retains an observed dead-worker/unknown outcome without replay. |
| Native data and TUI still read and continue | Actual matched PTY reads, rename/continue, tree/navigation and logical render; actual baseline TUI refuses `ompgen1` unchanged; guarded flattened export opens/continues/renames in baseline TUI. Full/stream/header, FileStorage and >=8MiB paths share the resolver. Native New/fork/branch/copy handles genuine nested generation children with guarded complete fresh publication. |

The native generation adapter preserves the carrier inode. Immutable native JSONL generations and bounded authenticated metadata are referenced by fd xattr head and appended commit controls. Seven-byte format detection prevents ordinary copies losing both controls from silently looking like stale legacy history. Catalog authenticates only bounded winning-prefix metadata; full loaders verify complete bodies. Committed missing/corrupt state is an error, incomplete markers retain the previous committed read cut and refuse writable continuation. Short format conversion is incompatible/indeterminate. Crash/short-write tests exercise actual owned syscalls, retaining prepared controls; no automatic repair/replay occurs.

## Checks

The reviewed defects are corrected on native source `2ead29a974d7b1a85d97e27575cacd80bc1f917d348012daa108ff3071192661`; exact source/build/schema, assets, fixture and evidence digests are recorded in `ticket-32-checkpoint.json`. The original held candidate remains unchanged. See `ticket-32-review-fix.md` for each finding and its red→green evidence.

- Owned clean ordered 0001–0006 application, compatibility build and generated `--check`: PASS. Native 0006 remains byte-for-byte unchanged; schema remains `ed446d…`.
- Final root TypeScript, focused authored native strict/live TypeScript, and separate Host build: PASS.
- Complete `bun run check` attempt: **FAIL**, 255 tests PASS / one test-controller failure / 2,023 assertions across 59 files in 576.03 seconds. An exiting native thread disappeared between syscall-info and GETREGS, yielding ESRCH in the parent-open EMFILE test controller. The full attempt and digest are retained; this is not a complete-suite PASS.
- After the controller-only correction, actual factory/OS publication faults: **PASS**, 14 tests / 78 assertions. A vanished tracee cannot satisfy fault injection: the controller requires the intended directory syscall to complete, and the EMFILE case requires the actual -24 result, native EMFILE error, real lease reacquisition and unchanged owned descriptor inventory. Native source was unchanged.
- Final matched/baseline native TUI: **PASS**, three tests / 24 assertions, including genuine TUI ownership exclusion and conditional flattened rollback.
- Final Chromium → DSH Remote/Connection → Bun → public native RPC: **PASS**, five cases / 21 typed Remote calls / no page errors, Chromium 156.0.8078.79. Structured results: `ticket-32-browser.json`; final screenshot is ignored and its digest is in the checkpoint. The existing tracked PNG is historical previous-candidate evidence.
- Final native `strace` title publication/reopen and nested logical copy: **PASS**, two tests / 21 assertions; zero INET calls, 103 fd-xattr calls, six native control writes and two no-clobber fd-bound links. Structured digest report: `ticket-32-native-syscalls.json`.

An early browser attempt preceded listening during the 77,524-asset provenance check and returned connection refused; the final run followed the ready announcement. One synthetic fixture-authoring attempt in the restricted sandbox hit Bun stdio EPERM and passed in the required network-enabled sandbox. All native test fixtures were synthetic and temporary. Final active owned native/browser workers: zero. The fixture Host exited on SIGTERM and its catalog child is absent; its PTY launcher had orphaned the Host, so a terminal zombie remains for PID1 to reap, with no live CPU/fds.

**Closure remains blocked** until fresh review and the integration merger's next complete matched `bun run check` are green. Per coordinator, the full suite was not repeated here after the isolated controller correction. Product admission remains blocked.

## Limits and conditional compatibility

Linux x64 on the tested filesystem only. Real fd xattrs, O_TMPFILE and fd-bound linkat are required; unsupported platform/filesystem fails closed. Windows/WSL are unverified. This is process-crash evidence, without fsync/power-loss or hostile same-UID integrity/availability claims.

128MiB logical body, 256MiB carrier, 512MiB actual retained immutable files, 64 generations and 128 generation-directory entries are enforced before unsafe publication. Catalog has explicit additive bounded control/winning-prefix budgets. There is no unsafe generation GC. Generic generation maintenance delete/move/strip/compress/unpack replacement refuses or opportunistic GC skips; nested extended archive pack currently refuses. Parent-only guarded flatten export, normal continuation, title, New/fork/branch/copy are supported within bounds. A whole multi-file fork is not a durable protected-branch receipt; future branch work owns that transaction.

0005 currently performs a complete validated logical read/hash for append size accounting. Broad large-session append/submission throughput has NOT passed here. #36 owns the additive protected append/control codec and validated accounting cache in 0007; #41 must rerun affected strict faults and scale on that composition. `logicalDelta:0` must never bypass physical/control/provenance budgets.

Rollback requires successful guarded native flatten export, exclusive access and baseline reader proof on the export. Copying the physical carrier or reinstalling an old binary is not rollback. The original carrier stays unchanged during export. Native-only explicit investigation is required for incompatible/indeterminate prepared state; Host never repairs it.

See `compatibility/STRICT-CONTINUATION.md`, `compatibility/CATALOG.md` and ADR `0013-strict-native-generation-publication.md` for format, budgets, ownership and rollback details. All fixtures use explicit synthetic profiles/home/cwd, allowlisted environments and pre-import provider guards; no real external inference or real user data.
