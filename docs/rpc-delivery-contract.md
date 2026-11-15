# OMP 公共 RPC 扩展交付与兼容合同

Status: 用户已确认交付路线、全局安装复用和单一支持组合；兼容构建、扩展与运行验证尚未交付。

确认日期：2026-11-15。决策：[OMP 公共 RPC 扩展：目录、严格接续与交互取消的交付门禁](https://github.com/HowBoring/omp-webui/issues/25)。
取舍见 [ADR 0008](adr/0008-public-rpc-delivery.md)。本文规定交付与验收目标，不声明任何新 API 已存在。

## 用户已确认的选择

| 决策 | 已选择 | 未采用 |
| --- | --- | --- |
| Q1 交付路线 | 基于锁定 OMP 基线开发公开、可审计的兼容构建，固定源码/补丁/产物/schema；官方满足同样保证后再经门禁切换 | 把开发进度完全绑定到官方先发布 |
| Q2 运行安装 | 复用全局 OMP，但必须精确通过同一兼容门禁 | WebUI 单独安装一个生产 worker |
| Q3 支持窗口 | 首版只支持一个完整验证的 Host/OMP 构建/schema 组合；升级整组验证，回退还需验证当前数据兼容 | 宽泛 18.x/latest 范围或首版多组合矩阵 |

Q2 是维护者明确选择的替代方案。构建/fixture 可使用隔离目录；真实 WebUI worker 使用已验证
的全局安装，来源不匹配时拒绝准入。OMP 仍使用启动时选定的 profile 和授权原生来源，
Host 不复制 transcript、解析 Session 文件或实现第二个 Agent。浏览器不能指定可执行文件/argv。

## 当前基线与交付状态

- 上游基线仍是 OMP `18.20.2` / `7c49c11aa5bbaf3f418406583096168ad5b8c6dc`；
  DSH 仍是 `dsh-v0.2.2-rc.3` / `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`。
- [本次复核](https://github.com/HowBoring/omp-webui/issues/25#issuecomment-6897128289)确认 OMP 最新发布
  仍对应该基线；所查 main `4193d01cbec0fa21cfdd18a6ac69d354f23bc474` 虽已前进，相关 public
  RPC types/mode/schema、ask 和 SessionManager 文件与基线相同，三组缺口仍在。
- 因此当前未修改的官方构建不能仅凭 `18.20.2` 或“最新版”获得完整 MVP 准入。
  兼容源提交、实际产物、schema 摘要与测试证据尚不存在，不为它们填写假 SHA/版本值。
- `upstreams.lock.json` 目前仍是已检查的上游基线。实际交付后才用版本化锁/配套交付清单记录
  兼容源码与产物，并明确区别于未修改的官方 release；本票不安装/替换全局软件，也未验证
  用户机器上的实际全局安装。公开来源不要求向上游 npm 命名空间发布或已获其发布权限。

## 最低公共能力与责任边界

以下是 server 所需语义，不是新增方法名/字段或现有可调用 wire schema：

1. **只读目录/描述**：按已选配置与授权来源发现、分页、验证原生引用/身份及真实 cwd；
   不打开/创建会话、迁移/恢复备份、取得 lease、生成标题或运行扩展/模型/工具。
2. **严格接续/首次写入**：缺失、被替换的原生实例及最终所有权竞争必须明确失败，
   不自动建空会话、不静默 sibling/continuation，不把 probe 当原子 reservation。
3. **显式答案才提交**：native ask 与 HTML-form tool fallback 的 expiry/取消不能生成默认答案；
   保留原因，原子结算并拒绝迟到回复，保证在原生请求/timer 开始前可公开验证。

具体语义分别沿[目录合同](session-catalog-contract.md)、[交互生命周期合同](interaction-lifecycle-contract.md)
落实。Host 仍是外部公共 RPC client；可以在公开 OMP server 源内实现原生行为，但不能在 Host
导入私有 SessionManager/AgentSession 代替扩展，也不复制旧 SDK Driver。
兼容 delta 应聚焦这些 RPC 保证，保留普通 TUI 的既有行为和共享历史兼容性；变更涉及原生
格式或更广的 TUI 语义时需明确记录并重新验证，不能当作未审查的顺带改动。

这是当前已识别的最低能力集。附件/投影工单若确认新缺口，仍通过公共 RPC 增量补充；最终
MVP 能力矩阵由[扩展 MVP 的验收证据与实施交接顺序](https://github.com/HowBoring/omp-webui/issues/24)冻结，
不能以本票定案冒充全部 wire 设计或产品实现已完成。

## 可追溯交付清单

每个获准组合需要一份版本化清单和可复现的构建/验证记录，至少关联：

| 对象 | 必须记录的事实 |
| --- | --- |
| Host | 实际源提交/构建身份、支持的公共能力与生成 validator 来源 |
| OMP source | 上游 base、公开兼容源提交、可审计 delta/补丁摘要；版本标签明确是兼容构建 |
| CLI/可执行产物 | 发布来源、平台/架构、受控启动方式、实际执行目标与不可变摘要 |
| 运行依赖 | Bun/相关运行时、CLI bundle、外置/native 依赖和实际需要的资产闭包；不能只 hash 一个 symlink |
| wire/schema | 同一交付源码的 authored wire、生成 schema/types 与 validator 输入/输出摘要，生成一致性结果 |
| DSH | 已锁定源及公开接缝/模块/构建身份，沿[客户端组合合同](client-composition.md)冻结；当前 28-plugin proof 不是最终产物 |
| 生效配置 | 已验证的语义模式与必要限制、native 存储兼容范围及 Linux/WSL2 证据 |
| 验收证据 | 对这份实际产物运行的协议、竞态、只读性、历史/TUI 兼容和负向 fixture 结果 |

源码公开、清单摘要、子进程自报版本、schema 相等与行为验证是不同证据。清单的信任来源和
完整性必须明确；校验和不能自证来源可信，能力声明不能代替语义测试。开发者安装的另一个
TypeScript 包、npm latest 或 `--version` 文本都不能识别实际启动的全局 child。
公共 wire/schema/client 仍按[transport 合同](rpc-client-contract.md)复用/生成，不另手写第二套定义。

## 全局 OMP 解析与准入

- 由可信 Host 启动配置选择全局 OMP 安装，解析 symlink、launcher、真实入口和受控 argv/运行时，
  固定到可校验的绝对执行目标。路径校验是程序/依赖来源验证，不是读取原生 Session 的权限。
- 每次启动前验证目标及所需依赖闭包属于获准组合，启动后将观察绑定到那个真实 child/worker
  代次。路径名叫 `omp`、相同 semver、成功 health 或 stdout ready 均不能替代此校验。
- 全局更新、PATH/入口重定向或依赖变化后需重新准入。检查与启动/后续依赖加载之间的更新
  竞态必须有明确安装稳定性约束与实验；一次预检 hash 不是原子保证。
- 全局升级/替换要先停止依赖同一安装的 WebUI worker，并让其他使用者完成维护协调；
  Host 不结束未知 TUI。运行中的安装/依赖闭包保持稳定，不借自动更新混入另一组合。
  无法证明启动目标与所需来源一致时阻止会话准入，不能在后台复制另一个 worker 当复用全局。
- 普通全局 TUI 同样会使用该兼容构建，因此必须测试原生 CLI/TUI 和历史兼容，不只测 RPC。
  保留一个安装减少并行维护，也接受与全局升级的耦合；不是保证所有全局版本都能接入。
- 真实会话仍须按公共目录/描述、当前授权与严格所有权规则打开。即使安装验证通过，
  也不绕过[本机访问合同](local-access-contract.md)、busy 准入或外部 owner 冲突。

## 公共能力协商与安全检查路径

现有 `ready` 的版本/limits 说明 framing；可选 bash flag 只说明那项特性。它没有通用构建/
schema 身份或完整能力 registry。`get_available_commands` 是斜杠命令表，schema 固定 `$id`
不是内容摘要。不能把这些既有字段重新解释成缺失能力已经可用。[S1]

需要新增公开、版本化的有效能力/约束及 schema/build 一致性描述，且必须早于依赖该保证的
会话操作和启动 UI。具体公开启动/协商接口由扩展实现时随 schema 一起定义，不在本文编造
固定版本已有方法。子进程的自报信息用于与已验证产物互相核对，不是独立的来源证明。
语义若依赖运行配置，OMP 必须公开报告有效保证并在不兼容变更前阻止相关操作；Host
不能通过读取私有配置猜测，也不能以一次启动声明保证之后任意配置下都成立。

正常 rpc-ui 启动已持有 AgentSession，并可能在普通协商/get_state 完成前初始化扩展和 UI；
不能当成无副作用的探测。新的检查路径须公开保证不接触真实 Session、lease、扩展/模型/
工具、迁移、备份恢复或 title/index 写入。普通 `open_session`/`switch_session` 不是 validate-only。[S2]

缺少来源、schema 或必要语义保证时显式标记兼容性阻塞，拒绝打开/创建/执行会话。可以保留
不含私有会话内容的健康/诊断行为；它不代表 Session ready。不能返回假的空目录、降级普通
open/扫描 native 文件、默默省掉 MVP 必需项，或先触发有风险的 UI 再用拒绝回复声称已保护。

## 单一支持窗口、升级与回退

- 首版只有一个完整通过门禁的组合，不用 `18.x`、相同 npm tag、floating main/latest 或
  额外兼容声明扩大支持窗口。当前上游 base pin 尚不是一个已验收的产品组合。
- 新组合先在隔离 fixture 中构建/生成/验证，证明 global TUI、native 历史、RPC 与 DSH 的
  行为兼容，再一次性切换相关锁和准入记录。生产执行不能混用新 worker 与旧 schema/validator。
- 上游正式 release 满足同一语义且完整通过同一矩阵后，才可替代兼容构建；不因合入 PR、
  tag 或某个 capability flag 出现就自动切换。项目维护兼容 delta 与测试证据，直到可移除。
- 旧程序可重新安装不等于旧程序能读取已经写过的 native 数据。基线存储版本为 3，加载有
  migration/后续 rewrite 路径；当前 public RPC 没有可假定的可逆迁移/降级保证。[S3]
- 回退前校验旧组合对当前数据和全局 TUI 的兼容范围。未证明兼容或发生迁移冲突时停止准入，
  保留引用/原因与最后已知组合，显示需要的原生恢复/维护步骤；不自动降级、不猜测合并，
  不由 Host 编辑 Session 文件“恢复”。备份/迁移若需要新能力，应走独立公开 OMP 操作与验证。
- 非预期全局更新使运行条件失配时，阻止新工作并显示实际状态，按 Supervisor 合同停止/关闭
  受监管工作，不自动重放旧请求或切换未知 worker。具体安装/退出结果必须可观察。

## 必须取得的证据

以下是交付前门禁，均不是本次已通过的测试：

1. 源码/补丁到实际全局启动闭包、schema 生成与 validator 的一致性；错误 wrapper、同版本
   不同内容、错平台/运行时、安装变化、未知/缺失 capability 及启动阶段信息不一致均拒绝准入。
2. 对固定实际产物：只读 catalog/describe 的来源、cwd、分页/partial、别名/副本、权限/symlink、
   无创建/迁移/恢复/索引写入/模型行为；响应和扫描成本有界。
3. missing/replaced 身份与 probe→open→first-write 两进程竞争；held/unknown 明确失败，
   原会话身份不变，不误建空文件或 sibling，不强制接管未知外部进程。
4. native ask 与 tool fallback 的到期/取消/延迟投递/迟到回复竞争，包括生效配置改变；
   必须验证原生 timer 生成结果的路径，没有显式答案不产生默认提交。
5. 真实 rpc-ui startup UI、v2 negotiation、字节/chunk/关联/乱序/迟到、完整 ack、prompt_result/
   settled、交互与 summary 停止、EOF 尾帧及进程回收。Fake worker 不能替代实际产物证据。
6. 隔离 native 历史 fixture：TUI 打开/继续、树/导航/分支、格式升级/旧组合回退、只读发现和
   实际写入边界；不在真实用户历史上试验迁移/恢复。存储回退失败不能被程序回退成功掩盖。
7. 一整组 Host/DSH/OMP 的浏览器证据覆盖核心 MVP 和所有拒绝路径；附件/投影和公开客户端
   接缝的门禁仍依赖相应工单，不用空数据 boot、源码审查或本次选择替代验收。

## 固定一手来源

- [上游发布与比较复核](https://github.com/HowBoring/omp-webui/issues/25#issuecomment-6897128289)
- [S1 ready types](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-types.ts#L376-L383)；[slash-command catalog](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/wire/commands.ts#L115-L118)
- [S2 ready before initialization](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L1422-L1430)；[startup dispatcher](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L1734-L1758)
- [S3 migrations](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-migrations.ts#L13-L76)；[native load](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-manager.ts#L2439-L2489)
