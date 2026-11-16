# ADR 0016: Exhaustive release inventory and coordinated ordinary entry

- Status: Implemented for isolated preparation only; product/global admission BLOCKED
- Date: 2026-11-16
- Ticket: [Candidate combination/global gate #41](https://github.com/HowBoring/omp-webui/issues/41)

ADR 0008 requires the actual ordinary global installation and one matched supported combination. ADR 0011's
project-relative diagnostic enrollment does not establish that identity, completeness or lifetime stability.
No actual owner-selected global entry is available here, and final native/DSH composition is not frozen.

Add a separate explicit-root, exhaustive release inventory with mandatory independent operator SHA256. Required
component directories reserve worker/runtime/native/Host/client/contracts/provenance closure. The format is
literally `unaccepted-artifact`; filesystem completeness does not imply bundler/deferred-load completeness,
publisher trust, native semantic evidence, final tuple identity or actual-global scope. Existing diagnostic CLI
also requires independent `OMP_WEB_MANIFEST_SHA256`, and its server must preserve supplied trust rather than
replace it with a mutable manifest-derived digest. Explicit isolated fixture callers remain distinguished.

A narrow resolver accepts a canonical direct ordinary entry or direct link to the inventoried entry, rejecting
unknown shims without execution. A preparatory Linux cooperative maintenance mechanism pins an outside control
inode, acquires shared/exclusive flock nonblockingly, and checks fd/path identity. A small reviewed static C
ordinary entry takes the same shared lease before same-PID exec into packaged Bun and native target. This covers
normal TUI and Host entry paths in the proposed layout; no extra production Agent or opaque shell parser exists.
Correct explicit Bun config spelling and injection-env refusal constrain startup inputs. The complete contract,
limits, tests and unsupported cases are in [packages/delivery](../../packages/delivery/README.md).

This mechanism supports only a coordinated operator installation policy. It does not freeze arbitrary writable
package-manager installations, prevent malicious same-UID/root mutation, or settle future Native child/shared
service ownership. Source-only Native ownership work remains a separate unimplemented public-contract decision.
A worker-held fd alone cannot protect release loads by surviving descendants/shared services. Until those
lifetimes, external runtime libraries, complete native/DSH semantics, TUI/current-data rollback and actual global
selection are proven together, no lifetime/cleanup/global capability or private Session admission is granted.
