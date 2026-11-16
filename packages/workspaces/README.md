# Directory authorization and read-only Workspace mapping (#43)

`DirectoryGrants` stores only canonical roots and their filesystem identity (device, inode, birth time), grant ID
and timestamp in private Host-owned SQLite. It never reads native Sessions. A 60-second in-memory confirmation
binds an explicitly reviewed canonical target; confirmation is single-use and verifies replacement again.
The owner grants a directory and descendants, with `path.relative` segment checks. Grant roots and native recorded
cwd are revalidated for every catalog page. Missing, unknown, inaccessible, changed and ungranted are explicit.
Symlink escapes and same-path replacements do not inherit grants. Grant loss/state replacement fails closed.

The store uses FULL synchronous transactions, DELETE journaling, owner-only directory/file modes and live file
identity checks. There are at most 256 grants and 32 pending previews; paths are absolute, NUL-free and at most
4096 characters. Preview expiry never renews automatically. Reopening preserves grants; revocation commits before
returning. A repeated explicit grant can update a deliberately re-reviewed replacement, retaining the grant ID.

`workspacePage` consumes the public native `CatalogClient`. Source-scoped native items, ownership observations,
partial failures, scanning cursors and native error codes remain native facts. Its parallel access array matches each
page's item identities. Every discovery is explicitly `discovered`; no Session is created, registered, leased, opened
or migrated. Cwd headings describe only the current Session page; they do not claim complete global Workspace
pagination or counts. Native scan/response/snapshot/deadline budgets remain those in `compatibility/CATALOG.md`.
Host access metadata adds at most 32 short records to a bounded native page; one HTTP body/WS frame is at most
16 KiB, with eight Peers and one `$events` stream per Peer. No raw native RPC browser tunnel exists.

`SessionIndexReader` is a separate read-only metadata provider for #44's future index owner. Independently paged
registered references are re-described through public RPC and retain explicit missing, replaced, invalid, inaccessible
or source-unavailable outcomes. Failed descriptions never imply permission. Each page has at most 32 records;
errors display `index_unavailable`, never an empty successful index. This component never writes the Session Index.
`fixture-index.ts` supplies only deliberately authored synthetic reference metadata to the isolated executable.

No protected Session/history/attachment/execution admission exists here. Every view reports `blocked_pending_41_44`
even after a valid grant. Normal Host admission remains closed. #44 must compose this current-rights policy with
source/reference identity, final ownership checks, registration persistence and supervised worker stop/revoke
cleanup. This component has a readonly catalog child, and never reports a Session worker stopped.
