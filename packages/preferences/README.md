# WebUI presentation preferences and Session model/thinking

`WebPreferences` implements the public DSH `settings/describe` and
`settings/mutate` contracts for `ui-theme.preference` and `locale.preference`.
It returns current service state, requires each namespace's revision, checks the
live browser authority of the admitted request, and publishes the existing
`settings/document-updated` event after an accepted edit. Unknown namespaces,
fields, malformed values, unconditional writes and expired authority fail closed.
Theme supports light/dark/system; an empty locale delegates language selection
to the browser.

The Host contribution mounts only these two descriptors. It does not mount the
stock `SettingsController`, which also registers credentials and opens the native
configuration document. `update`, `replace`, document open, credentials and
global provider/plugin administration have no implementation or client mount.
`apps/chat/src/client.tsx` separately mounts `preferencesRemoteContribution`,
which exposes only `settings/describe` and `settings/mutate` to the WebUI page.
The client applies the theme and language to its own root slot, never to
`document.documentElement`, and stores no theme/locale values in browser storage.

State lasts for the service lifetime. Restart persistence and cross-Browser-View
event delivery are not provided by this slice.

## Session model and thinking

`SessionsService` exposes `ompSessions/preferences` and
`ompSessions/applyPreferences` using actual supported public OMP 19 commands:
`get_state`, `get_available_models`, `get_available_thinking_levels`, `set_model`
and `set_thinking_level`. It never calls DSH `session/selectModel`, which saves a
global default. The public DTO contains only the current provider/id/name, the
thinking level and levels, sanitized model choices (no endpoint URLs, headers or
credentials), a busy flag, and a revision. Choices are capped at 48; names and
levels are validated by the contract schema.

Writes are serialized per worker and require the exact worker generation and
current revision. The service rejects a replaced Session, an unsettled/busy
native Session, an unknown model or unsupported thinking level, and revoked
authority before reporting success. After a write it rechecks authority and the
generation, reads native state/models/levels back, requires the requested model
and thinking level to match, and only then returns the incremented revision. An
acknowledgement alone is not success.

Revisions are Host-local revision numbers bound to a worker generation, not a
native revision field. They detect stale forms within this Host lifetime; they
reset when the Host process restarts. A restart therefore requires a fresh read,
which is the safe behavior. OMP exposes no atomic conditional-write primitive for
model plus thinking; each command is serialized, and an unconfirmed final state
fails the invocation.

## Verification

- `tests/sessions/settings-remote.test.ts`: public Client Remote through the real
  Host dispatch and synthetic session runtime. Positive model+thinking write and
  native readback; stale revision, replaced generation, busy, revoked authority,
  unknown model and unsupported level negatives; client preference mount surface.
- `tests/preferences/remote.test.ts`: existing settings Remote, revision,
  cancellation and notification coverage.
- `tests/chat/settings-browser.py`: actual built Host + DSH client + strict OMP
  candidate in Linux Chromium. Scoped dark theme and zh-CN language survive a
  reload without touching the global document or browser storage; model and
  thinking changes persist; a replayed stale public RPC is refused with
  `gateway/bad-request`; the draft and native transcript survive the changes.
- `vendor/settings-browser.json` and `.png` record the current execution.
  `docs/evidence/ticket-49-session-preferences.json` pins the component tuple and
  both positive and negative outcomes.

The Chat runtime still uses the controlled synthetic provider, so the browser
cannot claim a real AI response. The Host, DSH assets, OMP candidate, native model
catalog and native state transitions are actual. Normal product admission,
restart persistence, Windows and production AI provider use remain unverified.
Ticket 49 and umbrella ticket 29 remain open.
