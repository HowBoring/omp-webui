# MVP 交互、停止与断线生命周期合同

Status: 用户已确认六项政策；以下为实施目标，Broker、停止流程和公共 RPC 增量尚未实现。

确认日期：2026-11-15。决策：[原生会话 MVP 的交互所有权与取消、断线策略](https://github.com/HowBoring/omp-webui/issues/22)。
取舍见 [ADR 0007](adr/0007-interaction-lifecycle.md)。基线保持 OMP 18.20.2 /
`7c49c11aa5bbaf3f418406583096168ad5b8c6dc`、DSH dsh-v0.2.2-rc.3 /
`38a6a5c965aa99ab525161efb7cc5cf1fe62fced`；政策批准不代表固定版本已提供全部保证。

## 已确认政策

| 决策 | 已选行为 |
| --- | --- |
| Q1 回答者 | 任一当前有权访问该会话的已登录页面可答；首个业务校验通过的答复结算，其他旧回复失效；不设独占控制页 |
| Q2 普通断线 | 全部浏览器页面暂时断开后，已开始的执行继续；存活 Host/worker 内保留仍有效交互，重连重新展示；不跨重启恢复旧请求 |
| Q3 忙时输入 | 可编辑草稿、回答交互和停止；不接受新的 prompt、steer 或 follow-up 入队 |
| Q4 等待期限 | 默认 30 分钟，可由 Host 配置调整；从交互创建起算，刷新/断线不重置；到期明确取消并请求停止，不生成默认答案 |
| Q5 普通停止 | 取消待答 UI/摘要、撤回未执行队列后请求中断；安全恢复草稿并提示损失；等待静止，30 秒未停妥时由用户确认强制结束 |
| Q6 权限和关闭 | 当前浏览器失效只撤销其资格；全撤销停止全部 Host worker，目录撤权停止失去授权的 worker；这些安全终止及 Host 关闭采用 30 秒协作/排空加 5 秒终止宽限，再必要强制结束并回收 |

新图片/文件输入仍是 MVP 必需项。忙时编辑草稿不代表向 OMP 排队；上传、回执与附件恢复
继续受[附件合同工单](https://github.com/HowBoring/omp-webui/issues/28)约束，不由本表推定永久草稿或附件存储。

## Broker 关联、答复与状态

- 一次交互关联当前授权范围、原生会话或明确的启动上下文、Host worker 代次、OMP UI id、
  DSH Agent scope、eventId 与回答页面的 Connection clientId/Peer。它们不是同一个 ID。
  字段是各自协议和 Host 内部关联事实，不构造一个未经定义的新浏览器 wire 合同。
- 只有仍有效的凭据、目录/会话权限、活跃投递与当前 worker 的答复可以参与结算。
  “同一 owner”不能绕过资源授权、重连代次或 UI id 检查；不同凭据的撤销须分别生效。
- Host 原子地选择首个有效答案或明确取消，对同一 OMP 请求最多转发一次结算回复。
  回答内容按同版本公开 schema 及原始问题校验：精确问题顺序/id、option label、类型、
  单/多选数量等。未知值、错误回答者、重复或旧回复不能被转换成默认选择。
- DSH Gateway 的首个 result/rejected 是传输层结算，不自动等于有效的 OMP 答案。
  若无效内容已结束一轮 DSH 投递，Broker 保持仍有效的 OMP 请求，按公共 source 生命周期
  重新呈现并保留原 deadline；不能伪报该答案已被 OMP 接受。失败重呈现需有界并显示原因。
- `next` 表示未处理/委托，不是拒绝或同意；传输错误也不是用户明确取消。缺 handler 或不支持
  的交互应显式报兼容性失败、取消并进入停止处理，不能落到默认允许的后备路径。
- pending 与已回答、明确取消、期限取消、原生取消和结果未知分别记录。写入回复不等于
  OMP 已收到或任务完成；现有 UI response 没有独立确认。丢失进程/关联时保留未知结果，
  不重放可能已消费的答案、prompt 或工具；有限元数据保留用于迟到回复拒绝。

`select`、`confirm`、`input`、`editor` 和 opt-in `ask` 是不同交互。`method:cancel` 是针对
`targetId` 的撤销通知，不是另一个待回答问题；presentation/notification 也不能当成审批。
OMP 审批目前可走 `select` 的精确选项标签，不存在可杜撰的专用 approve 帧。[S1][S2]
“Deny”是明确回答；取消问题与停止整个执行分别呈现。取消待答交互不伪造拒绝文本或
布尔同意；Native ask/tool 的后续结果遵守其真实合同。需要停止整个会话时使用下述停止流程。

## 断线、重连与启动

- 普通断线只结束该页面的投递/回答资格，不结束存活 worker。其他有权页面仍可回答。
  所有页面离线也保留执行和仍 pending 的 UI，直到原生结束、明确取消或 Host deadline。
- 同一 worker 的未结束 OMP UI 请求可以用原 id 重新呈现；旧 clientId/Peer 不能因此复活。
  stock DSH 重连分配新 clientId，重投仍 pending 的同一 eventId；只有重新发起 source
  invocation 才得到新 eventId。不要假设每次刷新都会改变 eventId。[S3]
- DSH `userQuestions.attachWait` 的多 claim 不是独占控制权。`userQuestions.answer` 是
  continued question 的 Inbox 路径，不代替前台 waterfall 回复。OMP UI 不因 DSH projection
  存在就获得跨 worker 重启的恢复能力。[S4]
- Host/worker 退出后旧 UI id 不再是可恢复的请求。有效登录 Cookie 仅恢复访问资格；
  重新打开以原生历史/身份为准，不构造旧 TUI owner 的 pending UI，不自动重发任何操作。
- Broker 必须在启动 worker 前安装接收路径。OMP ready 可以先于扩展启动 UI；初始化期间
  只有 UI response 与 `set_ask_dialog` 立即处理，协商/get_state/abort 可能仍排队。
  不等待这些普通命令完成才开始处理 UI。[S5]
- 启动交互绑定受控 cwd、worker 与预计原生引用；身份尚未回读时不伪造一个原生 Session。
  在可验证启动上下文呈现或明确失败，初始化和交互未完成前不开放普通输入。
  停止启动时先取消已知 UI，并拒绝后续新 UI；取消不保证任意扩展初始化会结束，必要时走
  已授权的 Host-owned worker 关闭流程。

## 等待期限与必须补齐的公共保证

Host 使用 Broker 创建 pending 记录时的单调时钟计算 30 分钟默认期限。该时间不是协议
未提供的 OMP 原生创建时间；重新投递、刷新、切换页面与断线都不刷新它。配置调整作用于
之后创建的交互，不隐式延长已有请求。期限/取消在所有回答页面同步失效。

Host 期限到达时发起明确取消并请求停止，记录“等待到期”，不将 `timedOut:true` 作为网页
断线或安全取消的代名词。原生取消通知、已经结束的请求、失败和未知结果不重新开放为可答。

**固定公共 RPC 不能保证所有 timed ask 都按此结算。** Native ask 的原生 timer 或
`timedOut:true` 可能提交推荐/第一项；HTML-form tool fallback 还可能将临近期限的明确取消
推断成 timeout 并返回默认表单。更早的 Host timer、`set_ask_dialog` 或关闭网页都不能
消除这场竞态；无 deadline 的已知子集可行不等于任意扩展/配置都可用。[S6]

所需公共 server 增量是语义保证，不在此发明方法名：在请求开始前可以公开验证“只有有效
显式答案才提交”，原生/tool 两类 expiry 都以取消/到期结束，原子失效并拒绝迟到回复，
取消原因不能再被 elapsed-time heuristic 改成默认作答。wire/schema/handler/client 与实际
worker 构建一起锁定并实验验证；只在 Host 收到 timed 请求后拒绝它不足以提供该保证。
缺少可验证保证时标记相关能力不兼容，不宣称严格取消已实现，不导入私有 SDK 补洞。
交付选择由[OMP 公共 RPC 扩展：目录、严格接续与交互取消的交付门禁](https://github.com/HowBoring/omp-webui/issues/25)承接。

## 普通停止和静止准入

1. 原子进入 stopping，拒绝新输入和正在停止范围内的 UI 回答。忙时拒绝必须在 Host 执行，
   包括快捷键、重复点击与并发 Remote，不只禁用 composer。
2. 取消已知 UI；期间出现的新 UI 不再提供回答资格。历史摘要使用公开
   `abort_branch_summary`，它能越过排队的 `navigate_tree`；普通 abort 不保证能越过它。
3. 适用阶段调用 `abort_and_restore_queue`，先撤回未执行用户队列，再中断执行/目标继续。
   返回输入仅恢复为未发送草稿；`imagesDropped`、`truncated` 或已有草稿冲突必须可见，
   不静默覆盖、不声称完整恢复。附件不足的重建由附件合同和必要的 RPC 增量处理。[S7]
4. 持续消费协议帧，分别跟踪停止请求、各 prompt 的终态和原生 settled。除原生静止条件外，
   还必须没有 Host 已知 pending Interaction、历史操作或其他 busy 工作，才准入新输入/历史修改。
   `isSettled` 不覆盖全部 UI/summary；abort 回执、单个 agent_end 或 UI 关闭都不是充分条件。[S8]
5. 30 秒未停妥仍显示 stopping/实际原因，并提供单独的“强制结束本 Host worker”确认操作；
   普通停止不因这个提示期限自动 kill。用户确认后才终止并回收受监管进程，必要的终止宽限
   和最终强制回收仍有界。后台工作未结束时不能声称整个会话已静止或所有子任务已停止。

通用 abort 并不证明每种后台任务/子代理都已结束。原生取消覆盖和后代清理由真实集成验证；
强制结束会保留未知/中断结果，不自动 replay，也不回滚工具已发生的写入或外部效果。
历史操作继续遵守[历史交互合同](history-interaction-contract.md)：确认静止后由用户重新发起。
`/retry`、重新提交 prompt、History Navigation 与 Branched Session 是不同的明确用户动作。

## 权限撤销与有界关闭

| 事件 | 准入与正在运行的工作 |
| --- | --- |
| 当前浏览器退出/到期 | 持久撤销该凭据及其全部页面/Peer；拒绝其新请求/回答和旧缓存权限；其他有效浏览器和已开始执行继续，离线交互仍受原 deadline 约束 |
| 全部浏览器授权撤销 | 立即使旧凭据/Peer 和回答资格失效，并停止全部 Host-owned worker；保留目录 grant，重新引导不恢复旧请求 |
| 工作目录授权撤销 | 立即拒绝失去有效目录授权的操作/订阅/回答，停止受影响 worker；若另有有效 grant 则按实际覆盖校验，不终止未知外部 owner |
| Host 关闭 | 停止新准入，取消交互并关闭、排空和回收所有受监管 worker；不留下无人监管的旧执行 |

后三种事件从进入停止处理起共享 30 秒协作停止/输出排空预算，不为每条 RPC 重新计时。
取消 UI/摘要、执行适用中断、关闭 stdin 后仍持续读取 stdout/stderr；EOF 会排空已受理工作，
不等于立即停止。普通命令卡住不能阻止进入关闭阶段。30 秒耗尽仍未退出时终止受监管进程，
给 5 秒终止宽限，之后必要强制结束并回收；不存在可调用的假 shutdown RPC。[S9]

预算规定升级时点，不保证操作系统一定在该时刻完成退出。只有观测到静止/退出并完成必要
清理才报告相应状态；失败继续显示停止未完成或结果未知。所有 kill/reap 仅针对 Host
实际监管的进程和已验证后代，不能接受浏览器任意 PID，不杀外部 TUI，不恢复已撤销资格。

## 实施与验收门禁

以下均待实现，不是本次已通过的运行测试：

- 双页面有效回答竞争、无效首答后重呈现、cancel/next/error 区别、重复与迟到回复；按
  Session/worker/client/event/UI id 和当前授权隔离，不能把 Gateway 先到结果直接当业务答案。
- 同 worker 刷新和所有页面断线后继续、仍有效 UI 重投、原生先取消、跨 Host/worker 重启旧回复
  失效；Host 期限不重置、不保存第二份 transcript 或 durable pending UI 数据库。
- startup UI 先于协商/状态响应，启动时停止/再次发 UI/初始化不退出；公开 DSH 接缝与启动
  上下文需真实浏览器验证，不能虚构可操作 Session。
- 首个输入准入/忙时输入竞争、队列撤回、草稿冲突、imagesDropped/truncated；真实附件链路
  需[附件合同工单](https://github.com/HowBoring/omp-webui/issues/28)验证。
- native ask 与 tool fallback 的 deadline/取消竞争、未响应/延迟投递、配置变化、重复/迟到答案；
  公共 server 保证必须覆盖原生生成默认答案的路径，不能只测 Host 发送帧。
- 停止期间 UI、summary、retry/goal/后台任务和 prompt_result 顺序；原生 settled 与 Host
  交互/操作空闲联合准入；停止后不自动重做被阻止的历史动作。
- 单凭据退出与全撤销、重叠目录 grant、旧 Peer、运行中撤权、30+5 秒升级、EOF 尾帧与
  非零退出、进程/后代回收；观测结果真实，外部 owner 不受 kill 影响，未知结果不重放。

最终投影/重连算法仍由[原生历史与树导航的投影、游标和重建规则](https://github.com/HowBoring/omp-webui/issues/23)细化；
公开客户端接缝由[DSH 导航与能力接缝：自动创建及动作门禁实证](https://github.com/HowBoring/omp-webui/issues/27)验证。
固定源码事实与六项用户选择构成本次证据；没有运行真实 OMP/DSH 交互或实现 Broker。

## 固定一手来源

- [S1 UI dispatcher / pending map](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L394-L404)；[UI types](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-types.ts#L792-L836)
- [S2 approval select fallback](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/tools/approval.ts#L874-L948)
- [S3 Gateway admission/reconnect](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/gateway/src/index.ts#L497-L591)；[settle/detach](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/gateway/src/index.ts#L693-L761)
- [S4 continued question operations](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/interaction/user-questions/src/index.ts#L156-L272)
- [S5 startup dispatch](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L1734-L1758)
- [S6 native ask timeout](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/extensibility/extensions/types.ts#L205-L223)；[RPC timer](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L1298-L1318)；[tool heuristic](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/tools/ask.ts#L147-L152)
- [S7 abort/restore](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2095-L2103)；[bounded restored queue](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L737-L778)
- [S8 settlement predicate](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-settle.ts#L22-L29)；[summary cancellation bypass](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L425-L440)
- [S9 EOF drain](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2960-L2979)
