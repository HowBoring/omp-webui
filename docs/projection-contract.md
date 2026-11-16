# 原生历史、树与 Conversation 投影合同

Status: 用户已确认 Q1–Q3；投影、公共扩展与真实集成验证尚未实现。
日期：2026-11-16（Asia/Singapore）。决策：[原生历史与树导航的投影、游标和重建规则](https://github.com/HowBoring/omp-webui/issues/23)。
取舍见 [ADR 0010](adr/0010-native-history-projection.md)。本文定义语义目标与工程不变量，不编造现有 wire 字段或新方法名。

## 已确认产品政策

| 决策 | 已选择 |
| --- | --- |
| Q1 历史呈现 | 聊天区保留当前活动分支上 OMP 仍可读取的历史；压缩/重置前旧段默认折叠并标出原生边界，其他分支在树中查看。历史展示不等于模型实际输入，原生裁剪按现状提示，不由 Host 补造；不新增 Web 清空命令 |
| Q2 重建保真 | 同 Host/worker 存活时刷新恢复运行状态；需要重建视图时允许更换显示游标、重新加载原生历史并提示同步，保留按既定政策可恢复的未发送草稿。Host/worker 重启后手动重新打开，只恢复原生已持久化事实，不保证原始 token 分块、时间和未落盘尝试完整重现，不重放执行 |
| Q3 导航位置 | 历史导航显示成功前，必须由 OMP 公共 RPC 与原生持久状态保证所选实际历史位置可在重启后恢复，即使之后尚未发送新消息；Host 不另存树或自动重放导航。该保证需在公开兼容构建中补齐并实测 |

沿用[历史交互](history-interaction-contract.md)、[交互生命周期](interaction-lifecycle-contract.md)、
[附件](attachment-contract.md)、[本机访问](local-access-contract.md)及[RPC 交付](rpc-delivery-contract.md)合同。
单次选择只预览，导航与新建分支分别确认，草稿不自动发送；忙时先停止并确认静止，再由用户重新发起。
外部 owner 占用期间不开放历史/树，投影重建不扩大授权或抢占进程。

## 固定上游事实与缺口

基线为 OMP `18.20.2` / `7c49c11aa5bbaf3f418406583096168ad5b8c6dc`，DSH
`dsh-v0.2.2-rc.3` / `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`。以下均为源码核对，不是运行证据。

- OMP `get_entries` 返回追加顺序的 entries 和当前 leaf；`since` 只切出指定 entry 之后的追加项。`get_tree` 提供完整 entry/children/label 和 leaf。它们没有公开分页、内容版本或与 live 共享的快照水位；追加末尾也不一定是当前 leaf。[O1]
- `get_messages` 是运行中的 Agent 消息。普通压缩通常保留更早的原生 entries，但工具裁剪、dropImages 和清理可能改写或删除旧 payload。entry ID 不代表内容永远不变。压缩、重置和模型相关的上下文重建也不等于简单截取某个 entry 之后的消息。[O2]
- `get_messages_page` 在 streaming/compacting 时拒绝，游标仅校验 Session ID、leaf、消息数和 offset，没有保留不可变快照或内容版本；同形状改写可能不使游标失效。不能将其当成全树分页、live 游标或持久恢复键。[O3]
- live `messageId` 是进程内 `msg-N`，不是原生 entry ID；助手内部 entry 关联使用 Symbol，JSON wire 不携带。某些 `message_end` 不会形成持久项。工具 call/result ID 可配对，但导航/切换后可能复用，须绑定原生上下文。[O4]
- 普通无摘要导航本身只改变内存 leaf，ack 或 `get_tree` 回读不能证明位置已持久。正常退出可能追加并刷盘 `session_exit`，保存所选路径；其条件与错误路径不能保证导航完成时立即持久。不能声称正常退出必然丢位置，也不能据退出行为承诺崩溃前已提交。[O5]
- TUI `/clear` 可留下同 Session 的 `reset_boundary`，早期 entries 仍可读取；固定 RPC text dispatcher 不执行其 TUI-only handler。不能把字面 `/clear` 当作已有 Web reset RPC。这里处理导入历史已有边界。[O6]
- DSH follow 开头提供 snapshot、连续 journal、projections 和 assistant baseline；Web 仍调用 deprecated `session.page`。follow 请求没有 resume cursor/epoch 字段，不能发明 `eventsAfter` 或 `history.page`。额外 event envelope 字段会被拒绝。[D1]
- DSH `surface.replace` 改变模型 surface，Chat 仍保留 append-origin 原文；它不能删除离开的原生分支。physical follow restart 保留旧 window，并拒绝向后退的 cursor。连接 generation 也不自动清掉所有 Session journal。[D2]
- public retain/release 只有最终引用释放后才可得到同 ID 的新 Client scope；现有公有接口不能协调失效所有持有者。具体实例 `resync` 不是可调用的 public contract，且单独重建 journal 不保证 projections、草稿与附件归属一起恢复。[D3]

## 源身份、位置与显示身份

| 身份 | 作用与边界 |
| --- | --- |
| 原生来源与 Session 身份 | 按目录/严格接续合同验证真实实例；相同名称、路径或重复 ID 不足以替代来源验证 |
| 原生 entry ID 与内容版本 | 在已验证 Session 内标识源记录；内容可能改写，删除/重挂不能被 append polling 隐藏 |
| 原生历史位置 | 继续执行的实际原生位置；与树中仅供预览的选择分开。用户节点导航可能落在 parent，须采用原生实际结果 |
| worker/context 代次 | 限定进程内消息、工具、UI 和异步结果的有效范围；不能以 msg-N 或 toolCallId 作为全局持久键 |
| 投影代次 | 一套不可混用的派生 journal、源映射、历史页和 assistant/projection baseline；改变它不创建新的原生 Session |
| DSH seq/cursor | 当前派生 journal 的连续顺序与分页 cut；不是时间戳、OMP ID、追加史 since 或跨重启身份 |

Host 只持有可丢弃的投影、版本/代次映射和有界缓存。必要的附件/提交关联索引遵守附件合同；
不增加第二份持久 transcript、provider chunk 档案或树。DSH event envelope 不额外塞原生字段，
`sourceEventSeqs` 仅承载其定义的 DSH journal 来源关系。

## 历史与特殊内容的呈现

1. 从一致源快照的实际 leaf 沿 `parentId` 构建当前路径，Conversation 仅呈现这条路径的可显示历史；完整树由 History 模块呈现。源父链不完整或身份不一致时报告同步/兼容问题，不猜补父节点或把其他分支并入聊天。
2. 原生 compaction、branch summary、reset boundary 形成可读边界。旧段默认折叠，展开仍读取原生现存内容。折叠只是展示，不修改历史，也不声称折叠区所有消息都已从模型上下文移除。
3. 不提供未经公共事实支撑的逐 entry“实际已入模”标记。原生 provider replay、模型切换、上下文过滤和已处理附件可能改变实际模型输入；历史/当前 Agent 消息不充当完整 provider 请求审计。
4. text、thinking、工具调用/结果、custom_message、fileMention、摘要和中断分别按 typed 映射呈现。工具参数从对象重建时不能标为原始参数字符串；签名、usage、时间和错误只呈现源确有的事实。冷恢复需要的 DSH stream 是派生呈现，不能冒充原始 provider 分块。
5. 原件与处理后图像/文档内容分开。缺原件保留整条可读历史并说明原因；fileMention 与用户消息的分组、branch 后原件关联以公开来源事实为准，不用相似文本、hash、时间或相邻记录猜测。
6. 已知 internal/custom state、配置及凭据记录不因 `get_tree` 可返回就原样倒入 Chat 或 JSON 下载。遵守原生显示语义和最小字段白名单；本票不开放全局配置管理或任意 payload 浏览。未知可忽略项按公开合同处理；影响内容、位置或连续性的未知类型明确阻塞相关能力，不静默丢掉后宣称完整。

## 打开、live 收口与重建算法约束

以下步骤依赖尚待交付的公开一致性保证；固定基线的多次读取加到达顺序不能替代它。

1. 验证浏览器、目录、Session 来源/实例和 worker/context 绑定。打开历史前开始持续读取并有界缓冲 live 输出，串行提交当前 Session 的投影变更；响应仍按 request ID 关联。
2. 获得同一原生观察边界下的源身份、内容版本、实际 leaf、保留历史与必要运行状态。分页必须绑定该 cut，后续改写、删除、位置变化要可检测。assistant 现场与快照的重叠范围必须有公开关系，不靠“响应恰好夹在两个事件之间”判断。
3. 建立源 entry/version 到一个或多个 DSH 事件的映射，生成合法连续 journal 和匹配同一 cut 的 projections；即使 idle 也提供 Web 要求的 assistant baseline。源读取所见内存项不自动标为已持久提交。
4. 将 live message/attempt 与实际原生 entry 或明确的不持久化结果关联后结算。`message_end` 最终内容优先于增量猜测，不能假定下一条 entry 就是它。按上下文配对工具；未提交 attempt 与已提交消息分别处理，不让一条消息同时作为临时/历史重复出现。
5. 发布 opening 后只接入 cut 之后的有序变化；精确排除重叠，覆盖新增、改写、删除、leaf/context 切换。live 缓冲溢出、版本/水位不连续或关联不足时停止应用受影响数据，走新一致快照/代次重建或显示失败，不无限补洞或当作空成功。
6. 同 Host/worker 的重同步保留执行和仍有效 Interaction，按 Broker 当前权威代次重新呈现，不延长期限。Host/worker 重启不复活旧 UI；重新打开后仅按原生可恢复事实重建，操作结果未明继续保持未明，不自动补发 prompt、branch 或 navigate。

同步期间拒绝依赖陈旧视图的新输入与历史修改，仍保留必要的 Stop 和经当前 Broker 校验的回答入口。
重建不会默认为“停止成功”，也不会自动重启 worker。草稿保全采用附件合同的页签＋Session 语义，
绑定身份后原子恢复、准备新回执，不覆盖较新的编辑或将未决提交恢复成新输入。

## seq、分页与投影代次

- 同一投影代次内，每个已发布 seq 唯一对应不可变的 DSH 事件，相邻 journal 事件连续。OMP 源改写不能原位偷换这个 seq 的内容；改变可见路径或无法延续旧事实时先使旧代次失效，再建立新基线。
- 初始历史用版本化映射规则派生；同一 cut 内的历史页必须复现相同事件、身份和 seq。生成规则/源快照变化不能继续使用旧 cursor。原生 ID 不重新编号冒充 DSH seq，时间只作有来源的显示数据。
- 旧页使用实际 DSH `throughSeq` inclusive、`beforeSeq` exclusive 和 chronological records/hasMore 语义，保留工具/来源分组。不能把 OMP 正向 offset 游标直接透传给 DSH；当前 `session.page` alias 和消费端调用也须匹配。
- 对可从同一源 cut 重建的页允许有界缓存；不能重建相同 seq/内容的页须明确失效并重建代次。内存淘汰不能静默造缺号，不能为了旧 cursor 无限保留 runtime-only attempts 或另存持久 transcript。
- 已确认的 native 导航、branch、改写/删除、worker 重启以及不可修复的 gap，分别检查是否需要新投影代次。重建时显示同步状态，协调所有页面的 journal、Conversation、projections 和 assistant baseline，拒绝旧页面/page/attempt/异步回复。
- 同原生 Session 的重建保持其身份；branch 后确认的是新原生 Session。不能通过伪造新 Session、调私有 `resync`、仅触发 Connection ready、发第二个 snapshot 或发送 `surface.replace` 假装完成统一失效。
- 公共 DSH 接缝须保全独立草稿/附件引用，允许同 ID 的 journal 代次重建，并协调所有现有持有者；补丁固定来源、schema/资产和兼容实验。若变成大范围核心 Conversation 重写，返回客户端组合决策。
- [验收交接合同](mvp-acceptance-and-handoff.md)已确认初始目录/历史规模、时延及 Host RSS 目标，均待实测；具体快照/分页/缓冲等工程预算须在对应实现规格与组合中定值并验证。通过原生有界读取保证可达性，超出预算明确拒绝/提示，不静默截断或将局部树称为完整历史。

## 导航位置成功条件

预览和在途导航不能标为已成功。原生返回与回读的实际位置、身份、版本，以及可恢复的持久提交结果
一致后，才显示完成；持久化失败明确失败，结果丢失显示未明。重新打开后通过公共 RPC 查询事实，
不依靠 Host 保存目标后自动导航来制造恢复效果。摘要、extension hook、用户节点 parent 行为均以实际结果为准。

该成功保证必须覆盖正常退出、导航后尚无新 prompt 的终止/崩溃及重新打开，不以随后退出标记或新消息
恰好保存路径代替。原生仍可在合法后续操作中推进位置；本合同不承诺外部 TUI 修改后继续停在旧位置，
也不承诺撤销文件或外部副作用。新持久位置元信息须验证 TUI、源数据和升级/回退兼容。

## 所需公开增量与交付门禁

沿既定公开兼容构建、精确校验的全局 OMP、单一支持组合交付，不改变生产锁来掩盖缺口：

1. **原生一致观察与变化**：可验证的来源/Session/context 身份、内容版本、历史位置、保留记录与共同 live cut；覆盖改写、删除、位置变化和 gap。支持有界树/历史分页及可检测的过期，不由 Host 扫描 Session 文件补齐。
2. **源关联与持久结果**：live 各持久消息到原生 entry 或明确无 entry 的结算、提交/位置可恢复状态；与附件已要求的客户端提交关联协同，区分内存与持久化，保留结果未知。不能只关联用户 prompt 而遗漏助手、工具或特殊消息。
3. **立即持久的导航位置**：完成回复前提供可恢复的实际位置保证与查询事实；最终退出写入不是完成凭证。新源元信息由 OMP 负责，不在 Host 复制树或重放副作用。
4. **DSH 公共代次重建**：同原生身份下协调 journal/Conversation/projections/assistant 的失效与重开，拦截旧引用并恢复独立草稿；配套 typed native renderer。官方基线和现有导航策略实验均未提供这份完整保证。

这些是待实现的语义合同，不是已存在的新增方法名/字段。应由同版本 public wire/schema/handler/client
与 DSH 公共接缝、Host 一起设计和验证；源码阅读、fixture 或单个成功 flag 不替代实际组合门禁。

## 必须取得的验证证据

| 场景 | 必须观察到的结果 |
| --- | --- |
| 空/已导入/多分支历史 | 正确源身份、实际活动路径，完整树与聊天分开，idle assistant baseline 合法，无隐式创建或执行 |
| 多次压缩、reset、模型切换、裁剪 | 旧段可展开且边界正确，不把所有旧消息断言为已退出模型上下文；只恢复原生保留内容，无跨分支混入 |
| opening 与 live 同时发生 | 重复文字/同时间戳也精确一次收口；snapshot、projections 与 assistant prefix 共 cut，无到达顺序猜测 |
| 同 leaf/数量的改写、删除、后台分支结果 | 内容版本/变更可见，旧 since/cursor 不冒充新快照，后台其他路径不污染聊天 |
| 工具批次、ID 复用、retry/error/abort | 正确 scoped call/result，临时 attempt 与持久项分别结算，未持久消息不被虚构为成功历史 |
| 分页、持续 live、缓存淘汰、大单项 | 页固定 cut、seq 连续且不混代；资源有界，局部/超限明确，不静默丢记录 |
| navigate/branch/reset 后重建，多页面持有 | 旧分支从当前聊天移除，正确新基线与 Session 身份；旧页/流/attempt 不复活，草稿与附件安全恢复 |
| 浏览器刷新/断线，Host/worker 重启 | 同活 worker 不重复运行；重启后手动打开恢复源事实，旧游标/UI 不复活，不声称原始 provider stream 全重放 |
| 导航后无新输入即退出/强杀/崩溃 | 显示成功的实际历史位置可恢复；未提交/持久失败/丢结果准确区分，正常退出追加记录不掩盖提前崩溃缺口 |
| custom/fileMention、附件删除/缺失、未知类型 | 安全 typed 呈现与来源关联，缺原件不丢整条消息；不展示内部凭据或把历史 UI 当 pending 问题 |
| 权限失效、过期预览、损坏数据、不可修复 gap | 拒绝相应读取/操作并明确原因，Stop/Broker 遵守现有生命周期，不通过猜测和自动重试修改历史 |
| 实际支持组合 | 真实全局 OMP 兼容构建、Bun Host、DSH 补丁/资产、浏览器及 TUI/数据升级回退分别有证据；fake worker 与源码核对不得代替 |

## 固定一手来源

- [O1 entries/tree handler](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2345-L2365)、[active path/tree](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-manager.ts#L717-L763)
- [O2 context/历史重建](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-context.ts#L473-L559)、[pruning/dropImages](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-maintenance.ts#L759-L935)
- [O3 实际分页与游标](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-messages.ts#L26-L125)
- [O4 live ID](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-session-events.ts#L115-L142)、[助手持久关联](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/agent-session.ts#L4365-L4405)、[工具 ID 复用](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/agent-session.ts#L8271-L8280)
- [O5 导航 leaf 分支](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/agent-session.ts#L15075-L15102)、[内存 leaf 与持久 marker 区别](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-manager.ts#L4065-L4087)、[有条件退出记录](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/agent-session.ts#L3971-L4019)
- [O6 TUI-only clear](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/slash-commands/builtin-lifecycle.ts#L208-L217)、[text dispatcher](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/slash-commands/acp-builtins.ts#L51-L69)
- [D1 实际 follow/page/assistant 类型](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/src/types.ts#L472-L597)、[Web 消费端](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/src/client/transport.ts#L178-L245)
- [D2 human transcript 与 model surface](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/core/session/src/surface.ts#L79-L92)、[physical restart 约束](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/gateway/src/client/journal-stream.ts#L214-L301)
- [D3 最终引用释放](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/src/client/sessions/service.ts#L562-L634)、[具体 resync 实现](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/src/client/sessions/session.ts#L582-L597)
