# 会话接管与手动恢复的公共边界

- 研究日期：2026-11-15；OMP `18.20.2`，固定 SHA `7c49c11aa5bbaf3f418406583096168ad5b8c6dc`。
- 研究票：[会话接管可行性：现有 worker、外部 TUI 与手动恢复的公共边界](https://github.com/HowBoring/omp-webui/issues/13)；服务于 [MVP 会话策略：工作目录、索引与恢复保证](https://github.com/HowBoring/omp-webui/issues/6)，地图：[OMP WebUI 可用 MVP：关键决策地图](https://github.com/HowBoring/omp-webui/issues/1)。
- 用户输入：工作目录→Session 列表；catalog 范围仍待澄清；允许持久化引用元数据索引；崩溃后手动恢复、禁止自动重发 prompt；偏好接管，先评估可行性。本笔记不替用户选择最终政策。
- 证据等级：固定源码与 schema 静态核对；未启动真实 OMP/TUI，未验证 native lease、模型或工具行为。读取内部实现仅用于证明公共合同，不建议 Host import 内部 SDK。

## 结论与可行性矩阵

**同 Host 重新连接已有 worker 可由 Host 实现；接管其他活进程的写入所有权没有现成公共 RPC/CLI。** 当前原生保护是在第二 writer 写入时转为新 id 的 sibling/continuation，而非让它替换原 writer。前 owner 已退出后的打开属于恢复，不需要“强制解锁”。[L1][L2][L3]

| 场景 | 固定版本可做的公共动作 | 边界 / 不能承诺 |
|---|---|---|
| 浏览器刷新，同 Host 同 worker 仍活着 | Host Registry 将浏览器重新附加原 worker；公共 `get_state/get_entries/get_tree` 重建状态与历史，Host 保留 live buffer 与 pending UI | 没有真实 owner 转移；不要再 spawn 第二 writer，也不要用 open_session 作为浏览器刷新握手。[L4] |
| 另一个可信 Host 管理的 worker | 原 Host 可通过自己持有的 stdio 先停止接收新操作、settle/abort，再 EOF→持续 drain→等待退出；新 Host 再恢复已知 Session | 这需要 Host 间合作；OMP 没有 discover-owner/attach-existing-stdio/release-transfer RPC。仅“查 lease free→打开”不是原子交接。[L5][L6] |
| 外部活 TUI 正在写同 Session | 用户在原 TUI 停止工作并退出，确认其退出后再由 WebUI 恢复；或将未来 cooperative handoff 做成新公共能力 | WebUI 不能通过自己的新 RPC 子进程给未知 TUI 发 abort/退出。打开同文件不等于获得所有权；继续写可能产生新 Session。[L1][L2] |
| 外部 owner 活着，想立即强制接管 | 当前没有等价公共能力 | 不提供杀未知进程、删 lease、改 session 文件或“force-open”的实现候选；这些都不等价于状态完整且有单 writer 保证的接管。 |
| owner 已退出/崩溃，持久历史尚在 | 公开 CLI `--resume <path/id>`，或新 rpc-ui worker 的 `switch_session:{sessionPath}`；回读 `get_state` 更新引用 | OS 回收死进程 lease；未保存的输出不可重建，旧 prompt ticket/待回答 UI 不能跨进程精确恢复。是否 retry 由人决定。[L3][L4][L7] |
| 显示“stale lease”或探测 unknown | 使用公共 probe 重新观察，并显式报告不可判定 | Linux ownership 是 abstract socket；其他平台 flock sidecar 可长期存在。旧文件存在/mtime 不是活 owner 证据；unknown 不是 free。[L3] |

`get_state` 返回 `sessionId,sessionFile?,sessionName?,isStreaming,isCompacting,hasPendingAsyncWork,isSettled` 等；没有 owner 身份、PID、lease generation、claim token。Session Path 来自 `sessionFile`，恢复命令的参数确切名是 `switch_session.sessionPath`；`open_session.sessionDir` 则选择最近非空会话及 continuation，不能当作精确接管指定 id。[L4]

## Lease、释放与 continuation：源码能证明什么

1. 公共 `get_session_lease:{sessionIds:string[]}` 返回 **`{held:string[],unknown:string[]}`**；held 包括本进程；不在两列表中的 id 是 probe 时未占用，甚至可能根本不存在。CLI 等价为 `omp session lease --json -- <id>...`。[L3][L6]
2. Lease 按 Session id，非文件路径。只在写路径 claim；打开/检查 Session 本身不 claim。因此 probe→open→first-write 各步骤之间都可能有人竞争；probe 不能充当预留、原子 claim 或 owner 识别。[L1][L3]
3. 活 owner 冲突时第二进程不写原 journal，而 `#moveOffSessionFile("open-elsewhere")`：生成新 id 和同目录 sibling，记录 `parentSession` 与 `continuationOf`，保留继承的 prompt-cache key。之后旧文件的 resume 可能跟随 continuation。**不能把“可以继续聊”报告为“已接管原 Session”。**[L1][L2][L7]
4. 原 Session 切换会释放之前 claim；close 也释放，而以后写入可重新 claim；process exit 由 OS 回收。单独 release 而不停止旧 writer 不足以安全转移；旧进程还能继续写/重新 claim。正常 dispose 先 drain、seal（阻止后续写）、再 close。[L8]
5. RPC 的 persistence notice 是 `{type:"notice",level:"warning",message,source:"session-persistence"}` 文本；没有结构化 from/to/reason 身份事件。因此 Host 可遇 notice 后 `get_state` 回读，但不能从人类 message 解析身份，也不能据此消除竞争窗口。[L9]
6. 核对 wire schema 74 条 commands、CLI session 子命令集合：有 probe、switch/open、新建、branch/fork、handoff；没有 public owner identity、release/transfer、atomic claim/open 或 force takeover API。现有 `handoff` / `/handoff` 是“总结交接文档并原地 compaction”，与 writer ownership 转移无关。[L5][L6][L10]

Linux/WSL2 的上述 lease 行为是 OMP 源码声明，不是本次 native 跨进程实测。旧版本 writer、未知 backend、probe 失败等不能被描述成已经获得互斥保证。

## 手动 retry / rewind：必须纠正“没有专用 wire 就没有功能”的推断

| 用户动作 | 公共可达性与确切行为 | 限制 |
|---|---|---|
| 重试最后失败/中断 turn | **可以**发 `{id,type:"prompt",message:"/retry"}`。rpc-mode 调 `executeAcpBuiltinSlashCommand`；builtin-lifecycle 的 text `handle` 调 `session.retry()`，成功返回 `agentInvoked:true`，继续通过 RPC 原有 session subscription 流式输出与 prompt_result 跟踪。[L11][L12] | 非任意时间重试：streaming 拒绝；底层 streaming/compacting/isRetrying 返回 false；没有可 retry 的失败/aborted tail 则 “Nothing to retry”。不是仅重发用户文本。[L12][L13] |
| 停止自动 retry | `abort_retry`；开关为 `set_auto_retry` | 只是取消自动重试流程，不执行 manual retry；与 `prompt("/retry")` 不同。[L5][L13] |
| 从失败 turn 恢复 | retry 清理 active context 的失败 turn/配对 synthetic results，重置 retry budget；冷恢复时可检查 persisted display transcript 的 failed tail | 一些参数完整且整批失败的工具调用会**直接重跑工具**；部分成功 batch 不走直接 replay。手动动作仍可能重复外部副作用，不能把它描述成只重新请求模型。[L13] |
| 发送 `/rewind` 或 `/branch` 文本 | **不是 RPC rewind builtin**。`rewind` 是 branch alias，但 registry 只有 `handleTui`→用户消息选择器，没有 text handle；ACP dispatcher 返回 false，之后可进入 extension/普通 prompt 管道 | 不能把字面 `/rewind` 作为 Web 按钮后端，否则可能被当作模型输入；`/tree` 同样只有 TUI selector。[L11][L14] |
| 选择用户消息，创建旧点分支 | 公共 `branch:{entryId}`，只接受 user message；创建**新 Session 文件**，保留到该用户消息的 parent，返回 `{text,cancelled}`；之后回读身份 | 与同文件 rewind 不是同一行为；不会自动重发返回 text。RPC branch 可能允许原 live run 到正常 yield，手动恢复应先明确 settle/abort。[L15] |
| 在原 Session 内回到旧点 | 公共 `navigate_tree:{entryId,summarize?,customInstructions?}`；user message 目标会移到 parent，并返 `editorText`；其他 entry 成为 leaf | busy→`session_busy`，未知 id→`entry_not_found`；ask 可重答目标→`ask_reanswer_unsupported`；summary 可被 abort_branch_summary 取消。需重新投影活动分支，不是撤销真实文件/工具副作用。[L16] |

RPC input hook 可提前消费或改写文本，因此 /retry 可达性以配置未拦截该输入为前提；get_state 没有 canRetry 字段，也没有专用结构化 retry-result。Web 按钮需接入现有 command_output、ack 与 prompt_result，不能凭空定义服务端就绪状态。[L11][L12]

retry 的完整失败工具 batch replay 只对匹配条件成立：anchor assistant 具有完整 toolUse/stop 参数，后续每个对应 tool result 都 isError；有已成功结果或 synthetic placeholder 的 batch 不符合直接重跑条件。真正重试沿用 OMP 的恢复逻辑，不应由 Host 自行删 transcript 或重构工具调用。[L13]

### 是否可以修复任意 crash/cold resume？

**不能保证。** `/retry` 可用不代表每种崩溃都有可重试的 durable failed tail。源码另有 `restoreInterruptedTurn()`：对“无 exit record”的中断先补 outcome-unknown tool results 和 interrupted abort，再调用 retry；但这段公共 CLI 入口是 `--restore`，参数验证明确要求 interactive terminal，拒绝 `--mode`；wire 没有对应 restore command。[L17][L5]

普通 switchSession 的恢复会调用 `createInterruptedTurnAbortMessage`，但未传 `assumeExit:true`；该 helper 默认要求已记录的 process-exit 位于非终端 tail 之后。没有 exit record 的 crash 与已经持久记录 failed/aborted turn 不应混为一谈。故可承诺“先恢复历史，由人尝试 OMP /retry 或明确选择历史点”，不可承诺“任何 worker crash 都能一键继续”。若产品要后者，应新增公共 server 恢复操作，明确 unknown outcomes 与工具 replay 语义，而非调用内部方法。[L17][L18]

“重新提交相同 prompt”会产生新的提交，可能重复操作；“navigate/branch 后再提交”会改变活动历史；“/retry”调用原生恢复逻辑。这三个动作必须给用户可区分的含义，且都只能由明确手动动作触发。

## 若选择跨进程接管，安全公共扩展的候选合同

以下全部是**待设计/上游交付的 server 能力，不是现有 API 名称**；本文不选择路线：

- 最小的严格单 writer 方案：原子“打开并 claim-if-free”，输入 expected Session id/已知引用，服务端在任何 transcript 变更前 acquire 或返回结构化 conflict；返回 claimed id/path 与 opaque ownership generation。仅此可关闭 probe→first-write 的 TOCTOU，但不能命令活 owner 交权。
- Cooperative transfer：原 owner 收到有授权的 prepare-transfer；冻结新提交、处理 pending UI/后台工作、drain 持久化并 fence 所有旧写入后，发行短效单次 transfer ticket。新 owner 原子 redeem→加载最终 durable revision→接管；失败/超时/双方崩溃的恢复必须有明确状态。旧 owner不得在 transfer 后重新 claim。
- 活 TUI 也需实现同一 owner-side 控制/协调表面，或由用户先退出；只给新 RPC worker 加一个“force:true”不能让旧 TUI 停写。若需要发现 owner，公开 opaque owner identity/协议版本/可合作能力；不能把 PID 当授权或可杀进程列表。
- 若只需 crash 后手动继续：独立增加 public interrupted-turn restore（同 OMP --restore 的 outcome-unknown/可 replay 规则与明确拒绝条件），不必捆绑 full takeover；仍不得自动触发。
- 当前 AGENTS.md 明文禁止 force-open 被其他进程持有的 Session，ADR 要求 RPC-only。用户“偏好接管”是研究方向；在决定合法 cooperative/atomic 合同前不能视为已批准绕过这些边界。

## 本次执行、未运行实验、下一步决策

实际执行：读 AGENTS/domain/ADR/architecture/version lock；按固定 SHA 核对 RPC mode/types/schema、CLI session/args、slash registry/ACP dispatcher/TUI handlers、SessionManager/Storage/TurnRecovery/exit diagnostics；本地 JSON schema 枚举与文本逐行比对。未修改运行时代码、issue，未提交/推送。

未运行的最小实验：①同 Host 刷新时 streaming/pending approval 仍附加同 worker；②双进程 probe/claim 竞态产生 sibling 与 id 更新；③原 owner graceful exit 与 crash 后 lease 回收/历史边界；④RPC /retry 的 ack/result、Nothing to retry 与完整/部分失败 batch；⑤无 exit-record 的 cold crash 与普通 failed-tail 恢复差异；⑥branch 与 navigate_tree 的 identity/leaf/ask refusal。实验前不应把静态可达性写成产品已通过验收。

留待会话策略决策：接管是同 Host attach、用户退出后的恢复，还是包含跨活进程 cooperative transfer？当前公共能力可满足前两类；最后一类需要新增 server/owner 合同。工作目录列表是否包含外部 TUI Session 是独立 catalog 范围问题，不由本研究推定。

## 固定源码

[L1]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-manager.ts#L1151-L1183
[L2]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-manager.ts#L1305-L1355
[L3]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-storage.ts#L562-L663
[L4]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/docs/rpc.md#L381-L405
[L5]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/wire/rpc-wire.schema.json#L6-L827
[L6]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/commands/session.ts#L26-L105
[L7]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/main.ts#L1324-L1382
[L8]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-manager.ts#L2998-L3070
[L9]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L1351-L1368
[L10]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/slash-commands/builtin-lifecycle.ts#L350-L414
[L11]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L1940-L2009
[L12]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/slash-commands/builtin-lifecycle.ts#L545-L578
[L13]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/turn-recovery.ts#L3477-L3542
[L14]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/slash-commands/builtin-session.ts#L631-L688
[L15]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/agent-session.ts#L14528-L14559
[L16]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2167-L2215
[L17]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/agent-session.ts#L13472-L13510
[L18]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/exit-diagnostics.ts#L120-L234

补充精确定位：[close 前 seal 的 dispose](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/agent-session.ts#L6959-L6970)；[open 不 claim](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-manager.ts#L2403-L2419)；[RPC EOF drain](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2959-L2979)；[ACP 无 handle 则返回 false](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/slash-commands/acp-builtins.ts#L58-L75)；[--restore 拒绝非 TUI](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/cli/args.ts#L154-L169)；[普通 switch 的 interrupted abort 未 assumeExit](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/agent-session.ts#L14310-L14321)；[工具 replay 条件](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/turn-recovery.ts#L201-L246)；[get_state 精确字段](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2260-L2305)。
