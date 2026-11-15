# OMP 公共 RPC transport 合同目标

Status: 本地窄 transport 路线已由用户确认；工程语义为实施目标，运行时集成待完成。

确认日期：2026-11-15；上游研究基线保持 OMP 18.20.2 / 7c49c11aa5bbaf3f418406583096168ad5b8c6dc。

工单：[原生会话 MVP 的 OMP 公共 client 接入路线](https://github.com/HowBoring/omp-webui/issues/18)
调查：[OMP 公共 RPC 模块分发：锁定包导出与 Bun 加载实证](https://github.com/HowBoring/omp-webui/issues/26)

## 两个不同的缺口

- Host client 缺口：通用 rpc-ui UI 往返、完整 prompt ack、优雅 EOF/drain 的公共便利接口。
  这些所需 wire 行为已有固定源码证据；不能把缺便利方法当作 wire 不存在。
- OMP server 缺口：原生目录/描述与严格接续保证。两条 client 路线都仍需公共 RPC 扩展，
  交付基线和兼容门禁由后续工单决定；本地 transport 不会消除该依赖。

## 路线选择

| 路线 | 做法 | 成本及结论 |
| --- | --- | --- |
| 本地窄 transport（已选） | 复用 OMP 公共 decoder/wire/schema，Host 用 Bun 管进程、关联与生命周期 | 本仓库维护 transport 的协议、UI 关联、超时、输出排空和故障测试 |
| 优先扩展上游 RpcClient | 补齐 public UI/admission/close 接口，再由 Host 适配 | 不作为当前前置路线；需交付公共 API 增量，并验证生命周期、依赖及 Host 组合 |

两者都启动外部 OMP rpc-ui 进程，不 import AgentSession/SessionManager，不复制旧 SDK Driver。
禁止通过私有字段、patch 实例内部方法、第二个 stdout reader 或私有 session SDK 补缺口。

## 无论路线如何均需遵守的合同

### 启动与边界

- 使用受控 argv、cwd 和环境启动 `omp --mode rpc-ui`；正常模式不加 `--no-ui`。
- stdout 是协议唯一输入；stderr 单独有界处理并脱敏，不把诊断行作为事件解析。
- 在接收启动期 UI 前安装路由；OMP ready 不等于 UI 初始化完成或 Session 可执行。
- 校验 ready 的公共协议字段并协商 v2。DSH ready 和 OMP ready 是不同的边界。
- 一个 worker 的 stdout 只有一个 reader/decoder/关联器。上层可以订阅已解析事件，不能抢读流。

### Framing 与验证

- 固定版本上游物理 JSONL 上限 1 MiB（含 newline）、v2 重组上限 64 MiB；stdin 不 chunk。
- 物理字节读取、行边界和缓冲区限制由 carrier 负责；公共 RpcFrameDecoder 处理已解析的
  frame/chunk 重组，不是物理 reader，也不替代完整语义 schema validation。
- 命令和 UI 回答按公开 inbound schema 验证，stdout 的分流按公开 unions 和 correlation 验证。
  不另外手抄一套命令/事件定义；schema 与生成输出须可追溯到同一固定上游版本。
- 发布包的 raw JSON Schema 子路径不能直接 import；已验证的公共 wire/index 及其
  buildRpcWireBundle() 可在构建期产生与同版本发布 schema 一致的输入。生成 wire 模块是
  类型导出，不提供运行时 validator；本地边界校验须另行生成并验证。
  完整生成器入口为 `@oh-my-pi/pi-coding-agent/modes/rpc/wire/index`，独立生成 types 入口为
  `@oh-my-pi/pi-coding-agent/modes/rpc/wire/rpc-wire.generated`。
- 生成校验器时保留 JSON Schema 2020-12 及 `x-rpc`、`x-open`、`x-unknown-fallback`、
  `x-scalar-or-array` 的合同含义；普通 schema 编译成功不等于兼容政策已实现。
- 公开源码路径、tarball 文件存在、受支持的 import，以及完整 runtime validation 是不同结论。
- 非法 UTF-8、物理/逻辑超限、非法 chunk、未知不兼容帧或无法关联的关键帧应显式失败。
  只有上游合同明确允许忽略的未知信息才可忽略，不能吞掉未识别 UI。

### Admission、结果和交互

- 分配并关联 request id，允许乱序响应；一个请求只结算一次，超时后的迟到帧不复活请求。
- 保留完整 prompt ack。`agentInvoked:false` 的同步 builtin 在成功响应完成；异步提交
  通过相同 id 的 prompt_result 完成。agent_end、prompt_result 与 session_settled 不混为一谈。
- 持续接收 Extension UI、host-tool/URI 等公共帧，不论是否有浏览器订阅。
- 低层负责 schema/correlation/worker generation；Interaction Broker 负责用户授权、呈现、
  回答者、超时及断线政策。不能默认同意或把取消浏览器流等同于 OMP abort。
- 不把传输层成功或原生 ack 当作模型任务成功；历史导航/branch 后身份和活动 leaf 由 RPC 回读。

### 关闭与故障

- 停止接收新工作，按上层政策处理正在进行的任务和 pending UI，再关闭 stdin。
- EOF 后继续读取 stdout/stderr，等待 exit；限时后才 kill/reap，关闭结果区分正常退出与强制中止。
- stdin EOF 会排空已受理工作，不保证正在进行的工具立即结束；具体预算和 abort/settle
  选择属于进程/交互政策，不能伪造一个固定版本不存在的 shutdown RPC。
- 丢失 worker 或发生协议错误后，未能确认终态的操作保持“结果未知”；不自动重放 prompt/工具。
- 协议 client 不拥有 transcript；重建投影、索引、DSH cursors 和对话呈现由对应组件处理。

### 版本与依赖

- 优先使用明确 public RPC subpath 和 type-only wire types；不从 coding-agent 根入口加载 SDK。
- 包版本、源码 pin、schema/生成输出和实际启动 worker 的来源需要一致；没有 ready version/digest
  字段时不能假定协议提供了它。保持来源和能力验证，不只比较一个浮动 semver 字符串。
- native dependency 或导出不兼容属于发布/兼容门禁，不能以私有 import 或复制运行时文件回避。
- 若未来换成补齐能力的上游 client，必须通过同一外部行为测试后替换实现；不维护双重关联器。

## 验证责任与当前限度

1. 隔离安装固定发布包，验证公共导出、Bun 运行时、schema/生成 types 的实际可用入口。
2. 有意义的协议 fixture：字节拆分/多行、chunk、非法 UTF-8、边界上限、乱序/迟到/重复响应。
3. 启动期 UI、完整 ack 两种路径、pending UI 取消及 worker generation 的协议测试。
4. stdin backpressure、EOF 后末尾输出、非零退出、超时 kill/reap、不自动重放的进程测试。
5. 实际 OMP rpc-ui v2 和 UI 往返 smoke；LLM/工具闭环另行验收，不能以 fake worker 代替。

本文不实现任何 transport，不决定用户交互所有权/断线政策，不批准最终 OMP server 构建基线。
安装/导出调查只证明相应模块事实，不证明真实 OMP 或 DSH 端到端通过。

范围取舍见 [ADR 0004](adr/0004-local-public-rpc-transport.md)。目录与严格接续扩展的
交付基线由[OMP 目录与严格接续扩展：交付基线和兼容门禁](https://github.com/HowBoring/omp-webui/issues/25)承接。
