# Ticket 49 first source slice

Base: integration `mvp/spec-29` at `4024c40`. Uses the user-accepted public
DSH Client/Connection/Remote boundary with synthetic transport; no new seam interview.
Read local implement-spec and TDD instructions before implementation.

One vertical tracer: the actual DSH `settings` Remote describes only WebUI
`ui-theme` and `locale`, accepts a revision-bound preference edit, and returns
its actual stored value on a subsequent read. Implement a narrow production
Remote owner, without importing the stock controller (which also mounts
credentials and opens the native settings document). Fail closed for unknown
namespaces, fields, missing revisions and expired authority. Source fixtures
use no sockets, Native, SDK, Host process or browser.

RED first at the public Client Remote through in-memory Connection transport
and public Host Gateway invocation. GREEN with a small settings owner and
explicit Host-owned preference storage. Then add negative traces one at a time.
Run strict TypeScript and only the affected synthetic tests under allowlisted
environment, synthetic HOME/profile/cwd and preimport no-provider guard.

Source review must retain the actual stock contracts: SettingsNamespaceView
includes schema/value/revision and settings mutation has expectedRevision;
theme namespace is ui-theme and locale namespace is locale, field preference.
Session model selection is not implemented by this preference slice. The stock
DSH selectModel also saves a global default and lacks projection binding. Native
set_model and set_thinking_level are Session-local but lack conditional idle,
target and revision admission. Do not claim those missing guarantees exist.

No build manifest, Native dependency, actual runtime/private data, remote
publication, ticket closure or integration merge. Merge integration tip into
this branch before report; ticket49 and the full MVP remain open.

## Preferences review fix

Fresh branch `mvp/ticket-49-preferences-review-fix` starts at reviewed source
`3d917dc0a22967ceada879fd690abb4cda6c82e4`. The spec review found no bounded-slice
issue; the standards review requested meaningful invocation/Peer cancellation
coverage and line wrapping, with a clearer authority-check name as a judgment call.

Keep the accepted public seam. Supply a canceled carrier signal through public
Gateway.invoke; separately dispose the real public Peer after Gateway admission
while receiver preparation yields. A subsequent authorized Remote describe must
show both namespace values/revisions unchanged and no Host-local public settings
notification. Prove sensitivity one trace at a time by temporarily removing only
the corresponding service guard (RED: mutation accepted), then restoring it
(GREEN). Preserve the reviewed preimage identity and original evidence in Git.

Wrap the source import/schema expression and rename the private check to
`assertCurrentAuthority`. Run the eight focused tests and full strict TypeScript
with the dedicated preferences preimport guard, env -i, synthetic HOME/profile/cwd
under /tmp and TMPDIR=/tmp. No durable preferences, Session settings API, product
registration, Native/browser runtime, dependency/schema/build work, publishing or
ticket closure is included. Commit and stop for a fresh focused source review.

## Session model/thinking and WebUI appearance implementation

The reviewed source slice above covered only WebUI `ui-theme`/`locale`. This
branch adds the Session-local capabilities as an additive public contract in
`packages/contracts/sessions.ts`: `ompSessions/preferences` and
`ompSessions/applyPreferences`. The Host adapter reads actual `get_state`,
`get_available_models` and `get_available_thinking_levels`; writes actual
`set_model`/`set_thinking_level`; never uses DSH `session/selectModel` or its
global default. Choices are sanitized before crossing Remote.

Writes require worker generation, current revision and native settlement. They
are serialized per worker, recheck browser authority and generation, and read the
native state/models/levels back before reporting success. Replaced Session,
busy, stale revision, unknown model, unsupported thinking and revoked authority
fail without false success. Revisions are Host-local and reset on restart.

The Chat client mounts a filtered Remote contribution exposing only
`settings/describe` and `settings/mutate`; its appearance rows scope theme and
language to `[data-chat-root-slot]` and never mutate the global document or
browser storage. Session settings use the new public RPC. A successful native
write opens a fresh Host journal and the control stream announces the new
projection generation; Session Settings renews the Chat attachment only after
the rebuilt projection is ready, so the following stream keeps native history,
draft and settlement consistent.

Actual component evidence is pinned in
`docs/evidence/ticket-49-session-preferences.json`; the generated browser
artifact is `vendor/settings-browser.json`. Normal product admission stays
blocked, the Chat provider remains controlled/synthetic, and ticket 49 remains
open.
