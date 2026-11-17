# WebUI preferences: first ticket 49 source slice

`WebPreferences` implements the existing public DSH `settings/describe` and
`settings/mutate` contracts for `ui-theme.preference` and `locale.preference`.
It returns real service state, requires each namespace's current revision,
checks live browser authority independently of the DSH owner principal, and
publishes the existing `settings/document-updated` event after a successful edit.
Unknown namespaces/fields, malformed values and stale/unconditional writes fail.
Theme supports light/dark/system; clearing locale delegates selection to the browser.

The Host contribution mounts only these two existing descriptors. It does not
mount stock `SettingsController`, which also registers credentials and opens a
native configuration document. `update`, `replace`, document open, credential
operations and global provider/plugin administration have no implementation here.
The owner must supply a synchronous authorization callback that checks the current
Host browser credential. DSH's owner principal alone does not provide that check.

This is production source, unregistered in any product server. State currently
lasts for the service lifetime. Restart persistence, persistent revision/epoch,
actual browser rows/shortcuts, forwarded event delivery across Browser Views,
auth carrier wiring and real Linux product behavior remain unverified. No runtime,
Native, SDK, Agent, Host process, socket, browser or private data was admitted for
this work. Windows is deferred. Ticket 49 and umbrella ticket 29 remain open.

## Source contracts and remaining Session settings gap

Reviewed the actual ticket45 DSH source at base
`38a6a5c965aa99ab525161efb7cc5cf1fe62fced`, including its public candidate
projection changes, and the existing integration dependencies. The settings DTO,
namespace constants and stock controller implementation are unchanged from that
base. Source checksums and the exact test descriptor identity are recorded in
[the source evidence](../../docs/implementation/ticket-49-source-evidence.json).
No build-derived manifest was changed or rebuilt.

- DSH `packages/settings/settings/src/types.ts`: settings views contain
  schema/value/revision; writes carry `expectedRevision`.
- DSH `packages/api/settings-controller/src/index.ts` and its public generated
  `/remote` export: `mutate(ns, ops, expectedRevision)` returns the accepted view.
- DSH `packages/client/ui-theme/src/theme-settings.ts` and
  `packages/client/locale/src/locale-settings.ts`: real namespace/field names.
- DSH `packages/client/ui-settings/src/client/config-form.ts`: feature-owned rows
  write through mutate and adopt its returned view. An invalidation notifies
  other clients through the existing public settings event.
- DSH `session/selectModel` does not expose projection binding or an authoritative
  Session settings read DTO. Its stock implementation saves a global default;
  mounting that owner would exceed this ticket's Session-only scope.
- Native `rpc-types.ts` exposes get_state, get_available_models,
  get_available_thinking_levels, set_model and set_thinking_level. get_state is a
  broad native response: never serialize it, Model objects, provider config,
  headers, endpoint URLs or credentials directly to a browser. Native model and
  thinking commands default to Session-local behavior, but neither accepts
  target/revision/idle preconditions. An ack alone is not final state readback.

Before model/thinking mutation is exposed, add an explicit public Session settings
state DTO and conditional admission contract. Proposed requirements, **not existing
supported APIs**: an exact native target plus worker/projection binding, native
settings revision, authoritative current provider/model/thinking, sanitized
allowlisted choices, known supported capability, joint quiescence and mutation
serialized with all native prompt/history/settings admission. Read back native
state and publish any required model/context/projection change before reporting
success. Busy, replaced Session, changed projection, revoked authority, capability
gaps and lost replies must fail closed; never retry a write automatically.

The next source tracer is that explicit read/conditional-write contract and its
narrow Host adapter using actual supported public Native RPC. The next real
tracer, after the separately authorized runtime gate, is an authorized Linux DSH
page changing a Session model/thinking level and reading final native state while
the second Browser View, draft, history and stream stay coherent. Then exercise
WebUI preference rows and revoke/stale/busy negative controls. These source tests
do not establish any of those product results.

## Verification

Public Client Remote → synthetic in-memory Connection transport → actual public
Host Gateway invocation → real `WebPreferences`, plus the public Host settings
notification contract. No private service access or mocked internal collaborator.
The first theme test failed with the missing service, then passed; the public
notification test failed with an empty event list, then passed after event emission.
Eight affected tests pass (36 assertions); full repository strict TypeScript passes.
The review fix adds canceled invocation and disposed Peer traces. Each refuses a
mutation, then reads unchanged preference values and revisions through the same
public Client Remote and observes no Host-local invalidation. The Peer trace uses
public `Peer.dispose()` after Gateway admission, before service dispatch, and a
fresh authorized Peer for readback. Removing either respective service signal
guard made its trace fail (the mutation was accepted); restoring it passed.
These are synthetic carrier/Peer lifetime checks, not browser cancellation proof.

All Bun runs used `env -i`, synthetic HOME/profile/cwd, TMPDIR=/tmp,
`--no-env-file` and a preimport guard. Initial source runs used
`tests/interactions/no-provider.ts`; the review fix uses the dedicated
`tests/preferences/no-provider.ts`, which refuses network dispatch, socket/listen
and child-process launch without a local-socket exception.
Dependencies are read-only links to the existing integration installation; no
package install, vendor copy, build or Native dependency mutation occurred.
