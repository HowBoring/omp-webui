# Throwaway history-navigation logic prototype

**Status: interaction flow accepted by the maintainer; real integration remains unimplemented.**

Verdict: “接受，按此形成 MVP 历史交互契约（推荐）”. The
[resolution](https://github.com/HowBoring/omp-webui/issues/21#issuecomment-6896549006) records the answer;
the [accepted contract on main](https://github.com/HowBoring/omp-webui/blob/28ed9676da9439663f9a7d77c92876843b39ca13/docs/history-interaction-contract.md)
captures the decision and remaining gates. The reviewed HTML is unchanged. Its layout, fixture types
and in-memory draft behavior are not production commitments.

Question: can the maintainer distinguish selecting a tree entry, navigating within the same OMP
Session, and creating a new Session before a historical user message, including blocking/recovery cases?

Context: [Tree 与手动历史恢复：最小交互原型及验收边界](https://github.com/HowBoring/omp-webui/issues/21),
under [OMP WebUI 可用 MVP：原生会话发现与历史导航决策地图](https://github.com/HowBoring/omp-webui/issues/14).

## Run

Download `index.html` and double-click it. No dependencies, build, server, credentials or network.
All data are fictitious and live only in memory. A real browser reload resets the prototype.
The “rebuild history view” action simulates reopening a view against the same in-memory authority;
it does not establish a browser persistence, cursor or reconnect implementation.

The six scenario tabs reset the model and offer ordered, real action buttons. Free-play controls
and tree selection can be used at any time; restart a scenario to restore its intended starting state.
The pure `Model` block and the DOM shell are separate in the single script. This is disposable code,
not a new public type, production reducer, implementation branch or DSH UI component.

## Proposed interaction to react to

- Selecting a node only changes the selection. The active path, current leaf and Session identity
  remain visible separately from the full tree.
- Two distinct actions: “在原会话回到这里” and “从这条用户消息新建会话”. Both preview the resulting
  identity/leaf/draft and require acknowledgement that file/external effects are not rolled back.
- A user-message target resumes before that message and returns an unsent text draft. A normal
  assistant/tool target remains in the active path. Branch creation accepts only historical user messages,
  opens a new Session and retains the original Session in the catalog.
- Host work must be idle. Requesting stop leaves “waiting for quiescence”; it does not immediately
  perform a pending navigation. The user initiates the history action again after quiescence.
- External TUI ownership permits catalog metadata only. First open retains registration even when
  continuation is blocked. The TUI exits on its own; a later explicit open simulates successful resume.
- An ask re-answer target is refused with the pinned public error and leaves the history unchanged.
  Process exit does not restart a worker or replay content. Explicit reopen demonstrates only a
  successful recovery case, not universal crash repair.
- The manual draft-send button is a simulation. Returning a draft never increments its send count.
  Drafts when switching Sessions stay in page memory for exploration; durable draft policy is not decided.

## Contract evidence and limits

Pinned basis: OMP `18.20.2` / `7c49c11aa5bbaf3f418406583096168ad5b8c6dc`;
DSH `dsh-v0.2.2-rc.3` / `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`.

- [RPC navigation implementation](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2167):
  `navigate_tree`, busy/unknown-entry checks, `ask_reanswer_unsupported`, cancelled/aborted result.
- [Native history navigation](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/agent-session.ts#L15007):
  user-message parent target and returned draft. Custom messages, summaries and hooks can differ;
  the demo deliberately models only the visible fixture types, without a summary or pending goal.
- [Native branching](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/agent-session.ts#L14533)
  and [RPC branch result](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L898):
  new Session before selected user message, with returned `text` and `cancelled`.
- [Session discovery/registration decision](../../docs/session-catalog-contract.md),
  [public transport decision](../../docs/rpc-client-contract.md) and
  [client composition](../../docs/client-composition.md) remain the governing constraints.

The simulator uses invented entry IDs and data shapes, never advertised as wire schema. It makes no
RPC calls, reads no native Session files, starts no worker and reuses no DSH source. It does not model
summary generation, hook cancellation, goal continuation, concurrent browsers, attachments, native
compaction/custom entries, late events or projection cursors. Those require their own contract and real
RPC conformance/integration evidence. All post-operation identity/leaf refreshes here are simulated.

Catalog discovery and strict continuation still need a public OMP extension. Safe stop/quiescence,
interaction ownership and cancellation belong to
[原生会话 MVP 的交互所有权与取消、断线策略](https://github.com/HowBoring/omp-webui/issues/22).
Real branch projection and reopen behavior belong to
[原生历史与树导航的投影、游标和重建规则](https://github.com/HowBoring/omp-webui/issues/23).
New image/file input remains required in the MVP; the text fixture does not narrow that scope.

No automated tests are added for this disposable prototype. Browser walkthrough inspection is recorded
in the issue as preview evidence only. Main contains the accepted contract and pointers, while this
disposable simulator remains on its prototype branch. Approval does not establish real RPC behavior,
projection correctness, attachment restoration or a completed usable MVP.
