# MVP 会话投影依据：OMP 历史与 DSH 快照、游标、流式事件

- 研究日期：2026-11-15；关联 [OMP WebUI 可用 MVP：关键决策地图](https://github.com/HowBoring/omp-webui/issues/1)、[会话投影依据：OMP 历史与 DSH 快照、游标及流式事件的语义差异](https://github.com/HowBoring/omp-webui/issues/4)。
- OMP：18.20.2，`7c49c11aa5bbaf3f418406583096168ad5b8c6dc`。DSH：官方预发布 `dsh-v0.2.2-rc.3`，`38a6a5c965aa99ab525161efb7cc5cf1fe62fced`。
- 范围：预配置 cwd、本机单用户 Linux/WSL2、仅 WebUI 创建的会话；create/resume、流式聊天/工具结果、审批/ask/cancel、浏览器刷新恢复。分支编辑器、旧 TUI 会话导入、全局目录、BTW、子代理面板不在 MVP；当前分支正确性仍在范围内。
- 方法：固定 SHA 的官方文档、类型与实现静态阅读；GitHub connector 读取并缓存于 `work/research-projection/`。未运行 OMP、DSH、浏览器或端到端实验。本文是证据及候选方案，**没有批准最终投影算法，也没有实现适配器**。
- 已读本仓库 AGENTS、架构、ADR 0001、domain 约定及 lock。沿用地图与现有架构中的术语。

## 结论及决策边界

OMP 的 durable entry ID、RPC 进程内 messageId、Prompt request ID 和 DSH event seq 是四种不同身份。OMP 提供恢复会话所需的树节点与 leaf；DSH 客户端需要连续 journal、精确 cut 的快照与投影，以及独立于 durable cursor 的 assistant presentation 生命周期。直接把 OMP 消息数组转成聊天行不能满足该客户端。[O1][O2][O3][D1][D2]

尤其不能承诺“原生 DSH durable event log 的无损重放”：OMP `SessionMessageEntry` 保存最终 `AgentMessage`，与 DSH 每次 assistant attempt 保存原始分块、时间及失败尝试的 compact stream 不是同一事实集合。Host 内存可以保留本次已观察到的事件；Host/worker 重启后没有证据表明所有 provider chunk 边界、原始参数 JSON、失败 attempt、Prompt rpcId 都能从 OMP 公共历史恢复。可争取的是 **OMP 已持久化事实的内容无损投影**；不能把合成内容说成原始 provider 历史。[O2][O4][D3][D4][D5]

## 已核实的能力和语义

| 主题 | 固定基线的事实 | 对 MVP 的影响 |
| --- | --- | --- |
| OMP 历史 | `get_entries({since?}) → {entries, leafId}`，无 since 为全体追加史；since 为某 durable entry ID，严格返回它之后的条目；未知值为 `unknown_since`。[O1][O5] | since 不是 active-branch cursor；空新增仍可能伴随 leaf 变化。响应自带 leaf，应优先用同一响应的 cut。 |
| OMP 树 | `get_tree → {tree, leafId}`；entry 含 `id,parentId,timestamp`；可有 `activeLeafId` 表示离开当前分支写入的后台结果/usage。[O2][O5] | 追加末尾不是当前 leaf；按 parentId 找当前路径，不能将所有新消息都 append 到 Conversation。 |
| OMP 消息页 | `get_messages_page` 正向按 offset 切稳定的 `session.messages`；opaque nextCursor 绑定 sessionId、leafId、messageCount。streaming/compacting 拒绝为 `session_busy`，变动为 `stale_cursor`。默认 100、上限 256，通常 768 KiB，至少容纳一条。[O6][O5] | 与 DSH backwards `beforeSeq/throughSeq` 不可透传；busy 时的刷新不能依靠它获得强一致分页。没有 durable entry ID。 |
| OMP 历史规模 | `get_entries`/get_tree 没有公开分页或 maxBytes；v2 解决物理分帧，不等于无限重组/内存预算。[O1][O5] | MVP 应有会话大小预算和显式超限失败；大历史流式分页可能需要追加公共 RPC。 |
| OMP live identity | `message_start/update/end.messageId` 在本 RPC 进程内一致；forwarder 用自增 `msg-N` 与栈分配，非 SessionEntry.id。[O3] | Host 必须带 worker generation；重启后不能用 msg-N 去 durable 去重。没有已证实的 durable entryId join。 |
| OMP 流式终态 | `message_end` 完整 message 为权威，可能不同于增量重建；`agent_end.messages` 在超大帧中可被裁掉先前已送达的前缀。[O4] | 不能只保存 delta 或只依赖 agent_end 来恢复完整消息。 |
| OMP Prompt | ack 表示 admission；同步 builtin 的 `data.agentInvoked:false` 直接完成，其他 accepted prompt 由同 request id 的 `prompt_result` 完成；`session_settled` 为无后台/队列唤醒的静止。[O7] | 不从最后一条 assistant/agent_end 推断 Prompt 完成；stream settlement 也不等于 session 静止。 |
| DSH 实际 event | `{type,seq,time,data,ignorable?,sourceEventSeqs?,surfaceOp?}`，seq 非负 safe integer，time 为整数毫秒；客户端拒绝额外 envelope 字段。[D1][D6] | 不能附加任意 `sourceEntryId` 顶层字段；OMP 身份需适配层索引或经过验证的扩展承载。 |
| DSH 连续性 | 客户端 emptyCursor=-1；每 history record 正好覆盖自身 event seq；相邻必须 `right===left+1`。[D2][D7] | DSH seq 不能直接取时间戳、OMP entry hex ID 或只给可见消息编号而遗漏已发布 journal 事件。 |
| DSH snapshot | opening 是 header、cursor、records、hasMore、projections，以及 opted-in assistantStream baseline；projections 含 `asOfSeq,values`。[D1] | baseline 不能晚于历史 cut，也不能用一个缺少 journal watermark 的状态对象代替。 |
| DSH follow 请求 | rc.3 实际类型只有 address、activate、assistantStream、maxMessages、turnWindow；**没有 afterSeq/resume cursor 入参**。实现每次打开 snapshot。[D1][D8] | README/方法注释提“resume cursor”不足以定义 wire；不要发明字段。恢复由客户端 journal 的 opening/page 合并承担。 |
| DSH 实际 Web 调用 | SessionEventStream 固定 `activate:true,assistantStream:true`；没有 assistantStream baseline 会抛 `gateway/internal`；readPage 当前调用 deprecated `session.page`。[D2] | 即使 idle 也需空 baseline（例如 revision 0）；仅实现 events 不满足该 Web adapter。 |
| DSH 分页 | throughSeq 为 inclusive cut，beforeSeq 为 exclusive 上界，返回 chronological records/cursor/hasMore；默认 maxMessages=50，可按 Turn 边界拓宽。[D1][D9] | budget 是消息数而非事件数；tool/boundary records 仍须保留，先固定 cut 再加载旧页。 |
| DSH replacement | surface event 必须 surfaceOp；replace 引用当前 surface 的精确 start/end seq；被遮蔽节点必须作为 earlier source seq 被引用；assistant/message 禁止 sourceEventSeqs。[D3] | sourceEventSeqs 是 DSH journal 引用，不是 OMP entry ID。任意 rewind 不能直接解释为“append 几个消息”或空替换。 |
| DSH compact stream | stream 非 OMP assistantMessageEvent 数组；有 text/reasoning/tool-call compact runs 和 raw chunk；块、usage、finish 有专门类型。[D4][D5] | 要逐块转换并验证；tool arguments 在 DSH 保留原始 JSON 字符串，冷恢复的 OMP object 不能证明保留原始词法形式。 |
| DSH transient | start/chunk/end 有 attemptId、同一 assistant 流内跨帧 revision、dense chunk index；start 有 startedAfterSeq/turn/step，committed end 指定 eventType/seq。[D1][D10] | 这些是 Host 合成的 presentation bookkeeping；不能把 transient chunk 当 durable seq 条目。 |
| DSH projection/control | projection 更新与引发它的 committed seq 相关；control 每 generation 为完整 baseline，再发变更。缺 key 表示该 cut 无能力。[D1] | running、inbox、会话摘要与 journal 生命周期须明确；不能随意生成互不一致的快照。 |

## Wire 形状：应以这些类型为准

以下为省略品牌类型后的摘要，不是另一份协议：

~~~ts
type FollowFrame =
  | { type: "snapshot"; header: SessionWireHeader; cursor: number;
      records: {type: "event"; event: SessionWireEvent}[];
      hasMore: boolean; projections: {asOfSeq: number; values: object};
      assistantStream?: {revision: number; activeAttempt?: {
        attemptId: string; startedAfterSeq: number; turn: number; step: number;
        nextIndex: number; stream: JsonValue[];
      }} }
  | { type: "event"; event: SessionWireEvent }
  | { type: "assistant-stream"; frame: AssistantFrame };

type AssistantFrame =
  | { type: "start"; attemptId: string; revision: number;
      startedAfterSeq: number; turn: number; step: number }
  | { type: "chunk"; attemptId: string; revision: number;
      index: number; time: number; chunk: StreamChunk }
  | { type: "end"; attemptId: string; revision: number; index: number;
      outcome: {kind: "committed"; eventType: "assistant/message" | "assistant/attempt"; seq: number}
             | {kind: "abandoned"} };
~~~

源码还有必填数据结构，不能止步于“data 为 JSON”：user/message 的 data 是有 stable message id、content、source 的 UserMessage；assistant/message 是 `{turn,step,message,stream,usage?,interrupted?}`；assistant/attempt 是 `{turn,step,stream}`；tool/call 是 `{turn,step,callId,name,arguments:string}`；tool/result 是 `{turn,step,message,error?,meta?}`。tool message 的 role 为 `tool`，source 的 callId 与 toolCallId 应一致；provider metadata 也受源验证。[D3][D11]

StreamChunk 的核心为 `block-start(index,blockType)`、`text-delta(index,text)`、`reasoning-delta(index,text)`、`tool-call-delta(index,id,name?,argumentsDelta)`、`block-end(index,block)`、`usage`、`finish`；OMP 的 `text_delta/thinking_delta/toolcall_delta`、contentIndex、toolCall 对象并非原样兼容。[O4][D5]

## Snapshot + live 交接：上游实际做法与适配器缺口

DSH 原生 follow 先注册 durable EventListener 和 assistant listener，共享 queue，再获取带 projection 的 SessionObservation；由 observation 同时构造 opening，并把 durable listener 的 nextExpectedSeq 设为 cursor+1。assistant baseline 与 follower-local arrival ordinal 同步截取，丢弃 ordinal 小于等于 opening cut 的缓存帧，最后先 yield snapshot，再 drain queue。重复 durable seq 被丢弃，跳号抛错。[D8][D12][D10]

Host 可以复用“先订阅、后快照、再过滤缓存”的原则，但 OMP RPC 没有同样的 Observation 或 DSH event journal。已确认的 `get_entries` 返回 entries 与 leaf 的同步读取；**尚未证明**另一个 get_state/get_messages、live assistant baseline 与该响应构成跨命令原子 cut。因此不能只声称“先 get_messages 再订阅即可”。即使只有一个 OMP writer，RPC 事件也会在 await 时发生。[O5]

待证明的 opening 不变量：

1. 在开始 history 请求前连续读取并暂存 worker 输出，限制缓冲和请求时长。
2. 由同一个 entries/leaf 响应建立 durable source identity 集，验证 parent 链完整；不要混用两个时点的 tree 与 leaf。
3. 将缓存的 live 终态与已观察到的 durable entries 对账，明确一个 source entry 对应哪些 DSH events；内容相同的两条消息不能当同一身份。
4. 将与 opening 一致的 assistant accumulated state 与 arrival cut 一起发布；若无法确定是否已 durable settlement，重新读取或失败关闭，不能盲目双发。
5. 交接后只发布 cut 之后且连续的 DSH journal；若 source since 失效、leaf 不连贯、buffer overflow、worker generation 改变，触发完整 rebaseline 或明确失败。

这些是验收约束而非已验证算法；其中第 3 点是当前最重要的 OMP 公共协议缺口候选。

## 可保留的映射与不能冒充的事实

| 源事实 | 内容无损的候选承载 | 需要另行定义/不能恢复的部分 |
| --- | --- | --- |
| SessionEntry.id、parentId、leafId | Host source 索引：`(ompSessionId,entryId) → projected event seq(s)`；保留全树，Conversation 只取当前路径 | DSH 并没有这些 ID 的原生 envelope 槽位；不能占用 sourceEventSeqs。 |
| text / thinking | text / reasoning blocks；签名及 provider 元数据单独核实 | 精确 chunk 时刻与边界冷恢复不存在于普通最终 message entry。 |
| tool call id/name | DSH tool-call block、tool/call.callId；结果按 toolCallId 配对 | 原始 arguments 字符串、OMP 与 DSH tool meta/presenter 的等价性需 fixtures。 |
| OMP 最终 assistant message | DSH assistant/message 的最终 message，使用源 timestamp；建立明确的合成 stream 策略 | 合成 block-end 或 text delta 不能标成 provider 原始 stream；usage/provider/signature 必须逐字段验证。 |
| 本 generation 已接收 delta | 转为 DSH chunks，以 OMP messageId 加 generation 为临时 attempt key | DSH attemptId、revision、dense index、turn/step、startedAfterSeq 是 Host 账本；receipt time 不是原始 provider time。 |
| retry/error/abort 现场事件 | 保留本次看到的 attempt settlement 与 error/cancel 状态 | 冷 OMP 历史不能被假定包含每次未提交 attempt 的完整原始事件。 |
| prompt request id | Host admission/completion 表关联 DSH requestId 与 OMP command.id；保存未决调用状态 | 本次已读公共命令/事件契约未给出 durable user message rpcId 映射；Host 重启后的 exactly-once 重试不可据此承诺。[O7][D1] |
| compaction、branch_summary、reset boundary | 作为 OMP source 事实处理并明确可见历史策略 | “当前根到 leaf 的全部 message”仍不足以定义 reset 后与 compact 后的可见 surface。[O2] |

只读的 source 索引、cursor 映射、subscriber queue、transient stream accumulation 均可是可丢弃内存；一旦需要持久保存 OMP 未保存的 stream/Prompt receipt 来满足既有 DSH 语义，就触及“第二 transcript store”边界，不能默默加数据库解决。

## 候选策略：供后续 HITL 取舍，尚未选择

| 候选 | 思路 | 好处 | 必须接受或验证的代价 |
| --- | --- | --- | --- |
| A：canonical 重建 + generation rebaseline | 从 OMP entries/leaf 生成可重复的 DSH journal；每个 Host generation 重开 baseline；live stream 暂存，durable 以 source entry 收口 | 贴近当前“缓存可重建、OMP 唯一持久化”规则 | 必须定义 canonical seq、合成 turn/step/stream；冷恢复与现场日志如何同构，分支删除尾段怎样替换，需客户端验证。不能声称原生 provider stream 无损。 |
| B：generation 内增量 journal | 运行时合成 DSH boundaries/attempts/projections，缓存 entry→seq；同 generation 浏览器刷新可完整恢复；Host restart 重置 generation | 对审批等待、工具运行中浏览器刷新更自然 | runtime-only markers/failed attempts 冷重建可能缺失；旧 cursor 必须失效，不能当持久 cursor 延续；需要证明 DSH ready/control/journal 的 generation 切换路径。 |
| C：追加 OMP public RPC | 增加 durable append/leaf-change 通知、message lifecycle→entry ID、原子 history+live snapshot token；必要时 entry 分页 | 解决同内容重复消息、竞态、规模及身份 join 的根因 | 需上游设计与版本门槛；仍不自动提供 DSH 原始 stream 事实。不能绕到内部 SessionManager 或解析 JSONL。 |

A/B 并不互斥；表中是待验证的架构取舍。单纯给当前 branch 重新编号后继续向旧订阅 append，会破坏“seq 对应不可变事件”的承诺。DSH surface replace 能替换已有非空 surface 范围，但 OMP rewind 可只删除尾段且换 leaf；是否可用已存在的 replacement 语义表达，或必须重开 projection generation，尚无证明。[D3]

## 必需 fixtures / 实验（本次均未执行）

| 场景 | 必须断言的结果 |
| --- | --- |
| idle 打开、空会话、新 Prompt | cursor=-1 空历史可接受；assistantStream baseline 总存在；accepted echo 最终由唯一 durable user message 收口。 |
| opening 期间 message_end / durable append | snapshot 前后恰好一次；有相同文字/相同 timestamp 的两条消息也不误去重；entry 与 live 不明关联时显式失败或重新读。 |
| 正常 text/thinking、交错 block、tool arguments 分片 | DSH chunk index/revision 连续；每 block 的 authoritative end 与 OMP message_end 一致；签名/usage/工具 ID 不丢。 |
| 并行工具批次、后台 bash 延迟结果 | 所有 call/result 配对；源 activeLeafId 指向已离开分支时不污染当前 Conversation；工具卡 data/meta 兼容。 |
| delta 重启/start、多次自动 retry、error、abort | 不覆盖前次 attempt；committed/abandoned end 正确；中断前缀与未执行 tool call 的显示有明确规则。 |
| 浏览器刷新发生在 stream / tool / approval / ask 等待 | 同一 worker 不重复运行；snapshot 包含当前 transient baseline；互动继续可答且 stale answer 不串 worker generation。 |
| gap、重复 seq、revision/index/settlement 缺口 | 可恢复 carrier loss 走 repair；业务/持久化/连续性失败不吞掉；durable repair 后获得新的 assistant baseline。[D2][D7][D10] |
| backwards page、固定 throughSeq 后继续产生新事件 | page 不跨 cut；无重复缺号；turn/tool 组不被截断；session.page alias 可用。 |
| leaf rewind / 新 branch、fork / reset / compaction | abandoned branch 不出现在 Conversation；旧游标处理明确；full tree 与 active surface 不混同；fork 的 tool batch 边界不残缺。[O1] |
| Host restart / worker crash | 源数据仍可恢复；Host generation 切换；不能自动重放未知 outcome 的副作用 Prompt；不得假装重建了已丢原始 token 历史。 |
| v2 大消息、entry 响应超预算 | 物理 chunk 与业务 snapshot cut 分离；重组/缓冲预算显式；不能静默截断历史。 |
| 同步 builtin、本地失败、agent yield 后后台唤醒 | agentInvoked:false 无需 prompt_result；其他按 id 等待；sessionSettled=false 继续跟踪到静止。[O7] |

## 后续决策所需的具体问题

1. MVP 的“刷新恢复”只要求浏览器 reload（Host/worker 仍活着），还是同样要求 Host/worker 重启后保持现场同样的 event seq/原始 delta？前者可用内存，后者当前证据不支持原样恢复。
2. Conversation 要呈现 OMP 当前分支的可见 transcript，还是压缩/reset 后的模型 context？尤其自动 compaction 与 builtin /clear 的规则应先决定。
3. 是否接受冷恢复合成 DSH stream，并明确只承诺 OMP durable 内容，而不承诺 provider token 轨迹？若不接受，需追加 OMP 公共能力。
4. 开工门槛是否要求上游增加 live↔durable entry ID 关联及原子 cut？当前同内容消息、嵌套注入、background off-branch 使“按内容/位置猜 join”无法作为已证明方案。
5. source→journal 映射、seq generation、branch rebaseline 和 prompt admission 幂等表允许保留多久，Host 重启的行为是什么？不能把这些悄悄变成第二 transcript 数据库。

## 固定一手来源

所有链接均锁定本文 SHA；未引用本机 `evidence/dsh` 的后续 master。

- [O1] [OMP rpc.md：paging、fork/navigation、history/tree 命令](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/docs/rpc.md#pi-compatible-historytree-commands-with-omp-native-entry-payloads)（本机缓存 rpc.md 1051–1069；paging 266–271；fork/navigation 258–260）。
- [O2] [OMP SessionEntry、compaction、reset、tree 类型](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-entries.ts#L100-L124)；compaction/branch/reset 163–214；tree 405 起。
- [O3] [OMP RpcSessionEventForwarder：process-local msg-N 分配](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-session-events.ts#L113-L151)。
- [O4] [OMP rpc.md：messageId、delta、message_end 权威](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/docs/rpc.md#L929-L935)；[超大 agent_end 裁剪](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/docs/rpc.md#L75)。
- [O5] [OMP get_entries/get_tree 处理器](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2345-L2366)；[since 切片](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-compat.ts#L1-L28)；[messages 处理器](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2715-L2744)。
- [O6] [OMP rpc-messages.ts：snapshot-bound cursor 和页预算](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-messages.ts#L1-L142)。
- [O7] [OMP Prompt admission/completion/quiescence](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/docs/rpc.md#prompt-payload)（341–379）。
- [D1] [DSH API session-controller 实际 wire types](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/src/types.ts#L391-L598)；projection baseline 64–73；page alias/events 655–675。
- [D2] [DSH Web SessionEventStream：follow 与 page 实际调用、连续性规则](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/src/client/transport.ts#L137-L250)。
- [D3] [DSH core SessionEventMap、SurfaceOp、SessionEvent](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/core/session/src/types.ts#L280-L531)。
- [D4] [DSH compact AssistantStreamRecord 与 accumulator](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/llm/llm/src/assistant-stream.ts#L1-L194)。
- [D5] [DSH StreamChunk、block schema](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/llm/llm/src/types.ts#L487-L511)；ContentBlockMap 144–159。
- [D6] [DSH client wire validator：不接受额外 envelope 字段](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/src/client/session-wire-event.ts#L1-L51)。
- [D7] [DSH README：journal repair 和 transient settlement 说明](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/README.md#L60)；[client-only live event/window contract](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/src/client/contract/events.ts#L1-L35)。
- [D8] [DSH WebController.follow：先 listener，再 observation/opening](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/src/web/controller.ts#L32-L87)。
- [D9] [DSH paginate 与 source-aware 分页](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/src/history.ts#L121-L181)；[精确 cut 与 projection 读取](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/src/history/controller.ts#L204-L269)。
- [D10] [DSH assistant-stream accumulator](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/src/assistant-stream.ts#L1-L111)；[follower ordinal cut](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/src/history/assistant-stream.ts#L45-L113)；[client settlement state machine](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/src/client/sessions/assistant-stream.ts)。
- [D11] [DSH message id、source、roles、toolCallId](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/llm/llm/src/message.ts#L136-L181)。
- [D12] [DSH EventListener：cursor 过滤、gap 拒绝](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/src/history/listener.ts#L14-L129)。
