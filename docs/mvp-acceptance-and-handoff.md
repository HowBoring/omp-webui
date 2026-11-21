# 扩展 MVP 验收与实施交接合同

Status: 用户已确认 Q1–Q3，决策规划完成；产品实现、兼容构建与完整验收仍未完成。
日期：2026-11-16（Asia/Singapore）。决策：[扩展 MVP 的验收证据与实施交接顺序](https://github.com/HowBoring/omp-webui/issues/24)。
本合同汇总开发依赖和验收目标，不声明新的 RPC API、产物 SHA、浏览器版本或通过结果。

## 已确认选择

| 决策 | 用户选择 |
| --- | --- |
| Q1 实施顺序 | 先公开 OMP 兼容构建与 DSH 重建/草稿接缝门禁，再安全目录闭环、聊天交互、核心历史、完整附件，最后故障与平台矩阵验收；组件可并行，真实产品准入仍受依赖门禁约束，中间阶段不称为完整 MVP |
| Q2 浏览器矩阵 | Linux Chromium；Windows Chrome 经 localhost 连接 WSL2 Host。具体实际版本记录在获准组合及证据中，键位和入口使用真实平台验证；Linux 模拟 Win32 不能替代 Windows/WSL2 验收 |
| Q3 初始目标 | 目录 1,000 个 Session；单 Session 基准语料 10,000 个原生 entry／100 MiB 序列化历史。参考 4 vCPU、8 GiB、SSD；稳定运行且无待答交互时，目录/会话首屏 P95≤3 秒、旧历史分页 P95≤1 秒、Bun Host 自身 RSS≤512 MiB。OMP、浏览器、工具另计，首次启动及模型/工具耗时另测 |

Q3 是必须实测的初始目标，当前没有通过证据。不达标须优化、补能力或明确与维护者调整，不能用截断历史、
减少既定功能、隐藏失败样本或更换未披露的机器达标。附件原件、单项协议、解码和模型预算分别验收。

## 范围与准入边界

既有合同仍为规范来源，本合同不重新选择其中的产品政策：

- [目录](session-catalog-contract.md)：一个启动选定 profile 的默认来源及本地授权自定义来源；发现不登记，首次打开登记原生引用，失败保留原因。外部 writer 占用时只有目录元数据，退出后才接续。
- [transport](rpc-client-contract.md)与[交付](rpc-delivery-contract.md)：外部 `rpc-ui`、公共 decoder/wire/schema、公开兼容构建、精确验证的全局 OMP、一套完整支持组合；不能以 SDK、Session 文件解析、隐藏生产安装或版本字符串替代门禁。
- [本机访问](local-access-contract.md)：Linux/WSL2、loopback、单 owner，30 天可撤销持久登录、网页显式目录 grant、Host/Origin/CSRF/WS 与对象授权，专用上传区；读取或执行不自动扩权。
- [客户端组合](client-composition.md)：保留 DSH 聊天/工具/布局底座，窄公开接缝和 OMP 目录/历史模块；当前 Session 模型/思考与 WebUI 外观/语言。provider、密钥、插件全局 Web 管理不在首版。
- [历史交互](history-interaction-contract.md)与[投影](projection-contract.md)：完整树、同 Session 导航、历史用户点新建分支、手动 retry；选择只预览，操作分别确认，返回草稿不发送。活动路径旧段折叠，显示历史不等于模型输入；导航成功前原生位置已可持久恢复。
- [交互生命周期](interaction-lifecycle-contract.md)：任一有效页面首答生效，同活 Host/worker 断线保留执行/有效 UI，忙时无新输入排队；默认 30 分钟交互期限，普通 Stop 的 30 秒确认强停，以及撤权/关闭的 30＋5 秒分级退出。
- [附件](attachment-contract.md)：所选图像/文本/文档格式、原件及必要关联、10 GiB 预算、10/5 MiB 单项与 8 个/32 MiB 原件输入目标、24 小时暂存时钟、页签草稿与新回执、占用/未决保护、删除影响确认；全部附件准备完成后才准入，内容降级明确接受。

一个活跃顶层 worker 服务同 Session 的多个页面。OMP 唯一保存聊天、工具与树；Host 的持久引用、权限、
原件和必要关联不形成第二份 transcript。恢复不重放 prompt、工具或结果未知的导航/branch，也不回滚文件。
30 秒／5 秒是处置升级阈值，须另记录实际静止、排空与退出结果；时间流逝本身不证明已停止，
只回收 Host 监管的进程。

产品 Host 在必要来源、schema、生效语义和安全准入门禁通过前，只提供 health 或不含私有数据的诊断。
隔离 fixture 中的组件开发/实证可以推进，不能由此开放真实私有 Session、启动依赖未保证的 UI 或省略必需功能。
本图关闭表示可转入规格与实施，M0 初始化完成、M0 集成通过和完整可用 MVP 是不同完成条件。

## 按依赖推进的真实闭环

| 阶段 | 交付物与可观察闭环 | 通过条件与后续依赖 |
| --- | --- | --- |
| S0 公共能力与来源门禁 | OMP authored wire/schema/client/server 增量及公开兼容构建；无副作用预检、实际全局启动闭包验证；DSH nav/draft/同 ID journal 重建公开补丁、typed 映射及候选资产清单 | 对实际构建验证目录/严格接续、显式答案取消、准备/消费、提交/entry/持久结果、一致历史/live/源版本、有界读取、导航位置持久化；原生数据/TUI 与 DSH 多持有者/草稿重建均有隔离证据。缺保证不开放后续依赖入口 |
| S1 安全目录闭环 | 认证/来源检查、持久目录授权、真实只读发现、首次打开登记、严格接续和引用索引；真实浏览器能列出并打开隔离原生历史 | 权限与资源门禁先于私有读取；占用、缺失/替换、symlink、并发 owner 和重启均准确。验证全局 OMP 来源，不伪建空会话或抢占；依赖 S0 |
| S2 聊天与交互闭环 | 同一实际 RPC worker 中人工发送文字、流式/工具、审批/提问、模型/思考、WebUI 偏好、Stop、刷新和重连 | ack/result/settled 与 Host 静止分开；真实 Broker 首答竞争、原生到期取消、队列撤回/summary 中止和进程排空有证据；无 busy 入队、重复执行或旧 UI 复活；依赖 S0/S1 |
| S3 核心历史闭环 | 浏览/展开树与旧段，确认同 Session 导航或新建分支，返回未发送草稿，手动 retry；所有页面重新取得一致活动路径 | 选择无修改，当前 Chat 不残留离开分支，陈旧页/流拒绝；导航成功后无新 prompt 即终止/崩溃仍恢复实际位置；旧/新 Session 身份正确，原生 TUI 仍可用；依赖 S2 的一致投影/静止 |
| S4 完整附件闭环 | 原生身份确认后上传/粘贴/拖入所选格式，真实准备、降级确认、手动发送、原生关联、历史原件访问、草稿恢复/删除与配额清理 | raw/base64、MIME/原件 hash、全部格式、8 个/32 MiB、模型/RPC 预算、prepare→consume、未决提交、24 小时/10 GiB、重启/取消/删除/撤权竞争均正确；branch 附件关联和缺原件提示与 S3 合并验收 |
| S5 组合验收与交付 | 对最终同一组合重跑受影响门禁，完成真实 Linux/Windows-browser/WSL2 矩阵、规模性能、故障、原生升级/回退与操作手册 | 所有必需行有合格证据，未通过项不能省略；固定最终源/补丁/产物/schema/运行时/资产/浏览器/键位与配置。到此才能认定扩展可用 MVP |

阶段是依赖和集成顺序，不要求所有组件串行编写。可以并行制作测试夹具、typed adapters 和客户端模块；
每次集成仍使用一份明确的候选组合并重跑受影响检查。实际安装或依赖更新必须沿交付合同协调，
不结束未知 TUI，不在真实用户历史上实验迁移，不用隔离开发 worker 冒充已验证的生产全局安装。

S0/S1 的实现规格须定义下列工程预算，并在对应能力开放前固定到候选组合：目录扫描成本/分页/partial、
native 与 HTTP 单项/逻辑帧字节、解码像素/转换成本、快照/页的条数/字节/期限、live/输出队列/缓存的字节与条数、
慢客户端和重建上限、worker/子进程及附件的资源约束。预算必须与 Q3 和已有附件目标共同实测；
没有数值、超限语义或负向验证即为 BLOCKED，不能继承不适用的上游大默认值。实际接口设计与数值属于实施产物，
当前不为尚不存在的 schema 填造字段或把待实现预算报为已通过。

## 现有证据台账

以下是已有报告记录，本次交接没有重跑这些实验；源码、夹具、实际 RPC 和产品浏览器证据分别保留作用域。

| 已有证据 | 已记录的结论 | 不能据此认定 |
| --- | --- | --- |
| [初始化验证](m0-validation.md) | 冻结依赖、类型/构建、11 tests／16 assertions、loopback health smoke | OMP/DSH 服务、认证、历史、附件或产品 UI 已实现；当前 `/api/*` 仍为 501 |
| [公共模块研究](https://github.com/HowBoring/omp-webui/blob/cd42f78103efce75d8b34b8233c09f4ddf2f0e4d/docs/research/mvp-rpc-package-exports.md) | Linux x64/Bun 低层公共导入、五帧合成 v2 往返、schema 生成器匹配 | 完整 validator、RpcClient 实例、真实 CLI/依赖闭包、启动和 native 协议故障路径已通过 |
| [DSH 独立启动](https://github.com/HowBoring/omp-webui/blob/7eb680f74fbf1ab9a40990e8b450f0f820d5fe0e/experiments/dsh-standalone-boot/README.md) | 固定源构建、371 资产、28 插件、临时 Node/fixture host 中浏览器启动 | 最终 roster、Bun Gateway、真实 Session/OMP、完整 lazy 资产闭包或私有数据准入已通过 |
| [导航策略实验](dsh-policy-validation.md)及[固定资产](https://github.com/HowBoring/omp-webui/blob/83efd4cf31d2afd7e3d9a551519743b59f65e171/experiments/dsh-policy-seam/README.md) | 公开 boot/navigation/action patch 的原版/补丁对照，2,306 Client tests、30 个含 fixture 插件及浏览器报告 | 新 draft/journal 接缝、真实 Broker、同时作答竞态、完整原生/Host 安全或 Linux/Windows 键位产品验收已通过 |
| 目录、附件、投影、交付等合同与源核对 | 产品选择、公开能力缺口及验收不变量已明确 | 公开兼容构建/schema/实际全局安装或完整 MVP 证据已交付 |

目前没有获准的完整产品组合。OMP `18.20.2`／`7c49c11aa5bbaf3f418406583096168ad5b8c6dc` 与 DSH
`dsh-v0.2.2-rc.3`／`38a6a5c965aa99ab525161efb7cc5cf1fe62fced` 是固定研究基线。
同 semver、`ready`、health、capability 自报或一个 hash 均不能独立证明实际执行目标的来源与语义。

## 需求到证据的最低覆盖

| 需求／合同来源 | 必须有的证据 |
| --- | --- |
| 交付／transport | 同源 schema/validator/产物与实际全局 launcher/runtime/native 依赖闭包；启动前有效保证、真实 rpc-ui/v2、乱序/迟到、字节/chunk/EOF/backpressure 和 owned-process 回收 |
| 本机访问 | raw/base64/Remote/WS/历史下载入口的认证/Host/Origin/CSRF/Session/目录/对象检查，30 天时钟与真实重启、logout/revoke-all/root revoke、路径替换与迟到请求 |
| 目录／注册／接续 | 只读无创建/迁移/lease/model 行为；来源、分页/partial、cwd、别名/副本、失效实例和 owner 竞争；持久引用恢复，不把占用或失败登记显示为可读历史 |
| 聊天／设置／停止 | 实际 prompt ack、prompt_result、同步 builtin、settled 与 busy 门禁；工具/错误/重试、副作用提示、会话模型/思考和仅 WebUI 偏好；Stop 不复发队列，普通强停需单独确认，撤权/关闭按 30＋5 秒流程 |
| Interaction | native ask/tool fallback 无显式答案不提交默认；两个真实授权页面同时作答、超时/取消/到达竞争、断线重投、过期和旧代次拒绝；默认 30 分钟不因刷新续期 |
| 历史／投影 | 共同 cut 与内容版本、相同文字/时间、同 leaf/数量改写、删除、后台分支、工具 ID 复用、重建分页/多引用/缓存淘汰；旧段/特殊消息安全显示、旧 Chat 分支消失、草稿与有效 Interaction 保全 |
| 位置／分支／恢复 | 导航成功前持久位置，尚无新输入/退出 marker 即终止或崩溃；身份/实际 parent/summary/hook 结果正确；未知结果不自动重放，原生 TUI、升级与当前数据回退分别验证 |
| 附件／草稿 | 每种所选格式、边界/坏文件、原件 hash、raw/base64、粘贴/drop、实际 prepare/降级确认/consume；提交→entry/持久关联、跨重启访问、页签隔离、新回执、缺原件提示及 branch 关联 |
| 附件生命周期 | 10/5 MiB、8 个/32 MiB 原件目标与编码/解码/模型限制分测；10 GiB 并发预留/满额拒收、24 小时时钟、取消/迟到 publication、GC/执行/未决提交/删除/撤权竞态 |
| 平台／资源 | 下述真实平台矩阵及 Q3 基准语料、首屏/分页/RSS，慢客户端/超限/损坏源/未知类型的可观察拒绝；没有数据丢失、未授权读取、无限缓存或静默降目标 |

每行需要成功、失败、取消、重启和相关竞争证据；不能只拍最终 UI。故障注入使用隔离 native 历史与可控工具，
再完成实际已配置模型/代表工具的人工发送闭环；受控模型夹具不能标作真实 provider 运行。30 天、30 分钟、
24 小时可用可控时钟测边界，并单独验证真实进程重启/持久化；不以等待真实时长替代边界测试。

## 正式平台、键位与性能测法

| 路径 | 必测内容 |
| --- | --- |
| Linux Host＋Linux Chromium | 实际系统/架构/Bun/浏览器版本，键位、菜单/鼠标、文本/图片/文件 intake、刷新多页、历史/Stop/授权入口 |
| WSL2 Linux Host＋Windows Chrome | 实际 Windows/WSL/distro/架构/Bun/Chrome，固定 localhost origin、跨 Host 重启 Cookie/目录/原件、真实 Windows 键盘/浏览器事件与上传/下载 |

两条路径共享已验证逻辑与完整来源记录，分别保存结果。不能用 `navigator.platform=Win32` 或自动化模拟输入
替代真实 Windows/WSL2 证明。首版只声明经过矩阵实测的组合；Edge/Firefox/Safari、原生 Windows/macOS Host
没有由本次选择获得支持声明。固定上游 Linux Web 的 Workspace 快捷键缺口须补齐并实测；发布键位清单，
对不支持动作的菜单、双击、快捷键、粘贴和拖拽同样做门禁，不以隐藏按钮替代 Host 拒绝。

Q3 基准语料应固定生成种子、实际 entry 数和 UTF-8 序列化字节数，记录分支/压缩/reset、工具、fileMention、
长短消息分布和源摘要。100 MiB 统计整个被测原生历史的有效序列化 payload，独立 Host 附件原件另计；
不将目标误解释为允许任意单条超协议记录。另测大型单项、畸形/超限项和既有附件目标，明确相应限制与错误。
目录与历史可分页，但所有应可达条目均须验证，不能用只加载最近几条来冒充目标语料。

参考 Host 为 4 vCPU／8 GiB／SSD，报告实际 CPU、虚拟化、磁盘、系统与缓存状态。正式测量前记录首次启动
与资源装载，再进行 2 次不计分预热及至少 30 次测量；每种目录首屏、会话首屏和旧页操作分别统计，
用 nearest-rank P95（排序后第 `ceil(0.95 × N)` 项），同时保留全部样本及错误/最大值。
计时从授权页面发起动作到首个可用页面/页完成呈现，使用真实 Host/OMP/DSH；模型/工具执行、人工回答等待
及首次启动按 Q3 另测，排除项须单列，不能从已定义的读操作中删除真实 RPC 或渲染成本。

稳定运行且无待答交互时，目录/会话首屏 P95≤3 秒、旧页 P95≤1 秒。错误、缺数据和非法重放独立判失败，
不因 P95 合格而通过。Bun Host 进程 RSS 在测试期间按不大于 50 ms 间隔采样，并用操作系统进程高水位
或等价测量确认峰值，目标≤512 MiB；瞬时采样遗漏不能据此判通过。
另报 OMP、浏览器、工具/转换进程与整机资源，不能据 Host 一项达标宣称整机受此上限约束。缓存淘汰、慢客户端、
大消息重组和重建也要覆盖；没有实际样本不得填 PASS。对目标的调整保留原值、失败证据、取舍和维护者决定。

## 证据记录、验收完成与后续交接

每个场景记录需求/合同指针、源/补丁/实际产物/schema/运行时与客户端资产身份、平台/浏览器/键位/配置、
fixture 来源、操作/期望/实际状态、测试及脱敏日志/trace/截图摘要、清理结果和局限。
状态使用 PASS、FAIL、BLOCKED、NOT RUN；未测试不折算成功，必需项不能无依据标为不适用。
外部依赖、预算或接口未就绪时保留阻塞理由；修复后重跑受影响证据，禁止无解释重试直到变绿。
测试资产不包含凭据、原始私人 prompt、用户会话、完整 stderr 或个人路径；原件使用可公开的合成样本。

可用 MVP 的完成要求：上述所有必需功能和负向路径在最终匹配组合上通过；真实平台、原生 TUI/数据兼容、
升级与可行回退、规模性能及进程清理均有证据；无未解决的必需能力阻塞，并提供安装/启动/登录、目录授权、
手动恢复、撤权/关闭、原件清理及不兼容安装处理的可复现手册。完整自动更新系统不属于首版交付。
维护者在该组合上完成目录导入、人工聊天/交互、历史导航/分支、图片/文件发送、重启恢复的可操作验收，
报告实际反馈，不能由代理代填认可。

后续规格须引用本合同和各规范来源，明确实际 public API/生成来源、能力矩阵、模块边界、数据兼容与每阶段
验收编号；再按 S0–S5 拆为带依赖的实现票。每票交付一个可复现闭环及正反证据，禁止用 placeholder 或
虚假成功解除阻塞。先处理 S0 的已知协议/客户端缺口，接口定义由同版本 wire/schema/client/server 一起设计。
初始目标未达标、公共语义无法实现或补丁扩成核心重写时，带证据返回相应决定；不默默改变范围。

本规划工单和地图关闭只确认开发方向、验收与交接依据。最终组合已冻结、验证并录入身份
（`docs/release-final.md`、`docs/evidence/ticket-61-freeze.json`）；不可变公开发布仍被
`packages/delivery/gate.ts` 阻断，维护者操作验收尚未执行，见 `docs/evidence/ticket-61-acceptance.md`。
