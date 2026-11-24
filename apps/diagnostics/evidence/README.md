# Linux diagnostic evidence — 2026-11-16

`linux-browser.json` records the successful actual Bun Host → public typed Remote
→ patched OMP preflight run and the exact sanitized native/build identities.
Chromium 156.0.8078.79, Linux x64, Bun 1.4.4, pinned DSH 38a6a5c.
The eight cases passed. The first native report and two independent browser
contexts use the real Host/candidate without intercepted responses. One context
received `verified-blocked`; the other received bounded `PREFLIGHT_BUSY`, with no
identity displayed. All cases keep Session admission blocked.

Four negative cases deliberately intercept carrier/asset responses. The final
race deliberately delays a synthetic report across loss of an actual proxied
Host `$events` connection. These establish Client behavior, not native semantics.
The persisted-page regression dispatches public persisted lifecycle events in
Chromium; it does not establish actual BFCache retention by the browser. The
page clears identity and performs another real native preflight after reload.

Reproduce after the owner builds and enrolls the complete candidate/Host tuple:

```
python tests/browser/diagnostics-browser.py http://127.0.0.1:PORT/ \
  --evidence vendor/diagnostics-browser-evidence --expected-code S0_DIAGNOSTICS_ONLY
```

The successful run's ignored artifacts are
`vendor/diagnostics-browser-run02/{browser.json,diagnostic.png}` in the diagnostic
helper worktree. The committed JSON includes their screenshot digest and Client
manifest/asset identities; the generated manifest retains all 232 package-relative
input identities. The screenshot was visually inspected and contains only the
sanitized report and missing-capability identifiers. Upstream source and generated
bundles remain ignored. Owner must rerun the harness after final Host source or
installation identity changes; these results name the tuple actually exercised.

Earlier failures remain in `priorRuns`: a concurrent run timed out under the
original single-success harness assumption, and the next run exposed a harness
WebSocket cleanup bug after passing its earlier cases. Neither is claimed as a
complete pass. The later two-browser test now explicitly establishes bounded
busy/refusal semantics, and incremental JSON checkpoints retain completed cases
if a future run fails.

Windows Chrome/WSL2 is **DEFERRED / NOT RUN** by user instruction. Real private
Sessions, product login, the global installation and full MVP acceptance are not
established by this isolated diagnostic run.
