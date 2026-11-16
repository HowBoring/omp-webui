# Ticket 39 accepted seams

The existing spec29 Testing Decisions 1–3 and ticket39 AC5 authorize public DSH Client/provider fixture tests.
No new seam approval is needed. This isolated fixture never opens product Sessions or a Host original store.

- Actual DSH Conversation plugin public `conversation.input` with production editor/submit machine and retained
  Session bindings: semantic snapshots, provider persistence ownership, revision CAS, cancellation and disposal.
  A controlled public provider supplies stable synthetic original references and creates actual runtime drafts
  through public Conversation upload APIs; its receipts are fixture receipts, not durable Host proof.
- Actual built DSH Client in Linux Chromium with public plugin/provider fixture: real editing, two live tabs,
  Session switches, refresh, duplicated storage, semantic round trips, stale preparations and frozen submissions.
- Fixed source + ordered policy/draft patches + DSH schema/type/client build: source and delivered assets match.

Vertical TDD: first prove shared storage exclusion and text restore fails without the seam, implement it, then add
ordered original/semantic restoration, then race/frozen/cancellation cases, then browser tab lifecycle evidence.
Product integration remains blocked on ticket30 review; Windows Chrome/WSL2 is explicitly deferred by the user.

After ticket30 landed at `0ab18e55b0640a944c318d688a7db4c60ed72a0f`, the coordinator explicitly assigned the
shared DSH build pipeline extension to ticket39. Its public source-build gate is additionally tested using
actual fixed-source Git trees and controlled authored/ignored/untracked source mutations. This preserves the
existing diagnostic trust boundary; it does not enable product Sessions.
