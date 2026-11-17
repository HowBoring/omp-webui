# ADR 0007: Share Interaction answering and preserve workers across browser disconnects

- Status: Accepted policy; Broker source vertical exists, product integration and final RPC guarantee validation pending
- Date: 2026-11-15
- Decision: [原生会话 MVP 的交互所有权与取消、断线策略](https://github.com/HowBoring/omp-webui/issues/22)

The local single-user MVP permits any currently authorized page to answer an Interaction; the first
valid answer wins. Browser disconnection preserves admitted work and still-valid pending UI in the
surviving Host/worker. This avoids an exclusive controller-tab transfer protocol and makes ordinary
refresh nondestructive, at the cost of explicit Broker correlation, redelivery and duplicate-answer fencing.
Busy Sessions accept no new prompt/steer/follow-up queue input; users can keep editing drafts.

The Host defaults to a 30-minute Interaction deadline without refresh-based renewal, and expiry cancels
and requests Stop. Ordinary Stop offers user-confirmed force termination after 30 seconds; credential
revoke-all, lost directory authorization and Host shutdown use bounded cooperative/drain and termination
phases of 30 and 5 seconds. A single browser credential's expiry/logout removes its rights while other
authorized browsers and admitted execution continue. These are distinct from ordinary disconnects.

Pinned OMP timed asks can synthesize default answers even when the Host intends cancellation. The MVP
requires a publicly verifiable server guarantee of explicit-answer-only submission for those paths;
a Host timer alone cannot supply it. This is a deliberate compatibility requirement, not permission to
change upstream pins silently or bypass RPC. The [Interaction lifecycle contract](../interaction-lifecycle-contract.md)
records the policy, source evidence and real validation gates; existing history remains OMP-owned.

The [#47 Broker source vertical](../interaction-broker-source-status.md) adds an
in-memory implementation and a typed public Host Remote boundary. Its trusted
page binding is supplied by Host admission, with current resource checks on read,
answer and delayed result application. It reuses generated Native `respond_ui`
types and the effective explicit-answer policy; host tool/URI contracts remain
separate. This is isolated source/fixture evidence. It does not install a product
route or change the required real browser/Native/final-tuple acceptance gates.
