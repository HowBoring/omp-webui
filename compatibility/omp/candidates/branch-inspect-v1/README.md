# Branch inspection v1

This unregistered source candidate covers the read-only first step of [ticket #52](https://github.com/HowBoring/omp-webui/issues/52). A `branch_inspect` request carries the protected Native Session identity (`sourceId`, `instanceId`, `nativeSessionId`) and a historical entry ID. The Native worker verifies that identity against its current protected storage and returns the selected user message's immediate native parent, a target revision and a worker-local context revision. The parent can be `null`. A sibling's selected user entry is eligible independently of the Session's current leaf.

The optional `expected` object must contain all three cut fields. It makes the same read revalidate the parent, target revision, context revision and Native idle state. Native busy checks cover admitted or queued input, unsettled work, pending UI, transitions and shutdown. Background builtins remain busy after prompt acknowledgment or abort until their tasks settle. The dispatcher retains its existing History Navigation publication fence. A stale context requires a fresh preview. Revalidation holds no reservation, so a later write capability would need to check again under its own transition fence.

The candidate returns fixed error codes for malformed input, changed or unavailable Native identity, missing or unsupported entry, unavailable parent, stale target or context, and busy state. Loss of Native storage proof during target lookup reports source unavailable. Both request and response validators bound identities and revisions and reject unexpected fields. The callback client validates the supplied parameters before dispatch, matches the response ID, Native Session, entry and any expected cut, and exposes a typed `BranchInspectClientError.code`.

## Native source overlay

`native-branch-inspect.patch` applies to the observed Source38 compatibility composition over Native base `7c49c11aa5bbaf3f418406583096168ad5b8c6dc`. It adds the normal public RPC dispatch case, Native response type, canonical wire definitions and callback client. The four added modules in the patch match the files in this candidate directory byte for byte.

The patch stays outside the active compatibility sequence. Native wire and SDK generation, matched build and source review are required before activation. The Host capability remains unavailable. Durable branch creation, verified destination publication and worker rebinding, source-addressed recovery, draft delivery and copied-entry relations remain open. Those pieces must precede browser enablement and attachment lineage recovery in [ticket #56](https://github.com/HowBoring/omp-webui/issues/56).

## Source verification

Run the two pure fixtures from the repository root:

```sh
BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 NODE_DISABLE_COMPILE_CACHE=1 bun compatibility/omp/candidates/branch-inspect-v1/branch-inspect.fixture.ts
BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 NODE_DISABLE_COMPILE_CACHE=1 bun compatibility/omp/candidates/branch-inspect-v1/branch-inspect-public.fixture.ts
```

The fixtures exercise a synthetic Native reader. The public test passes serialized frames through the same client and response handler that the patch adds. Native runtime, TUI and browser acceptance are pending.
