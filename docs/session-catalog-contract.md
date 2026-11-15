# 原生 Session Catalog 合同目标

Status: 产品选择已确认；以下工程语义为实施目标，具体公共 wire/schema 和运行验证待完成。

确认日期：2026-11-15。本文不是固定版本已实现 API 的说明。

工单：[原生会话目录契约：发现范围、导入、索引与占用状态](https://github.com/HowBoring/omp-webui/issues/17)
来源：[固定版本公共目录研究](https://github.com/HowBoring/omp-webui/blob/eeb9862543d0ccdd9f0b9288b70cae6c249fc9d4/docs/research/mvp-native-session-catalog.md)

## 已确认且不再重问

- 多工作目录下发现/导入已有 TUI Session；Host 重启保留登记引用；OMP 唯一保存历史。
- 旧进程退出后继续原生会话；不强制夺取活 writer，不自动重发 prompt/工具。
- 树浏览、同会话 History Navigation、历史用户点创建 Branched Session 纳入 MVP。
- Host 只访问公共 RPC，不扫描、读取或修改 OMP Session 文件，不导入 Session SDK。

## 用户已确认的产品选择

| 决策 | 已确认 | 未采用的首版范围 |
| --- | --- | --- |
| Q1 发现范围 | 一个启动配置/profile 的默认会话目录，加 Host 配置显式授权的自定义目录 | 首版跨多个 profile 汇总 |
| Q2 登记时机 | 发现即展示，首次打开自动登记；接续失败仍保留登记和原因 | 显式导入后才允许打开 |
| Q3 外部占用期间 | 只显示目录元数据/占用观察；历史和树在旧 owner 退出后打开 | 首版增加占用期间只读历史/树合同 |

以下约束承接已确认选择和 RPC-only 架构。它们需要落实到公共 OMP 扩展与隔离验证；
不是已发布方法、字段或错误码，也不批准跳过客户端、安全和投影工单。

## 责任与操作分离

1. OMP server 负责发现、解析原生元数据、引用验证和原生所有权约束。
2. Host 负责授权范围内的列表适配、登记引用和 Workspace 关联、失效状态及展示。
3. DSH 客户端消费 Host 的 Remote 表面；浏览器不给 OMP 任意文件路径、argv 或原始命令。
4. 发现与登记不意味着打开会话、占有 lease、创建会话或运行模型/工具。

## 公共能力提案（语义，不是已有方法名或 wire schema）

- 发现范围描述：由 OMP 报告实际生效的 profile、原生目录布局与被授权的来源标识。
  不能把 agentDir/sessions 拼接当真实位置，不能隐式扫描整台机器或合并其他 profiles。
- 目录查询：只读分页查找授权来源内的原生会话；可按真实 recorded cwd 过滤/分组。
  若侧栏采用 Workspace 优先导航，需要完整且独立分页的目录分组；单页 Session 聚合不冒充全局分组。
- 单项描述/重新校验：验证所选引用、预期原生身份和所属来源，不切换 worker、不创建文件。
  注册不需要新增“导入 transcript”的服务端写操作。
- 严格打开/首次写入保证：预期身份不符、引用缺失或发生占用冲突时返回明确失败；不静默
  创建空会话、替换目标或回退成新 sibling。这个原子所有权保证仍是公共 RPC 的待补能力。
- 保持 RPC v2 framing/correlation/limits；新增 wire/schema/client 应有明确版本和能力协商。
  以上均不能从固定版本现有接口直接推定可用。

## 原生身份和工作目录

- 原生 Session ID 不是 Host 登记记录 ID，也不独自保证文件副本唯一。
- 引用携带来源和原生身份，并能区分同 ID 的不同原生副本；路径、标题、mtime 都不是身份。
- 别名是否指向同一原生实例由 OMP 判断；Host 不通过 stat/realpath 或读取文件自行去重。
- 同实例的可验证别名可归并；不同副本保留为冲突/不同候选，不能任意择一或合并历史。
- 按 OMP 验证的规范化 cwd 精确分组；同仓库不同 worktree 是不同工作目录。
  recorded cwd 缺失的会话显示“工作目录未知”，不能归入当前 worker cwd。
- 文件移动、来源变更和 cwd 迁移均需重新验证；不按相同文件名/标题猜测新位置。
- continuation 和 branch 关系显式保留。若打开解析成其他原生 ID，报告解析结果和关系；
  不把新 ID 冒充所选会话。两边都存在独有历史时不自动合并。

## 持久登记索引

Q2 已确认：发现即展示，第一次打开时先登记原生引用，再尝试接续。接续失败不撤销登记；
未经重新验证的记录必须明确标记，不能冒充已验证可打开。发现的目录分组也不意味着创建
真实文件夹或自动登记该目录下所有会话。

- 最小内容：Host 登记 ID、来源标识、原生 ID/可重验定位引用、Workspace 关联、展示元数据、
  最近验证时间与错误状态。授权凭据可更新，不要求短期执行凭据永久有效。
- 重启先呈现已登记记录及其验证状态，通过公共目录/描述能力重新校验并刷新引用。
  索引不能发现从未登记的原生会话，也不能代替原生历史或当前 lease 状态。
- 不保存 transcript、工具结果、树、首条 prompt 文本、完整搜索文本、凭据或 Agent 状态。
- 存储写入须原子化，重复登记幂等；存储格式由实施选择。
- 缺失、不可访问、身份变化或来源未配置时保留记录并显示原因，不自动删除或重建原生文件。
- “移除 WebUI 登记”只删除 Host 引用，不删除原生 Session；重新发现后仍可能再次显示候选。

## 状态与失败

目录发现状态、Host 登记状态、所有权观察、Host worker 执行状态分别表达，不合并成一个 running 字段。

| 情况 | 目标行为 |
| --- | --- |
| RPC 缺少目录能力 | 显示兼容性缺口；不返回假的空目录，不降级为 Host 文件扫描 |
| 原生范围部分不可读/查询中断 | 保留成功部分并说明不完整；不宣称全局零会话或精确总数 |
| 历史引用缺失/身份被替换 | 保留登记但拒绝打开；不把 switch_session 当 validate-only 使用 |
| lease held，且不是已知的本 Host worker | 标记“被其他进程占用”；不声称知道具体 TUI/PID，仅显示目录元数据，不能在此阶段打开历史/树 |
| lease unknown / 查询失败 | 显示“占用状态未知”，阻止不受保护的接续；允许重新检查，不按“空闲”处理 |
| probe 后出现 owner 竞争 | 最终原生原子获取应失败；不自动生成 sibling 或自动重复打开 |
| 本 Host 已有同一会话 worker | 复用已有 worker/view；不启动第二个 writer，仍遵守一活跃顶层 worker 的 MVP 限制 |
| cwd 不存在/未授权/无法访问 | 可显示登记及原因，阻止执行；不悄悄选择其他 cwd 或改写原生 header |

所有失败名仅为语义分类，实际新增 code/字段须在 OMP 公共 schema 中定义，不能冒充现有错误码。

## 列表与元数据保证

- 原生 title 可为空；展示 fallback 可使用时间/短 ID，不在发现阶段调用模型生成标题。
- created 与 modified 的来源语义分别保留；文件 mtime 不命名为“最后对话时间”。
- 消息数/搜索文本的近似性明确标记，首版可以不提供；不承诺精确全历史全文搜索。
- 原生持久 tail status 不能当 live lease/worker 状态；占用观察带验证时点，不承诺持久有效。
- 选择稳定分页次序和 tie-break；同一 snapshot 内固定结果，过期/目录变化时显式重新开始。
  cursor 只属于该来源、筛选和 snapshot；不跨 profile、cwd 或 Host/RPC 代次混用。
  此处是目录游标，不等同于 OMP history entry ID 或 DSH journal sequence。
- 明确页面、响应字节、扫描时间/资源预算和 partial/error 语义；数组切片不等于扫描成本有界。
  具体数值需用隔离 fixture 及协议 framing 预算验证，不在无实验时宣称性能保证。

## 实施前验证门禁

1. 新公共 schema/handler/client 能力与版本锁一致；缺能力时相关 UI 功能明确不可用。
2. default/profile/自定义目录实际布局、cwd/worktree 分组、未知 cwd、空壳与有标题空会话过滤。
3. leaf/bucket symlink、路径别名、相同原生 ID 的不同副本，以及目录权限错误。
4. 发现/描述/登记对活 owner 没有原生写入、备份恢复、目录迁移、title-index 写入或模型调用。
5. Host 重启、损坏索引、目录移动、引用过期、missing/replaced identity 均不误建新 Session。
6. probe/open/write 竞态、held/unknown，以及 continuation/branch 不被静默替换或归并。
7. 分页期间标题/历史变化与大规模目录预算；局部失败不伪装成空列表。
8. 所有测试使用隔离 fixtures，不以真实用户 Session 作为迁移或写入实验材料。

新增公共扩展的交付基线与兼容门禁见
[OMP 目录与严格接续扩展：交付基线和兼容门禁](https://github.com/HowBoring/omp-webui/issues/25)，
不因本文定案就更新上游版本锁。

安全工单决定详细认证、授权配置入口和 symlink 策略；客户端组合工单决定 UI 入口；
投影工单决定历史/树的 DSH 呈现。本工单不代替它们完成决策。
