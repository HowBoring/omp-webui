# History Navigation SOURCE Remote

This opt-in source component exposes `ompHistoryNavigationSource/action` through the public DSH Remote.
Nothing imports or registers it in the product Host, UI, plugin roster or package entrypoints. Tree selection
continues to use the separate read-only Tree component. There is no legacy navigation fallback.

The test seam is the agreed public DSH Connection/Remote → Gateway → service → actual generated
`NavigationClient` callback/schema boundary. Native DTO replies and all authority, clock, metadata and
projection-owner implementations in the tests are synthetic fixtures. No Native process or browser runs.

## Required trusted ports

Without the complete constructor ports the capability is unavailable. A future composition must supply
current browser/grant/directory/native identity and worker authority, a synchronously revoked lifetime,
the actual generated client, independently matched cohort identity and the candidate navigation policy,
the exact worker/Broker `StopSnapshot`, atomic operation metadata, and a real projection owner.
Policy is explicitly `prototype`, `process-crash-only`, `read-only-no-execution`; schema validity is not
runtime admission. Source37's current terminal-fault actual remains **NOT PASS**, with earlier failures
and unresolved manual accounting retained. The candidate contract is not an installed capability.

`inspect` is a native read, not Tree selection or mutation. It mints at most eight globally outstanding
30-second peer-owned confirmations, each with a distinct stable navigation key. It fixes native-default
options and both native revisions, and returns the native parent plus the external-effects notice.
No browser input can supply trusted scope, revision, summary options or arbitrary RPC. An explicit action
while busy receives no confirmation. A busy observation clears old confirmations in every View of that worker.

`confirm` consumes the token before awaiting anything. It snapshots scope, policy, options and revisions,
requires joint idle and atomically excludes another operation for the same worker before awaiting metadata.
Busy requires a separate Stop, confirmed quiet and a new inspection/action. Nothing Stops or queues work.
Authority and idle are rechecked immediately before dispatch. The native server must still atomically
reject a stale revision or native admission race. A token expiring during metadata persistence is refused.

## Metadata and ambiguity

`reserveUnknown` must atomically and durably record unknown **before** allowing the only native dispatch.
It must refuse an existing key, any unresolved operation for the same full native Session identity across
worker/Host lifetimes, and capacity above `min(256, policy.maxOperations)`. The repository may retain only
operation identity, matched cohort, scope, target/revisions/options, outcome and commit/position identifiers.
It must not store editor text, messages, history bodies or a second tree. `recordResult` must preserve
immutable committed facts. `not_dispatched` is allowed solely when this coordinator has not called the
client; an uncertain repository update keeps the previous unknown record and blocks later mutation.

No repository implementation is provided. The map retained across service recreation in one test is a
synthetic port demonstration, **not disk durability, Host restart or product recovery evidence**. Missing
storage fails closed. A real restart-capable backend, transaction/retention policy and manual operation
discovery are outstanding Host work. The confirmation exposes its stable key before submission so an
uncertain metadata write can still be queried explicitly when that record is readable.

Lost replies, post-dispatch cancellation, worker loss, invalid schema, mismatched target/origin or inconsistent
facts stay unknown; neither absent nor reserved permits resubmission. `query` reads the existing metadata
and performs only the generated `navigation_query` under renewed exact native/cohort authority. It accepts
a replacement worker without replay. It cannot create an operation or query an arbitrary unrecorded key.
Prior committed receipts remain immutable even when later legitimate appends change the current context.

## Projection and drafts

Before possible native effects, the owner must synchronously withdraw the old generation from **all**
holders, reject retired writers and old pages/frames, and preserve independent drafts and valid Interactions.
This invalidation also covers failed/cancelled native outcomes, uncertainty and explicit recovery queries.
The owner must rebuild from a coherent native active snapshot/live handoff under the same Session ID.
The service requires an operation-bound structured proof with old/new public projection bindings, a new
generation under the same source, snapshot/live identifiers, all-holder publication and retired-writer rejection.
It also reauthorizes the newly published generation. Returning `true` cannot attest success.

The source has no real all-holder projection owner. The test proof is synthetic; it does not prove actual
DSH holders have withdrawn rows or rebuilt. Native `outcome`, `persistence`, `commitId` and `actualLeafId`
remain separate from `projection`. A rebuild/storage failure never erases a committed native receipt and
never triggers another dispatch. Failed/cancelled outcomes can carry committed effects; do not label them
successful navigation. Only the full validated committed outcome/reservation/persistence and position tuple
attests native success within this candidate's explicitly limited durability policy.

Inline returned text is only a `ConflictSafeDraftOffer`: explicit user choice, never overwrite or send,
no Original renewal, and attachment originals explicitly unavailable. There is no editor write/storage/send
port. Reference-only drafts stay explicitly unavailable. Authority loss while awaiting rebuild withholds text.
Actual #57 provider/atomic editor conflict handling, newer/existing/frozen per-tab drafts, Original association
and real browser behavior remain separate integration work. This source contract cannot renew the 24-hour clock.

Whole #51/#29 remain open. UI confirmation/rendering, real Host ports and matched Native/DSH cohort,
all-view rebuilding, no-prompt/no-exit crash/reopen, persistence/lost-reply faults, TUI/native compatibility,
platform and long-history performance evidence are still required. No global/private/product admission follows.
