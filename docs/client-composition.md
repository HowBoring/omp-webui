# DSH 客户端组合与能力合同目标

Status: 用户已确认组合方向和产品范围；公开接缝隔离实验已通过，最终产品构建与集成仍待验证。

日期：2026-11-15。决策：[原生会话与历史导航 MVP 的 DSH 客户端组合](https://github.com/HowBoring/omp-webui/issues/19)。
取舍见 [ADR 0005](adr/0005-dsh-client-composition.md)。

## 已选方向

- 复用固定 DSH 的聊天、Conversation、工具、布局及基础服务，不重写核心 Conversation。
- 增加 OMP 目录/历史模块，并接受最小、公开、可审计的导航/动作策略扩展点补丁。
- 保留当前 Session 的模型/思考级别选择；外观和语言仅修改 WebUI 偏好。
- 新图片和文件输入是 MVP 必需项。provider、密钥、插件、终端等全局管理不纳入首版。
- Tree 查看、同 Session History Navigation 和历史用户点 Branched Session 仍是必需项，
  不用 stock fork/trajectory 的相似名称代替原生语义。

## 起始模块与最终清单

下表为已通过空数据启动实验的 28-plugin 基线。每个名称加 `@deepseek-ai/` 前缀。
它包括依赖服务，不代表每个服务都要提供完整产品界面，也不是经证明的最小集合。

| 层 | 基线插件 |
| --- | --- |
| Boot/Remote | dsh-client-modules、dsh-client-connection、dsh-typert-registry、dsh-api-gateway、dsh-api-remotes |
| Domain 服务 | dsh-client-file-upload、dsh-api-session-controller、dsh-api-remote-access、dsh-api-workspace-controller |
| UI 基础 | dsh-client-ui-renderer、dsh-client-ui-settings、dsh-client-locale、dsh-client-ui-theme、dsh-client-shortcuts、dsh-client-ui-layout、dsh-client-ui-session |
| Conversation | dsh-client-ui-conversation、dsh-client-ui-chat、dsh-client-ui-tool、dsh-client-ui-approval、dsh-client-ui-user-questions |
| 间接依赖 | dsh-client-ui-workspace、dsh-client-ui-sidebar、dsh-client-ui-sidebar-right、dsh-client-resources、dsh-client-ui-context-menu、dsh-client-ui-file-drag、dsh-client-ui-input-trigger |

OMP 目录、历史与受限偏好界面使用本仓库的小模块/公开 slot。最终 manifest 必须连同公开
patch、依赖边、静态共享模块、资产及构建摘要一起冻结；新增模块可能改变总数。
不因本次选择就删除 configForms、uiWorkspace 等消费端仍依赖的服务，或提前重写它们。
上游源码/生成 bundle 继续放在忽略目录，不能以插件数量推断 Remote 方法支持范围。

## 导航和原生身份

- OMP 目录表面按真实工作目录呈现已发现、已登记、占用及失效记录；未登记候选不是另一个
  transcript。发现、登记、打开分别遵守[目录合同](session-catalog-contract.md)。
- 原生候选由 OMP 目录模块负责首次打开流程；只有登记/身份校验与接续结果明确后，才向
  stock Session navigation 提供可操作身份。不能先伪造可用 Session，再补 native identity。
- 初始加载、刷新、选择或恢复工作目录不能隐式创建原生 Session。显式新建与提交等用户
  操作的精确生命周期须由公开接缝和附件合同验证，不能根据同一个 create 请求猜操作来源。
- 外部 owner 占用期间只显示目录元数据与原因；旧进程退出后才能打开历史/树和继续。
- 浏览器恢复复用 Host 已有 worker；不再用 create/open 请求冒充刷新握手。

## 公开接缝的必要范围

源码已证实：stock uiWorkspace 的恢复/选择路径调用 sessions.create；现有 Session 的
openSession/retain/open 路径则读取其流。uiWorkspace 私有构造并捕获导航控制器，不能通过
补一个同名服务证明已替换行为。[S1][S2]

公开 slot 支持按优先级 shadow 界面，但菜单/快捷键注册拒绝重复 ID，部分 rename/fork/archive
快捷键没有与菜单相同的 access check。真实 owner baseline 又会允许全部 access 查询。
所以新接缝必须覆盖自动恢复/创建策略，以及菜单、快捷键、双击和其他动作入口；不能只改 CSS。
支持能力与真实授权分别检查，Host 仍按实现范围拒绝未支持操作。[S3][S4]

这些是隔离候选补丁中的新扩展，不是固定官方 release 已有 API，详见[公开策略验证](dsh-policy-validation.md)。patch 记录 base SHA、内容摘要和
构建身份；不得把修改后产物标为未经修改的官方 release。若需要扩大为大范围核心 fork，
先记录阻塞并重开组合决策，不静默扩大变更。

## 必需 Remote 与可见能力

| 能力 | 必要合同及边界 |
| --- | --- |
| 启动 | DSH Connection envelopes、Remote mux、$events generation、remoteAccess/follow；owner baseline 不是认证或实现能力声明 |
| 本机访问 | 30 天可撤销浏览器授权，网页显式目录授权/撤销；普通 Session open 不扩大目录权限，按[本机访问合同](local-access-contract.md)实现 |
| 目录/Session | workspace/follow 与 session/list 等既有 DTO 的真实适配；OMP 专用操作沿生成的 DSH Remote contributions，新增方法名/字段另定，不创造第二套浏览器协议 |
| 创建/打开 | 明确用户动作和真实结果；workspace/initializeDefault 的“不适用”可返回原生合同允许的 undefined，但不能伪报创建成功 |
| 聊天/取消 | session/prompt、session/cancel；DSH accepted 与 OMP prompt ack、prompt_result、settled 分开映射；MVP 忙时拒绝新输入入队，不照搬 stock keepInbox 的停止语义 |
| 历史/实时 | session/follow、实际分页调用、session/control 与 projections；active branch、assistant baseline 和重连规则由投影决策细化 |
| 工具/交互 | 复用 Tool、approval、user-questions 呈现；$events/result、ask 回答和投影须绑定正确 Session/worker/UI generation，按[交互生命周期合同](interaction-lifecycle-contract.md)实施首个有效答复结算与重投 |
| 模型/思考 | 只适配已授权当前 Session 的真实 OMP 能力；不据此开放 provider/凭据/角色全局管理 |
| WebUI 偏好 | settings/describe 提供真实受支持 namespace；写入仅限 WebUI 自有偏好，按准确 namespace 合同适配，不回传伪成功 |
| 图片/文件 | raw binary/base64 上传、暂存回执、prompt 消费、历史引用和失败/清理需要附件合同；不能把通用 multipart response 当成上传格式 |
| Tree/恢复 | 小型 OMP History 模块通过 public views/slot 扩展；原生 get_tree/navigate_tree/branch 与手动 retry 不与 stock fork/trajectory 混同 |

namespace 为启动而挂载不等于实现全部方法。泛型命令、上传、目录浏览等不因 descriptor
存在就获得授权。未选功能默认不展示；MVP 功能因占用、缺能力或错误暂不可用时保留原因。
拒绝路径也须覆盖快捷键/粘贴/拖拽等入口；客户端隐藏不能替代 Host 的实际拒绝。

## 附件必需，但生命周期另定

OMP 公共 prompt 支持 images；普通文件的 prompt 文本 @path 展开也实际经过 RPC handler。
它们不是 CLI 初始 @file 参数，更不是一个通用二进制 ingestion RPC。[S5]

DSH stock 上传可以是 application/octet-stream 或 base64 Remote，产生 Session-scoped
receipt；composer 连已上传图片也可通过 file receipt 提交。图片 history API 不代表任意文件
下载 API；不能随意把 receipt 转成路径、丢弃 MIME/原始 bytes 或把所有格式都说成支持。[S6]

图片 bytes 映射、普通文件的受控可读位置与安全 @path 构造、格式/限额、持久性、重启、取消、
孤儿清理、预览/下载和历史 projection 由
[图片与文件输入：格式范围、RPC 链路与存储边界](https://github.com/HowBoring/omp-webui/issues/28)决定。
本次不批准永久 Host 附件库或 Host PDF/Office 解析器，不创建第二份 transcript。

## 验证门禁

- [DSH 导航与能力接缝：自动创建及动作门禁实证](https://github.com/HowBoring/omp-webui/issues/27)：
  隔离实证和候选 patch/manifest 已固定，见[验证结果与边界](dsh-policy-validation.md)；真实 OMP/Bun 集成、最终 roster 和浏览器键位矩阵仍需验收。
- 附件合同、实际浏览器上传/回执/取消/历史读取，以及 OMP 图片/普通文件链路必须验证。
- 使用真实支持的 namespace/typed DTO；不以空 fixture 回答冒充产品服务。未知 capability、
  部分失败、非图片文件和被占用 Session 都需可见的正确结果。
- Tree 的选择/预览、原会话导航与新建会话确认、草稿手动发送，以及停止后重新发起流程，已由
  用户通过原型确认，见[历史交互合同](history-interaction-contract.md)。停止/交互政策亦已确认，
  实际启动 UI、busy 输入门禁、取消/重投与原生静止仍需真实验证；投影算法由对应工单细化。
  完整 OMP/DSH 端到端仍是验收门禁。

已有 28 插件空数据启动与公开策略补丁的隔离对照证据；后者包含两个 fixture 插件，不是最终产品 roster。
产品运行时仍未接入 DSH、上传存储或真实 OMP。官方基线仍为 DSH dsh-v0.2.2-rc.3 / 38a6a5c965aa99ab525161efb7cc5cf1fe62fced。

## 固定一手证据

- [启动实证](https://github.com/HowBoring/omp-webui/blob/7eb680f74fbf1ab9a40990e8b450f0f820d5fe0e/experiments/dsh-standalone-boot/README.md)
- [S1 导航 create/restore](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/ui-workspace/src/client/navigation.ts#L208-L269)；[恢复](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/ui-workspace/src/client/navigation.ts#L465-L500)
- [S2 remote create](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/src/client/sessions/manager.ts#L483-L525)
- [S3 快捷键](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/ui-workspace/src/client/shortcuts.ts#L90-L117)；[slot shadow](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/ui-slots/src/index.ts#L1197-L1207)
- [S4 owner access](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/remote-access/src/client/state.ts#L178-L186)
- [S5 RPC 调用 prompt](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L1997-L2004)；[原生 file mention 展开](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/agent-session.ts#L9643-L9661)
- [S6 上传协议](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/file-upload/src/client/runtime.ts#L192-L247)；[回执消费](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/src/commands.ts#L340-L375)
- [Conversation 公开 view actions](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/ui-conversation/src/client/contract/slots.ts#L254-L285)
