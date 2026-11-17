> Historical/source selection from external `bcbc30e9532e404fb27fc63ceb85c07de335c46f`. Results and review claims below apply only to their original artifacts. This new H/P/external composition is unregistered and requires fresh paired review; see [ADR 0027](../adr/0027-unregistered-external-protector-composition.md). No actual runtime or admission proof is supplied.

# Ticket 41 uncertain external raw control close

Status: **SOURCE/PURE/TYPES ONLY; fresh independent paired review pending.** This narrow fix preserves external
history at base `285eeb8ee9badf7964dd3a3867815791bba59131`; it does not normalize onto integration. The source frontier
still requires reviewed composition of current H delivery, public control I/O and private-helper ownership before
external integration. Whole #41/#61 and private/product admission remain open/blocked.

If `openControl` throws after spawn, the controller still holds the raw control descriptor. Previously, a throwing
raw close left its callback installed. Public `disconnectControl()` and the completion rejection callback retried
that numeric descriptor, potentially closing an unrelated descriptor after reuse. The new regression observed
**five** fake close attempts for fd17, where only one is safe: **37 pass, 1 fail, 196 assertions**.

The fix consumes the callback before one close attempt, matching the stronger public P controller's existing
contract. A throwing close preserves sticky unresolved ownership and the original retained child exit. The public
test checks the unchanged finite startup error and cause, withheld registration admission, pending completion before
original reap, successful direct reap 0 followed by unresolved completion, and repeated disconnects before and after
reap without another close attempt. No internal controller access or actual descriptor is involved.

The identical controller command then passed **38 tests / 196 assertions**. The scoped five-file pure selection
passed **58 tests / 277 assertions**, including existing clean EOF, ROOT_EXIT readiness, registration, START and
direct-reap behavior. The unchanged stronger public P controller and owned-control-I/O fake suites passed
**23 tests / 96 assertions**. Full `tsc --noEmit -p tsconfig.json` passed using existing dependencies. Builder refusal
tests, C compilation and actual runtime tests were not run. Original execution objects, including the TypeScript
session 37463 and its final exit 0, are retained at `/tmp/ticket-41-external-raw-close-tool-results.json`; identities,
commands and SHA256 are recorded in [the structured evidence](ticket-41-external-raw-close.json).

Nine existing C/build/fixture digests exactly match prior clean-EOF evidence. Public P remains clean at
`a259d6cfcffbcb967124d57a733fbff07305e765`, tree `4550fc1b87981f1d89bcfc2f603e112b4d9bfd38`; lead H remains clean at
`bb607004a391247981e7fced92cf5fcbc09e3bbe`, tree `d22d5ffd170bdb28905114e5a8b57710fd6d44ce`. All 109 source input
hashes in `/tmp/native-helper-drain-r9-20261117/source-inputs.json` matched its frozen values before and after this
change; that manifest remains SHA256 `4cd814d541bf19f22092d0647a5c3ba69f8b69a80bdee7fc181242a2b99e25d7`.
Only explicitly listed input bytes were hashed; private operator key files were not read. No stage files changed.

These are controlled adapter checks, not actual descriptor-reuse, kernel, authentication, descendant-drainage or
Native proof. No Native/OMP/SDK/FFI, actual helper/worker/thread/socket, C fixture, browser/provider, build/ELF,
signal/probe, key/fence, staging, integration merge or push action occurred. Fresh paired review is the next gate;
this fix neither broadens actual execution authorization nor clears the whole-cohort source hold.
