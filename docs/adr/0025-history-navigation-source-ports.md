# ADR 0025: Isolate unregistered History Navigation behind explicit trusted ports

- Status: Accepted SOURCE boundary only; #37 has an isolated acceptance carrier, product composition unavailable
- Date: 2026-11-17
- Scope: #51 source component; ADR 0010's native persistence and generation rules remain authoritative

The integration's read-only Tree and Session supervision do not provide a committed-navigation client,
restart-capable operation metadata, or an all-holder projection owner. The reviewed navigation candidate
namespace supplies exact public client/types/validators without changing active wire/schema or capabilities.

Add only an opt-in `ompHistoryNavigationSource` Remote and coordinator. Trusted ports must supply current
authority/lifetime, matched cohort and prototype policy, joint idle, atomic metadata and structured projection
rebuilding. All capabilities are unavailable when these ports are absent. Never import Native internals,
instantiate a supervisor to discover authority, read Session files, register the service or fallback to legacy RPC.

Reserve a stable operation as unknown before dispatch. Scope/options/revisions are detached before awaits,
and one active operation per worker is acquired synchronously. Ambiguity allows explicit read-only query,
never execution replay. A metadata repository must exclude unresolved Session operations across lifetimes;
only proof of no dispatch permits the `not_dispatched` state. The source ships no durable backend.

Require an operation-bound new-generation proof from the projection owner, including coherent snapshot/live
identity and all-holder publication. Validate its public projection bindings and reauthorize the new binding.
Native committed facts remain independent of projection failure. Returned text is solely a conflict-safe,
unsent draft offer with no editor or hydration side effects.

The public Remote/generated-client fixture proves source behavior. Its authority, map, lifetime, clock and
projection proof are synthetic. It does not attest Host restart durability, actual DSH rebuilding, draft conflict
resolution, installed candidate capability or Native crash recovery. The current Source37 terminal-fault actual
remains NOT PASS. Whole #51 and the final native/browser/cohort gates remain open.

## Update: #37 isolated acceptance carrier (2026-11-19)

The same ports boundary now has an isolated acceptance carrier without becoming product composition. The Host
fixture supplies authorization, joint idle, a metadata-only in-memory repository and a fixture projection rebuild;
those adapters are labeled `fixture-adapter` and never hold a tree, messages or target snapshots. The navigation
itself runs on the real native worker: public `navigation_inspect`, `navigate_tree_committed` with native defaults,
and `navigation_query`.

Actual evidence changes the earlier "unavailable" status in two directions. Native crash recovery is now
demonstrated: after a committed reply and a kill with no new prompt and no exit marker, a fresh worker reads the
same committed leaf and query returns the same commit; a kill at the receipt append leaves one durable `reserved`
record with unresolved persistence and an unchanged position; a refused receipt write leaves unknown persistence
with a sticky unreadable source; cancel, invalid target and normal exit are distinct. The real matched TUI renders
only the recovered branch, and the installed baseline refuses the candidate carrier without rewriting it.

What remains open is unchanged product work: a Host-owned durable repository across Host restarts, a real
all-holder projection handoff, draft conflict resolution in the TUI, long-history performance, Windows, and product
admission. The repository on this carrier is still not disk durability, and the projection proof is a fixture
rebuild over the real native tree. See [ticket-37-durable-navigation.md](../evidence/ticket-37-durable-navigation.md).
