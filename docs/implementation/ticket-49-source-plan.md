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
