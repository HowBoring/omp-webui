# Final S0 Linux evidence

`validated-linux-tuple.json` identifies the final matched source/patch/schema, compiled Host, rebuilt DSH client,
Bun and five actual Linux shared libraries. `installation-manifest.json.gz` is the exact complete operator trust
manifest (55,513 source/dependency/runtime/client/Host entries), compressed with deterministic gzip mtime0 to
keep the tracked metadata manageable. It contains metadata and hashes, no vendored source or DSH bundle.
Decompress with `gzip -dc`; its uncompressed SHA-256 is
`68494ac2de8aa62f029bae218c7c543e526f07fd2d9f9aeebceb3b033cc8133b`.
Paths are synthetic build-installation paths on this Linux fixture; this manifest is not enrollment of a user's global OMP.

`linux-browser.json` records eight final Chromium156.0.8078.79 cases against the actual compiled Bun Host and
public OMP candidate: real typed Remote/native preflight; simulated persisted-page restore; four explicitly
intercepted carrier/asset faults; two independent real browser contexts with one bounded busy result; and an
intercepted late response after generation loss. `diagnostic.png` is its sanitized final page. The actual page
contains no Windows blocker, path, private Session data or browser executable control.

`dsh-build.json` retains232 package/version/relative-input/content identities and actual served asset hashes;
`host-build.json` retains239 compiled input identities and its actual bundle digest. These came from the owned
fresh pinned DSH source checkout and a new full artifact/aggregate build. The client bytes match the previous
source build; the actual Host and candidate provenance changed, so this final browser run supersedes the helper's
intermediate tuple in apps/diagnostics/evidence/.

`native-trace.json` summarizes an actual strace of the fixed candidate: ready/negotiation/report, observed exit0,
no stderr, one execve, no Session/ordinary CLI runtime/config/lease/history write observations, and an empty
synthetic profile. Bun/OS directory/metadata housekeeping is explicitly retained in the summary. The raw trace
remains ignored with its digest; it contains fixture-only paths. No real-user profile was involved.

Earlier failed runs were not silently counted as passes: initial missing-module/candidate red tests; one incorrect
EOF-line fixture; Corepack from the wrong package cwd/missing writable cache; a concurrent browser busy result;
and two browser-harness callback/proxy-cleanup bugs. The helper's evidence README records browser chronology.
All were corrected and affected checks rerun. A first root `bun run check` invocation lacked Bun on PATH and
failed before verification; the final invocation uses the selected Bun directory on PATH.

Private Session admission stays BLOCKED. Catalog/strict continuation/expiry/preparation/receipt/history/rebuild/
security/immutable-global guarantees are future capability gates. No global OMP was installed, replaced or
validated. The owner explicitly deferred actual Windows/WSL2 acceptance until development is complete; it is
neither a current Linux completion blocker nor a claimed platform pass.
