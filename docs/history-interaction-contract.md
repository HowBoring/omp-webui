# MVP 历史交互合同

Status: 用户已确认交互流程；以下为实施与验收目标，尚未实现历史界面或真实 RPC 闭环。

确认日期：2026-11-15。用户对原型的答复：“接受，按此形成 MVP 历史交互契约（推荐）”。
决策：[Tree 与手动历史恢复：最小交互原型及验收边界](https://github.com/HowBoring/omp-webui/issues/21)。
本合同细化 [MVP 范围 ADR](adr/0002-native-session-mvp.md)，不改变 RPC-only、单活跃顶层 worker
或原生 Session 唯一保存历史的边界。

## 已确认的流程

1. 选择树节点仅改变选择/预览，不改变 Session、活动路径或 leaf，也不发送 prompt。
2. 使用两个独立动作：“在原会话回到这里”和“从这条用户消息新建会话”。
3. 执行前预览当前 Session、目标节点、将保留的历史点、是否新建会话及返回草稿。
   两种动作都需确认：文件和外部操作不会回滚，返回草稿仍需手动发送。
4. 返回文字放入未发送草稿，不自动提交。新建分支后明确展示新的原生 Session 身份，
   原 Session 仍保留在列表；同会话导航不被呈现成新建会话。
5. 执行中先请求停止并等待真实静止，再由用户重新发起历史操作。停止请求成功不等于静止；
   不将原先被阻止的导航/分支自动排队或在停止后执行。

这是行为约定，不冻结原型布局、假数据结构、按钮像素或未讨论的草稿持久化策略。

## 视图与准入

- 分别展示所选节点、当前原生 Session 身份、当前活动路径/leaf、worker 状态与未发送草稿。
  完整 Session Tree 与 Conversation 活动路径是不同视图；append 顺序不代表当前分支。
- 树和活动路径均来自公共 RPC 的权威历史。正常读取使用 `get_tree`、`get_entries` 等已公开能力；
  Host 不读取/解析 Session 文件，不在引用索引内保存第二份树或 transcript。
- 所有操作受[本机访问合同](local-access-contract.md)、工作目录授权和
  [目录合同](session-catalog-contract.md)约束。历史按钮不能扩大目录或 Session Source 授权。
- 外部 owner 占用期间只显示目录元数据与占用原因，不读取或展示历史/树；旧进程自行退出后
  才能手动重新打开。首次打开已登记但接续失败时，保留登记和原因。
- 本 Host 正在执行、停止尚未完成、结果不明或状态过期时，不提交历史修改。Host 也必须
  执行准入，菜单隐藏不能代替拒绝快捷键或其他入口。具体并发/交互仲裁遵守
  [交互生命周期合同](interaction-lifecycle-contract.md)。

## 动作与固定公共 RPC 的对应

基线：OMP `18.20.2` / `7c49c11aa5bbaf3f418406583096168ad5b8c6dc`；
DSH `dsh-v0.2.2-rc.3` / `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`。
下列命令已存在，不是新浏览器 API；DSH 侧接入仍沿公开 Remote/slot 边界。

| 用户动作/目标 | 原生行为与呈现 |
| --- | --- |
| 选择/预览任一节点 | 只改变浏览器选择，不调用历史修改命令 |
| 原会话导航到普通用户消息 | `navigate_tree` 以 `entryId` 定位；活动 leaf 回到该消息的 parent，文字作为 `editorText` 返回；原路径仍留在同一 Session 树中 |
| 原会话导航到普通助手/工具节点 | `navigate_tree` 保留到该节点；必须以实际回读的 leaf 呈现结果 |
| 从历史用户消息新建会话 | `branch` 以 `entryId` 定位；新 Session 保留到该用户消息的 parent；回复提供 `text` 和 `cancelled`，不能从中杜撰新 Session ID |
| 非用户节点新建会话 | 不作为 `branch` 支持的起点；说明原因并让用户选择历史用户消息 |
| 请求 ask 重答目标 | 当前 RPC 可以返回 `ask_reanswer_unsupported`；显示原因、保留选择，不伪造完成或自动回答 |

“普通节点”的例子不覆盖所有原生 entry 类型。custom message、compaction、summary、hook 等
可能改变草稿或 leaf；不得把原型的 user/assistant/tool 分类当成完整 wire schema。
本次不决定额外 summary 控件或自动总结策略，不能把原型未生成 summary 当作上游保证。

确认预览是执行意图，不是完成事实。提交前检查会话/worker 代次、所选节点和当前权限；
不在陈旧预览下操作另一会话。成功后通过公共 RPC 回读 Session 身份、树和活动 leaf，
再更新登记、选择及 Conversation。分支身份只在验证后进入列表，不能以相似标题推断。

## 停止、失败、取消与恢复

- 停止流程区分“已请求”和“已静止”。不以 abort 回执、单个 `agent_end` 或浏览器流关闭
  当成可以导航的证明；quiescence 依据遵守[transport 合同](rpc-client-contract.md)。
- `navigate_tree` 的 `session_busy`、`entry_not_found` 和 `ask_reanswer_unsupported`
  使用真实错误语义。过期节点需要重新读取和选择，不自动换目标、重试或重发 prompt。
  `branch` 的失败遵循其实际回复，不假定与 navigate 共享上述错误码。
- 用户取消确认时不提交修改。原生回复表示 cancelled/aborted 时不展示虚构成功，
  不自动重试或发送草稿；必要时回读实际状态。总结取消和 pending UI 处理遵守上述生命周期合同。
- worker 退出或请求结果丢失时显示失败/结果未知；不自动重启执行，不重发 prompt/工具，
  也不重试可能已经提交的 branch/navigation。重新打开后以原生身份和历史重建结果为准。
- 原 Session 的严格接续、缺失/替换引用和 owner 竞争仍需公共 OMP 扩展保证；不得用固定版本
  `switch_session` 的回退创建行为冒充恢复成功，不夺锁或结束未知外部进程。
- 手动 `/retry` 与树导航/新建分支分别呈现。retry 受原生状态条件约束且可能重跑工具；
  它不是任意崩溃的一键修复。字面 `/tree`、`/rewind` 不是可盲发的 RPC text handler。

## 刷新、草稿与附件边界

[投影合同](projection-contract.md)进一步确认：历史导航显示成功前必须取得原生实际位置的
可恢复持久保证；即使尚未发送新消息，重新打开后也保留该位置。当前普通导航 ack/leaf 回读
只证明内存状态，正常退出可能追加记录保留路径，但不能代替立即提交保证；公开兼容构建需补齐。
失败/结果未知仍按上文处理，不由 Host 保存目标后自动导航来冒充恢复。

普通刷新/重开 Browser View 不创建 Session 或重复 prompt。已有本 Host worker 应复用；
Conversation 根据权威活动分支重建，其他路径保留在 History 中，不追加成当前对话。
snapshot/live 缓冲、游标、代次和重建遵守投影合同；需要公共一致性与 DSH 统一失效接缝，尚未实现。

原型只有内存状态；其中的“模拟刷新”不是实际浏览器持久化或重连证据。后续[附件合同](attachment-contract.md)
已确认页签＋Session 草稿恢复与新回执政策；跨标签页隔离、真实刷新/Host 重启及已有草稿冲突仍须验证。

新图片/文件输入仍为 MVP 必需项。固定 `branch`/`navigate_tree` 回复提供文字草稿，不能
据此宣称图片/文件草稿已完整恢复。附件回执、原始内容与历史引用的关联、无法恢复时的提示，
以及必要的公共 RPC 扩展，遵守附件与投影合同；不能静默丢弃附件或读取任意原生路径补洞。

## 原型证据与产品验收

[一次性原型及运行说明](https://github.com/HowBoring/omp-webui/tree/926abbbbfe5a409e8e353c31ed4f976f6fb92881/experiments/history-navigation-prototype)
保存在 `prototype/history-navigation`，主分支只保留已确认决策。
[浏览器检查记录](https://github.com/HowBoring/omp-webui/issues/21#issuecomment-6896455677)
覆盖六个引导场景和自由操作、普通助手节点切换路径、显式发送一次、窄屏与深色预览。
这些证明模拟器可操作，不证明 OMP/DSH 产品集成已经通过。用户本次确认的是上述交互流程。

以下是后续真实实现的验收目标，不是已通过测试：

| 场景 | 必须观察到的结果 |
| --- | --- |
| 只选择树节点 | Session/leaf、活动投影、发送次数不变，无历史修改 RPC |
| 同会话用户点导航 | 同一原生 Session、parent 历史点、未发送草稿，原路径仍可从树访问 |
| 普通助手/工具点导航 | 以实际目标及回读 leaf 重建活动路径，未混入其他分支 |
| 用户点新建会话 | 验证新原生身份；原会话仍保留，新历史截止到 parent；没有自动提交返回文字 |
| 取消确认或原生取消/拒绝 | 无虚构成功、自动替代目标或重发；保留明确原因，按需回读 |
| busy → 请求停止 → 等待静止 | 停止回执后仍阻止历史修改；确认静止后需要用户重新发起 |
| 陈旧节点、身份/worker 改变、迟到结果 | 不将旧预览或回复应用到新会话，重新校验，不自动重试 |
| 外部占用、登记后打开失败 | 保留引用与原因，无历史/树；旧进程退出后显式接续，无抢占或隐式新建 |
| 进程退出、EOF 或 branch 结果未知 | 不重放；显式重新打开后核对实际身份/历史，不凭猜测重复 branch |
| 真实刷新/重连 | 复用允许复用的 worker，重建正确活动路径，不创建 Session、丢失或重复消息 |
| 带附件的历史用户点 | 明确保存/恢复或不可用原因，未静默降成纯文字；需附件合同和相应 RPC 能力 |
| 任一历史操作后的真实文件/外部效果 | 不回滚；确认提示准确，不能把上下文变化称作文件恢复 |

## 后续工单与固定一手来源

- [原生会话 MVP 的交互所有权与取消、断线策略](https://github.com/HowBoring/omp-webui/issues/22)：
  已确认[交互生命周期合同](interaction-lifecycle-contract.md)，包括联合静止判断和停止/撤权预算；真实验证仍待完成。
- [原生历史与树导航的投影、游标和重建规则](https://github.com/HowBoring/omp-webui/issues/23)：
  活动分支替换、snapshot/live 一致性、重连及草稿/未知 entry 的安全呈现。
- [OMP 公共 RPC 扩展：目录、严格接续与交互取消的交付门禁](https://github.com/HowBoring/omp-webui/issues/25)：
  公共目录、保护身份/所有权的接续保证，以及不会默认作答的交互到期/取消保证。
- [图片与文件输入：格式范围、RPC 链路与存储边界](https://github.com/HowBoring/omp-webui/issues/28)：
  附件输入、回执与历史/草稿恢复，必要的公共 RPC 增量。
- [DSH 导航与能力接缝：自动创建及动作门禁实证](https://github.com/HowBoring/omp-webui/issues/27)：
  所有入口的行为控制、公开接缝及实际构建验证。
- [固定 RPC navigate handler](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2167)
  与[原生用户目标行为](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/agent-session.ts#L15007)。
- [固定 branch handler](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L898)
  与[原生新建分支](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/agent-session.ts#L14533)。
