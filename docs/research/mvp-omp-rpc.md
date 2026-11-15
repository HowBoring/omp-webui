# OMP 公共 RPC 对本地 WebUI MVP 的覆盖范围

- 研究日期：2026-11-15
- 决策票：[OMP 公共 RPC：MVP 会话、进程与交互闭环的覆盖范围](https://github.com/HowBoring/omp-webui/issues/3)，地图：[OMP WebUI 可用 MVP：关键决策地图](https://github.com/HowBoring/omp-webui/issues/1)
- OMP 基线：`18.20.2`，固定提交 `7c49c11aa5bbaf3f418406583096168ad5b8c6dc`。
- DSH 基线：`dsh-v0.2.2-rc.3`，`38a6a5c965aa99ab525161efb7cc5cf1fe62fced`；本文只核对 Host→OMP 边界，未证明 DSH 浏览器闭环。
- 范围：Linux/WSL2、localhost、单用户、预配置 cwd/模型/凭证，只管理 WebUI 创建的 OMP Session；创建/恢复、流式消息与工具结果、审批/ask、取消、浏览器刷新恢复。不含 TUI 会话发现/导入、分支编辑器、BTW/subagent UI、公共部署。
- 方法：固定 SHA 的官方文档、CLI、服务端、TypeScript client、wire schema 交叉核对。下文“已证实”指源码合同；不是进程实测。

## 结论

选定的窄范围 MVP 并未被“没有全局会话 catalog RPC”阻断。公共 RPC 已覆盖创建、按已知文件恢复、当前会话状态/历史、prompt 流与终态、取消、通用 UI 往返；Host 可以仅保存自己创建时从 RPC 获得的会话引用，形成 WebUI 元数据目录。它不需要读取 OMP session 文件，也不需要发现全局 TUI 会话。但这只是有证据的可行选项，持久化元数据的最终政策仍待用户决定。[R1][R2][R3]

主要缺口在固定版本的 **TypeScript convenience client 公共接口**，并非这些 wire 功能不存在：

1. 通用 extension UI 监听/回答及 `set_ask_dialog` 没有公共方法。
2. `prompt()` 丢弃同步 builtin 的 `data.agentInvoked: false`，仅返回 id；仅监听 `onPromptResult()` 会漏掉该完成路径。
3. `stop()` 是 kill/reap，公共 transport 的 stdin 只有 `write`；没有可表达 graceful stdin EOF 后继续 drain stdout 的公共 client API。[R4][R5]

两条实现候选均遵守 RPC-only：向 OMP 补齐上述公共 client API，或 Host 使用已公开 wire/schema/`RpcFrameDecoder` 自持一个小型 JSONL transport。**不需要为所选 MVP 新增创建/恢复/取消 RPC 命令，也不能借此引入 Agent SDK 内部对象。** 全局 catalog、原子恢复快照等扩展应按实际范围单独决策，不能误记成窄 MVP 的既定前置条件。[R5][R6]

发现两处同一 SHA 的文档与实现不一致，后文以实现为准并列入未来 smoke：`open_session` 对 already-open 会话的 prompt tickets，以及 ask 工具是否可能发送 `input`。[R7][R8]

## 已有能力与精确合同

| MVP 需要 | 已有公共 wire / client | 结果、边界与结论 |
|---|---|---|
| 启动交互 worker | CLI `omp --mode rpc-ui`；默认 client 是 `--mode rpc`，可用公开 `command` builder 或 `spawn` 替换完整 argv | 正常启动不加 `--no-ui`；显式 cwd/argv。看到 `ready` 仍必须处理 startup UI；不能把它当作扩展初始化完成。[R9][R10] |
| 创建新 Session | `{id?,type:"new_session",parentSession?:string}`；`newSession(parentSession?)` | 成功数据只有 `{cancelled:boolean}`，不是 Session descriptor。检查 veto 后发 `get_state` 取身份。显式 newSession 路径会物化空会话；初始 CLI 创建是 lazy persistence，单看初始 sessionFile 不足以宣称可恢复。[R2][R11] |
| 当前身份/状态 | `{id?,type:"get_state"}`；`getState()` | 关键确切字段：`sessionId`、`sessionFile?`、`sessionName?`、`model?`、`isStreaming`、`isCompacting`、`messageCount`、`hasPendingAsyncWork`、`isSettled`、`queuedMessageCount`、`queuedMessages:{steering,followUp,liveSteered}`。**没有 `cwd`、`sessionDir`、`isSessionOnDisk` 字段**；cwd 应来自已授权启动配置。[R3] |
| 精确恢复一个已知 Session | `{id?,type:"switch_session",sessionPath:string,provider?,modelId?}`；`switchSession(sessionPath,model?)` | 输入字段叫 `sessionPath`，不是 `sessionId`/`sessionFile`。成功数据 `{cancelled}`，再读 state。保存模型无法恢复时失败，不能默默切另一模型；指定模型须同时给 provider/modelId。[R2][R12] |
| 目录绑定/恢复最近非空 Session | `{id?,type:"open_session",sessionDir:string,provider?,modelId?}`；`openSession(sessionDir,model?)` | 返回 `{cancelled,resumed,sessionId,sessionFile?}`。选目录中最近非空会话及其 continuation，没有则建新；不是按稳定 sessionId 精确打开。禁用持久化时失败。[R7] |
| Prompt 与流 | `prompt` + `message_start/update/end`、`tool_execution_start/update/end`、`tool_stream_update` 等 | ack 是 admission，通常并非完成。流内 `messageId` 只保证进程内唯一，不能冒充 durable entry id。大 `agent_end.messages` 可裁掉之前完整传过的 messages，不能单用它重建历史。[R13][R14] |
| Prompt 完成 | 同 id `prompt_result:{agentInvoked,status,error?,sessionSettled}` | `status` 为 `completed|aborted|error`；正常 builtin 同步成功 `response.data.agentInvoked:false` 是直接完成且无 result。Session idle 要另看 `sessionSettled`、`session_settled` 或 state.isSettled。[R13] |
| 取消当前工作 | `{id?,type:"abort"}`；`abort()` | 独立响应确认 abort 命令，prompt 自身结果仍靠其 ticket；`abort_and_restore_queue` 可先撤回待处理用户输入再中断，返回 `{steering,followUp,imagesDropped?,truncated?}`，适合明确“取消并恢复草稿”的另一个产品语义。[R15] |
| 持久历史/活动分支 | `get_entries`、`get_tree`、`get_messages`、`get_messages_page` | entries 返回 `{entries,leafId}`，tree 返回 `{tree,leafId}`。append order 不是活动分支；从 leaf 与 parentId 选 root→leaf。分页返回 `{messages,totalMessages,nextCursor?}`，游标绑定 sessionId/leaf/messageCount，busy/stale 是显式 code。[R16][R17] |
| 审批/提问 | `extension_ui_request` / `extension_ui_response`；`set_ask_dialog` | wire 已有，TS client 通用方法缺失。审批通过普通 `select` fallback，不存在专用 `approve` RPC 帧。ask 工具的 HTML 表单逐字段 fallback 与扩展 `ui.askDialog` 原生 `ask` 帧是不同路径。[R8][R18][R19] |
| 退出与输出排空 | stdin EOF；扩展可请求 shutdown | schema 74 条 commands 无 `shutdown`。EOF 拒绝 pending side channels、drain accepted commands/tasks、dispose、drain output，再退出；必须继续读 stdout。client.stop 不等价于此路径。[R20] |
| 拥有权探测 | `get_session_lease:{sessionIds:string[]}`；`getSessionLease()` | 返回 `{held:string[],unknown:string[]}`；held 包含本进程，没有 owner 身份或 reserve。不能拿它当全局列表、原子 lease reservation 或“本进程拥有”的证明。[R21] |

### 创建与恢复：能保存什么，什么不该假设

可保存的最小 Host 元数据候选：

```ts
// 设计候选，不是已实现接口
{
  webuiId,           // Host 创建的键，只用于 WebUI 的管理范围
  ompSessionId,      // 来自 get_state.sessionId
  sessionPath,       // 来自 get_state.sessionFile；提交给 switch_session.sessionPath
  configuredCwdKey,  // Host 已授权配置，不推测 get_state 有 cwd
  displayName?,     // WebUI 展示元数据；OMP sessionName 仍以 RPC 为准
  createdAt?
}
```

这里只保留引用与 WebUI 元数据，不保存消息、工具结果、分支树、凭证或 Agent 状态。恢复时以 RPC state 回读值校验/更新，不能以 Host 元数据覆盖 OMP 身份。目录绑定方案可以另存 Host 选择的 `sessionDir`，但它有“最新非空/continuation”选择语义，与按已知文件恢复不是一个保证。[R3][R7]

一个有源码依据、待实测的创建候选序列：

1. 用已授权 cwd 与 Host 管理的 session storage directory 启动 `rpc-ui`。显式 `--session-dir` 且不带 continue/resume 时 CLI 创建新会话；不应依赖用户全局 auto-resume 设置。[R22]
2. 立即持续处理所有 UI，协商 v2，完成启动。显式发 `new_session`，检查 `cancelled:false`，再 `get_state`，将 RPC 返还身份纳入 Host 元数据。
3. 这样利用 OMP 自己的显式 newSession 持久化路径保证空会话边界，不需要 Host stat/读 session 文件。初始 lazy allocation 路径可能指向尚不存在的文件；**不要仅凭第一个 ready 后的 sessionFile 就写“已持久保存”。**[R11]
4. 冷恢复优先使用已记录的 `switch_session.sessionPath` 或公开 CLI `--resume <path>`；CLI resume 可能跟随 continuation，必须重新读 state。错误、veto、模型不可恢复、身份变化应显式呈现，不能自动重放 prompt。[R12][R22]

已检查服务端调用链：RPC `new_session` → AgentSession.newSession → SessionManager.newSession → `ensureOnDisk()`；这段内部源码只作为证明 RPC 的持久化行为，**不是建议 Host import 它们**。[R11]

身份并非“一个文件路径永远不变”的保证。OMP 会话切换、续接、原生写入拥有权处理可改变引用；Host 要在成功切换后以及适当会话状态边界回读。一个 OMP worker 可只读打开某 Session 而尚未 claim；源码说明首次写入才 claim。原生机制可能迁移到 sibling/continuation，不能假定“别人占用时 switch_session 必然返回冲突”。若产品要求严格拒绝一切外部 TUI 并发并绝不创建 continuation，现有 probe 存在 TOCTOU，可能需要额外公共原子 claim/open 语义；窄 MVP 的管理目录隔离与 Host 内单 writer 可降低该场景，但不是同一保证。[R21][R23]

### `open_session` 的文档差异

官方 rpc.md 说 successful open 即便 already-open no-op 也会把未完成 prompt tickets 标 aborted；固定实现只在 `session.sessionFile !== fileBeforeOpen` 时调用 `promptResults.abortOpen()`。底层 `openRpcSession` 对 already-open live turn 不做 abort。这两个说法在此 SHA 不一致。[R7]

因此 browser refresh 不应借 `open_session`“重新绑定”仍在运行的同一 worker；Host 应保留原 worker，并读取 state/history、恢复 Host 自己的流/交互投影。新进程恢复才使用会话切换。最终兼容测试要直接覆盖 already-open while streaming 的 ticket 与 turn 行为。

## Prompt、刷新和取消的边界

每个 Host prompt 需要自己分配/保存 request id，并同时观察命令响应与 result。候选状态机为：未受理 → 已受理 → result；同步 builtin 的成功响应直接终态。若只等待 `agent_end`，会把非终端 yield、重试/compaction 或背景工作误认为整个 Session 完成；若只等待 `prompt_result`，会永远等待同步 builtin。[R13][R15]

`RpcClient.prompt()` 调用 `#getData(response)` 后丢弃数据，仅返 response.id；`promptAndWait()` 则先注册同 id waiter，检查 `agentInvoked:false` 并正确提前返回。但它返回 `AgentEvent[]`，也未提供完整 result/status 的统一 public 返回合同。若采用 client 路线，建议的最小增量是公开包含 id 与 ack data 的 admission result，或一个覆盖“同步本地完成 + 异步 prompt_result”的公共 prompt handle；这些是候选 API，**固定版本不存在这样的名字**。[R4]

浏览器刷新时 Host 与 worker 持续存活，可由 Host 保存的 pending prompt/UI、流基线、worker generation，与 OMP `get_state/get_entries` 重建浏览器。公共协议不提供“浏览器重连”命令；也未提供进程间 durable request-id ledger、pending UI 查询、原子历史+流 snapshot/replay endpoint。由此推得：

- Browser refresh 所需的在线恢复可由常驻 Host 补齐，不要求扩展 OMP。
- Host/worker 崩溃后恢复 OMP 的 durable transcript 与精确恢复已受理但未完成 request/UI 是不同承诺；不能声称只靠 get_state 就恢复了旧 prompt 的成功/失败，也不能自动重发它。
- `get_messages_page` 在 streaming/compacting 时返回 `code:"session_busy"`，游标失效返 `stale_cursor`。公开 client 的 `getMessages()` 会丢弃部分页并 fallback 到 legacy best-effort snapshot；这不是严格的在线一致快照。Host 的 live-buffer + history reconciliation 算法仍需设计与 fixtures。[R16][R17]

取消语义要选定：普通 abort 与“撤回队列再 abort”是两种 wire 操作；禁用 MVP streaming 时的额外提交可减少 queue 语义，但这是产品选项。取消浏览器流订阅不等于取消 OMP run，必须显式发送取消操作。[R15]

## 审批、ask、启动 UI

### 模式与启动顺序

`main.ts` 把 `mode === "rpc-ui"` 转成 `setToolUIContext`，并独立传 `headless: parsedArgs.noUi === true`。所以：

| 启动方式 | Extension UI | Tool UI / ask |
|---|---|---|
| rpc-ui | 开启 | 开启 |
| rpc-ui --no-ui | extension 默认/无 UI，要求审批时 fail closed | tool dialogs 仍开启 |
| rpc --no-ui | headless | 不启用 tool UI；host-issued login 仍独立 |

普通 rpc 本身也可支持 extension UI，但没有 rpc-ui 的 tool UI context；不能用“rpc 没有任何 UI”概括所有组合。MCP 认证 challenge 未安装 interactive-mode RPC UI handler；本 MVP 已预配置凭证，应把运行时遇到的这种不支持场景显式报错。[R9][R10]

ready 先于 `session_start`。服务端在 initializeExtensions 前开始读 stdin，startup 期间只立即处理 `extension_ui_response` 与 `set_ask_dialog`；包括 `negotiate_protocol`、get_state 的普通 commands 排队。**Host 必须在等待 negotiation response / get_state 之前就能消费并回答 UI。** 这样才能避免扩展启动等待 UI、Host 却等待 negotiation 的互锁。公开 client 的 start 自动协商，但通用 UI 监听私有，因而尤其不适合作为不修改的 interactive startup client。[R9][R10][R5]

### Wire 细节与 fail closed

请求 `{type:"extension_ui_request",id,method,...}`，需要支持 `select|confirm|input|editor|ask|cancel`；presentation/open_url 属另一类 fire-and-forget，不能把每帧当必须回复的 dialog。

回复为四种形状：

```ts
{ type:"extension_ui_response", id, value:string }
{ type:"extension_ui_response", id, confirmed:boolean }
{ type:"extension_ui_response", id, cancelled:true, timedOut?:boolean }
{ type:"extension_ui_response", id,
  answers:Array<{id:string, selectedOptions:string[], customInput?:string}> }
```

取消通知的请求使用 `method:"cancel",targetId`；不能拿 cancel 自己的 id 回答原 dialog。普通 confirm 取消为 false，select/input 取消为 undefined；editor 没有 wire timeout。原生 ask 的超时（包括 Host 发 `timedOut:true`）会选推荐项或第一项，**不等于用户明确拒绝**。Browser 断开/重载不应伪造成 timeout 或批准；保留待回答交互还是显式取消，是需要选定的产品政策。[R18]

RPC 审批没有结构化 `method:"approve"`。requestApproval 在 ui 没有 approve 时调用 `ui.select(full,approvalChoiceLabels(...))`，选择列表可能含一次、Session、永久/目录 grant 与 Deny；回传必须保留精确 option label，未知或缺失答案 deny。不能硬编码“第一项=批准”，也不能把审批误当普通 confirm 布尔值。OMP 配置可能默认 yolo；支持审批 UI 并不意味着每个工具都会弹审批，验收时须用已知会要求审批的配置。[R19]

ask 存在两个不同合同：

- 工具 `ask` 接收 HTML form，RPC 没有 formDialog 实现，因此逐字段走 select/input/editor；multi-select 重复发 select，`checkedIndices` 才是当前勾选状态。
- Extension `ui.askDialog` 只有 Host 发 `set_ask_dialog:{enabled:true}` 后才提供原生 `method:"ask"`，回复 answers 必须按问题顺序/精确 id 与 option labels 校验。[R8][R18]

**固定文档错误：** rpc.md:1306 声称 ask 不发送 input；但 tools/ask.ts:199–209 的 Other、:287–303 的空单行文本均调用 ui.input，非空/多行走 editor；RpcExtensionUIContext.input 直接生成 input 请求。因此支持 ask 必须包括 input，不能根据该文档句省略它。后面 rpc.md 的描述已提 select/input/editor，也显示内部不一致。[R8]

## 公共 client / wire 的最小工作选项

Transport 路线已拆为待用户决策的 [OMP 公共 client 接入：本地 wire transport 还是上游 API 扩展](https://github.com/HowBoring/omp-webui/issues/11)；本文不作选择。

| 选项 | 最小增量 | 优点与限制 |
|---|---|---|
| A：补上游 TypeScript client 公共表面 | 一般 UI listener + response；set_ask_dialog；保留 ack data/统一 prompt 完成；graceful stdin close + output drain；启动前可注册 UI | 复用现有 correlation/framing/client。但需明确上游补丁/版本来源；当前版本不能靠私有字段实现。 |
| B：Host 小型 schema-backed JSONL transport | 使用公开 FrameDecoder + 生成 wire types/schema；实现有界 JSONL 读写、correlation、startup UI、超时、EOF/drain/reap | MVP 不必等新增 RPC；Host 承担 transport 与 supervisor 的测试责任。仍只通过 OMP CLI/RPC。 |
| C：全局 catalog RPC | 只在扩大到任意 OMP/TUI 会话发现时需要 | 对当前仅 WebUI 自建目录不是必要项；不应把全局 catalog 与简单元数据目录混为一谈。 |

公开可重用入口是 `@oh-my-pi/pi-coding-agent/modes/rpc/rpc-frame`（`RpcFrameDecoder.push(value)`）及同目录 rpc-client/rpc-types。package.json 的 `./modes/rpc/*` 映射到 src 下 TS；wire schema 位于上游 `src/modes/rpc/wire/rpc-wire.schema.json`，JSON Schema 2020-12，`x-rpc` 列出 command table、inbound、serverFrame、notification 与 sessionEvent unions。源码 export map 已证实，但**本次没有安装包验证 npm tarball 导出、Bun/native dependencies 或离线解析**。[R6]

FrameDecoder 在 JSONL parse 后重组 stdout chunks，校验连续序号/长度/base64/严格 UTF-8；它不是完整物理 JSONL reader，也不提供语义 schema validation。物理帧上限 1 MiB、重组 64 MiB；stdin 始终 unchunked。Host 仍须在 parse 前控制物理行/缓冲区大小，持续 drain stdout/stderr，并验证 command/UI correlation。[R6][R14]

RpcAgentProcess 公开 transport 的字段是 `stdin.write`、`stdout:ReadableStream<Uint8Array>`、`peekStderr()`、`kill(signal?,graceMs?)`、`exited:Promise<number>`；options 有 command/spawn/cwd/env/provider/model/sessionDir/args/terminationGraceMs/customTools。client 内部 `#extensionUiListeners` 和 `#writeFrame` 仅被 login 特定流程使用，不构成可调用的通用 UI API。rpc.md “plus extension UI requests” 不能据此当作 public listener 已存在。[R5]

EOF graceful path 已由 rpc-mode 源码证明；但它会 drain accepted work，不意味着任意进行中的模型/工具都立刻结束。Host 要先选定 abort/settle 策略，再停止提交、关闭 stdin、持续 drain stdout、等待 exit，超出关闭预算再 kill/reap；限时属于 Host 政策，非一个现成 shutdown RPC。仍带 persistence failure 时 exit 1；正常 exit 0。[R20]

## 元数据目录的选项与已有架构文字冲突

当前 docs/architecture.md §6.3 为完整 DSH sidebar 要求上游 global catalog；§9 说 MVP 内存 + OMP-native persistence，持久化 WebUI 元数据“may later”。缩小到仅 WebUI 自建会话后，可按以下两案决策：

- **持久化 WebUI 元数据目录**：只保存从 RPC 得到的引用和展示信息，Host 重启还能列出 WebUI-created Sessions，能保留显式创建的空会话。失去该元数据后不保证自动发现旧会话；不扫描 OMP 文件补救。
- **Host 内存目录**：浏览器刷新可以恢复，Host 重启后失去目录；会话仍由 OMP 保存，但 WebUI 没有发现入口。这可满足“刷新恢复”的严格字面范围，却未必满足用户对“以后继续会话”的预期。
- **全局 catalog 公共扩展**：只在用户要求目录丢失恢复、任意 TUI 会话发现/导入时重开；不是前两案的隐含依赖。

以上是方案分析，不是替用户批准持久化政策。若采用第一案，需要在后续 spec/ADR 同步明确 §6.3 的 MVP 例外与 §9 的允许元数据清单，保持 transcript 仍由 OMP 唯一持有；本研究未修改这些架构文件。

## 本次实际执行与尚未验证

实际执行：

- 只读工作树 AGENTS.md、domain 指引、architecture、RPC-first ADR、upstreams.lock。
- 用 GitHub 官方连接器按固定 SHA 读取 rpc-mode/main/CLI args/ask/approval/运行初始化、会话管理/存储、extension runner、rpc-frame、wire schema；读取已有缓存的 rpc.md、rpc-client.ts、rpc-types.ts、package.json。
- 本地文本搜索/逐行比对，Python json 解析 schema：74 commands，确认所列精确 params/results，未发现 catalog/list_session/shutdown command。
- 只写本研究文件及 work/research-omp 临时证据；未更改运行时代码、提交、推送或修改 issue。

没有执行：OMP 安装/import、native dependency 加载、真实 rpc-ui 进程、模型调用、工具执行、approval/ask round trip、stdin EOF/backpressure/lease 并发实验、Linux/WSL2 matrix、DSH UI/Playwright。**这些结论不能替代集成验收，也不能据此说 MVP 已运行。**

后续最小非 LLM smoke 应验证：包 public exports 可解析；rpc-ui ready→startup dialog→v2 negotiation；new_session→state→冷 switch 恢复空/非空 Session；同步 builtin ack 无 result；模拟审批 select、ask input/editor/native ask；abort 与 pending dialogs；already-open open_session；stdin EOF drain/非零 persistence failure/kill fallback。LLM 流与工具闭环另做一次真实验收，不能只用 mock 宣称成功。

## 留给用户的决策点

1. “恢复会话”是否包含 Host 重启后仍能在 sidebar 找到 WebUI-created Sessions？若是，选择持久化引用目录，还是接受上游 catalog 的更大范围？
2. Browser 短暂断开时保持 pending approval/ask 直到重新连接，还是显式取消？必须避免把断线解释为同意或 timedOut 默认选择。
3. 采用补齐公共 TypeScript client，还是 Host 自持 schema-backed transport？两者可复用的 public wire 能力相同。
4. MVP 是否需要对外部 TUI 同时打开同一已知会话作严格原子拒绝？若需要，单独评估 atomic claim/open RPC；管理目录隔离与 lease probe 不能证明该保证。

## 固定源码引用

[R1]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/wire/rpc-wire.schema.json#L1-L15
[R2]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-types.ts#L58-L66
[R3]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2260-L2305
[R4]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-client.ts#L734-L745
[R5]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-client.ts#L68-L115
[R6]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-frame.ts#L193-L249
[R7]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2229-L2254
[R8]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/tools/ask.ts#L190-L311
[R9]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/main.ts#L2853-L2864
[R10]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L1722-L1758
[R11]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-manager.ts#L2511-L2515
[R12]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/docs/rpc.md#L381-L405
[R13]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/docs/rpc.md#L339-L379
[R14]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/docs/rpc.md#L37-L81
[R15]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2025-L2110
[R16]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-compat.ts#L1-L25
[R17]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-messages.ts#L1-L140
[R18]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/docs/rpc.md#L1300-L1427
[R19]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/tools/approval.ts#L866-L948
[R20]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2913-L2979
[R21]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-storage.ts#L635-L663
[R22]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/main.ts#L1324-L1382
[R23]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-manager.ts#L2403-L2419

补充定位（与上述简引用共同使用）：

- [CLI 最初创建 lazy、已分配 path 不等于可恢复](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-manager.ts#L3265-L3293)
- [RPC→AgentSession→SessionManager 的 newSession 调用链](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/agent-session.ts#L12323-L12370)
- [openRpcSession 实际目录选择与结果](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L918-L964)
- [TypeScript client 私有 UI listeners 与默认 rpc argv](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-client.ts#L365-L418)
- [client.stop kill/reap](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-client.ts#L557-L580)
- [client.promptAndWait 特判 builtin](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-client.ts#L1524-L1558)
- [UI listener 仅 login 特定流程使用](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-client.ts#L1351-L1402)
- [RpcExtensionUIContext.input 与 headless 开关](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L1577-L1584)
- [初始化 headless UI 与事件订阅](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L1790-L1817)
- [process 内 messageId 及 delta/full 更新](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/docs/rpc.md#L931-L937)
- [schema 及生成客户端说明](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/docs/rpc.md#L1746-L1802)
- [package public export map](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/package.json)
