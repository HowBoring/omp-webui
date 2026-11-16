# Native ownership development direction

The coordinator accepted the bounded dispatcher/private-helper direction in [ADR 0018](../adr/0018-native-execution-ownership.md).
It supersedes the previous undecided environment-only policy and larger owner-scoped service/refcount proposal.
`0010-execution-ownership.patch` is reserved. This is source preparation; every runtime/lifetime/global capability remains blocked.

All compatible Native broker launches, including ordinary TUI and nested cleared environments, must use one public
independent dispatcher. Clients never auto-spawn/fallback. Actual authenticated peer/ancestor pidfds classify private
helpers registered durably before worker start. Helper uncertainty globally fences new shared registrations and maintenance.
Private Native cannot access shared services; generic bash/background/subagents remain available. Optional browser/relay,
IDA, prediction and external mux restrictions must produce actual readable typed failure. Private LSP/blob/attachment
paths still require positive Native evidence. No mandatory MVP story is removed.

The private C helper owns wait/reap and retains installation protection through authoritative extinction. Bun owns
only the helper; trusted control reports actual Native PID/generation, and Native leases/maps use that PID. Root exit,
process group exit and empty proc scans are insufficient. Every surviving external broker/service needs a separately
protected lifetime outside private domains; external EOF preservation and private EOF cleanup are distinct policies.

Current concrete artifacts and honest evidence are in [the preparation report](../evidence/ticket-41-ownership-preparation.md).
The public Native source patch includes strict protocol/schema, framing, client/dispatcher decision modules and an
uncompiled Linux C/FFI socket/pidfd bridge. Its CLI explicitly reports backend unavailable. Actual backend storage,
all-mode broker integration, consumer policy and external protectors remain unfinished. The patch is preparatory
after stable 1–6, not the final 1–10 tuple. No production/global installation was created or changed.
