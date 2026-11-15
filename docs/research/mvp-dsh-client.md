# DSH Web Client 独立加载：MVP 组合与 Remote 契约依据

- 研究日期：2026-11-15；决策票：[DSH 客户端独立加载：最小组合与 Remote 契约依据](https://github.com/HowBoring/omp-webui/issues/2)；地图：[OMP WebUI 可用 MVP：关键决策地图](https://github.com/HowBoring/omp-webui/issues/1)。
- 唯一 DSH 源码基线：官方 release `dsh-v0.2.2-rc.3`，commit `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`。下列 DSH 链接全部固定到该 SHA。
- OMP 兼容边界沿用仓库锁定的 `18.20.2` / `7c49c11aa5bbaf3f418406583096168ad5b8c6dc`；本文不重新裁定 OMP RPC 行为。
- 已确定的产品范围：Linux/WSL2、localhost、单用户、OMP 预配置 cwd、仅管理 WebUI 创建的 Session；创建/恢复、流式会话和工具结果、approval/ask、取消、浏览器刷新恢复。本文是规划证据，不是实施结果或最终 UI roster 批准。

## 结论

**源码存在把 DSH 浏览器 Client 与 DSH Agent Host 分开组合的接缝；尚无本次实际构建、独立 Host 启动或浏览器验证，不能宣布独立运行已通过。**

`apps/web/src/main.ts` 只调用 `new AppWebEntry(root).run()`；boot kernel 构造浏览器 Cordis 树，没有在这个入口启动 Agent Runtime。可是上游明确拒绝裸 Vite serve：页面必须先取得 Host 提供的 loader facade、boot graph、动态插件产物及 Remote 服务。因此，候选是“由 OMP Web Host 承担 DSH boot/carrier 契约”，不是直接把 `dist/` 放进普通静态服务器即可得到可用聊天界面。[S1][S2][S3]

存在两个有边界的候选：**A，保留上游现成 Client 插件及其声明依赖闭包；B，保留 Conversation/Chat 核心，用小型 OMP Client 模块接替部分 workspace/settings/shell 服务。** A 的上游改动较少、Host Remote 适配面较宽；B 可缩小产品表面，但要证明替代服务满足原有公共接口，并形成明确的上游兼容决策。选择和验收边界仍属于后续人类决策；本票只证明这些候选有源码依据。[S4][S5][S6]

## 1. 精确入口、loader 与资产契约

| 层 | 锁定源码事实 | 对独立 Host 的要求 |
| --- | --- | --- |
| Web 应用产物 | `@deepseek-ai/dsh-web-frontend` 位于 `apps/web`，版本 `0.2.2-rc.3`，`vite build`，导出 `./dist/*`。 | 需要匹配本 SHA 的真实产物及许可证；不能用包名或 npm latest 推定兼容。[S1] |
| Boot library | `@deepseek-ai/dsh-client-web`，主入口 `lib/index.js`；`./injections` 导出注入解释器；`AppWebEntry` 先等待可选 `__DSH_BOOT_READY__.promise`。 | 注入要在入口读取前完成；若设置 deferred，须在所有脚本执行后 resolve，失败时 reject。[S2][S3][S7] |
| 注册 facade | `window.__ModuleLoader__` 必须存在；其 `create({boot, staticModules,...})` 采用 parser 预载的 `dsh-client-modules` factory。 | 交付 `bootInjections(graph)` 等价结果：注册队列、application preloads、blocking bootstrap scripts、`__DSH_BOOT__`，保持顺序。[S3][S8] |
| Graph | `WebBootGraph` 含 `rev`、可选 release identity、`entries`、`batches`；entry 含 id/url/rev、可选 inject/immediately/external。每个 entry 恰有一个 initial batch。 | 不能只造包名数组；遵守严格 manifest parser、修订及批次规则。package inject 可有互相等待关系，不应擅自当作普通无环拓扑排序。[S9] |
| 插件产物 | `dsh.client` 宣告 web/inject/external/immediately；`exports["./client"]` 指向真实产物。部分包有 Node/browser 条件导出。浏览器构建生成 `window.__ModuleLoader__.load({id,factory:(require)=>...})` factory。 | 服务 browser factory；不能把 `client.node.js` ESM 当 browser loader factory。依赖包的 Host root 与 browser `./client` 是不同面。[S8][S10][S11] |
| 动态资产 | revisioned combo、source map、package-local chunks、`/plugins/<package>/assets/<path>`，以及 `require.asset` 引用。 | 保留已发布 URL/rev 对应的 bytes、MIME、缓存及 404 语义；不要让未知插件请求落到 SPA HTML。只复制 shell JS/CSS 不足。[S8][S10] |
| Shell 静态依赖 | `PLATFORM_MODULES` / `seed.ts` 固定共享实例。 | 同一页面使用同一 React/Cordis 等实例；动态包的 external 必须解析到该模块表。[S12] |
| CSS/字体/语法 | shell import brand-font/base CSS；Vite 对 KaTeX WOFF2、字体 license、vendor、懒加载 Shiki grammars 有专门处理。 | 保留 CSS、字体/图像、worker/懒加载 chunks 和 notices，不能只对 JS 做依赖检查。[S1][S2][S10] |

共享平台模块精确为：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`；此基线的 `PRELOADED_CLIENT_EXTERNALS` 为空。这些是静态共享模块，不等于 boot graph 插件行。[S12]

### 可复用的 Host 中立接缝

`ClientModuleRegistry` 的 Node 面只声明 `static inject = ['loader']`；Web carrier 通过可选 `ctx.inject(['webServer'], ...)` 挂载。它公开 `graph()`、`fetchBundle(Request)` 与 `bootInjections(graph)`。据此可以研究复用“模块扫描/资产服务”而不启用 DSH Agent plugins；其 Node 依赖及 Bun 兼容性仍须构建/运行验证。另一路是按同一 wire 生成固定 graph 和注入表，代价是自己承担准确性和升级维护。[S8]

`__DSH_TRANSPORT__` 可替换逻辑 RPC、fetch、stream、bundle/asset transport；`AppWebEntry` 也有 `loadBundle/resolveAsset` seams。这证明 carrier 可替换，不表示 MVP 应绕开仓库已决定的 DSH HTTP/Remote mux 契约；`ownsHost` 是 worker/desktop 自有 carrier 的特权声明，普通 localhost served page 不应随意设置。[S3][S11]

## 2. 候选 A：保留上游 Client 插件的声明闭包

下面是**静态计算的候选闭包，不是经运行证实的最小可用集合**。算法：以 boot audit 的七个 required 名称，加本范围所需的 `ui-tool`、`ui-approval`、`ui-user-questions` 为种子，递归展开该 SHA 各 `package.json` 的 `dsh.client.inject`。结果 28 行；所有声明边都有已读 manifest 对应。这个数字不包含 shell 静态模块、生成的 Remote descriptors、被 bundle 内联的依赖或构建工具。[S4][S13]

以下标识统一加 `@deepseek-ai/` 前缀：

| 组 | 候选插件行 |
| --- | --- |
| boot/wire | `dsh-client-modules`、`dsh-client-connection`、`dsh-typert-registry`、`dsh-api-gateway`、`dsh-api-remotes` |
| domain adapters | `dsh-client-file-upload`、`dsh-api-session-controller`、`dsh-api-remote-access`、`dsh-api-workspace-controller` |
| UI 基础 | `dsh-client-ui-renderer`、`dsh-client-ui-settings`、`dsh-client-locale`、`dsh-client-ui-theme`、`dsh-client-shortcuts`、`dsh-client-ui-layout`、`dsh-client-ui-session` |
| Conversation | `dsh-client-ui-conversation`、`dsh-client-ui-chat`、`dsh-client-ui-tool`、`dsh-client-ui-approval`、`dsh-client-ui-user-questions` |
| 间接闭包 | `dsh-client-ui-workspace`、`dsh-client-ui-sidebar`、`dsh-client-ui-sidebar-right`、`dsh-client-resources`、`dsh-client-ui-context-menu`、`dsh-client-ui-file-drag`、`dsh-client-ui-input-trigger` |

容易漏掉的依赖有：

- 七个 required 名称只是“出现但未激活会致命”的审计集合；名字缺席不会导致 audit 失败。因此空 graph 的 audit 行为不能作为可用 UI 证据。[S4]
- `ui-chat` 的服务 inject 包含 `uiWorkspace`、`configForms`、`sidebarRight`、`fileDrag`；其 manifest 另含 `ui-input-trigger`。去掉右侧文件/终端等业务面板，不自动意味着可以去掉 `sidebarRight` 服务。[S5][S13]
- `ui-sidebar` 依赖 `uiWorkspace`；`ui-workspace` 依赖 `workspaces`、`remote.directoryPicker`、`remoteAccess`、`contextMenus`。固定 cwd 仍须处理这些服务及现成动作的能力边界。[S6]
- `locale`、`theme` 依赖 `configForms`；`ui-settings` 提供它并在启动调用 `remote.settings.describe()`，在 reconnect/document-updated 时重读。因此“不要设置页”不会自动去除设置协议依赖。[S14]
- Session client 明确等待 `remote.commands`、`remote.session`、`remote.subagents` 和 `fileUpload`。不展示 subagent 仍需 namespace 可用；namespace 挂载与实际支持全部子代理操作是两回事。[S15]

上游 `dsh-api-remotes/client` 一次挂载大量生成 contributions，覆盖 account/LLM/plugins/jobs/terminal 等超出 MVP 的 namespace。Gateway 的 `$mount` 处理 descriptor 注册和 namespace 安装，不在该过程查询所有业务端点；因此“bundle 中存在 descriptor”不等于“Host 必须实现全部功能”。但其**构建依赖闭包**仍要产出这些 `/remote` artifacts，不能据此声称前端已很小。[S16]

候选 A 必须把能力限制落到真实 UI 和服务行为：只允许固定 workspace/cwd、只列 WebUI Session；未选择的 archive/fork/directory browse/attachment/settings writes 等动作要有准确可见的能力边界或明确失败，不能返回伪成功。owner access baseline 本身不会替这些产品裁剪作决定。[S6][S17]

## 3. 候选 B：OMP 专用 shell / 服务贡献

可以沿公共 Client 模块/slot 机制组合 OMP 专用导航、Session 入口与交互呈现，继续复用 Session/Conversation/Chat/Tool。可研究接替 `uiWorkspace` 或 `configForms` 的窄实现，以及只挂载实际需要的生成 Remote contributions。接缝来自上面的明确服务注入与 Gateway `$mount`，不是存在一个上游现成“minimal OMP profile”的证据。[S5][S6][S14][S16]

此候选需要额外回答：替代服务是否满足消费端完整接口；如何移除或调整原 manifest 的 package inject 边；刷新时谁重新选中 Session；如何保证 layout/sidebar 与 Conversation 仍可启动；是否需要 fork 上游包声明。**仅补一个同名 Cordis service 或删除 required 名称，不足以证明兼容。** 在人类选择前不把 B 写成已批准架构，也不批准最终模块清单。

## 4. 必需与条件必需的 Remote 契约

| 层/行为 | 精确契约及证据 | MVP 分类 |
| --- | --- | --- |
| Unary carrier | 文档相对 `POST api/<endpoint>`；请求 `{type:'client-request',rpcId,method,payload}`，响应 `{type:'server-response',rpcId,result}`；严格关联 rpcId，result 为成功 value 或结构化 error。Gateway generated methods 发送命名 `args`。 | 所有候选必需；不能换成自定义 REST envelope。[S18][S19] |
| Stream carrier | `/api/remote.mux`；上行 open/item/end/cancel，下行 item/error/end，都带 streamId；逻辑流独立取消，stream uplink/half-close 有语义。 | 所有候选必需；普通 WebSocket message stream 不等价。[S19][S20] |
| Connection generation | `$events`，payload `{args:{}}`；第一项 `{type:'ready',clientId,host:{home}}`；随后 emit/waterfall/cancel。 | 浏览器 answering client 必需；ready 之后方可开始 baseline 获取。[S19][S20] |
| 回答 waterfall | HTTP `$events/result` 发送 clientId/eventId/outcome（next/result/rejected），waterfall 带 agentId，取消带 eventId。 | approval/ask 必需；必须映射到正确 Session、OMP worker/UI request 和浏览器 generation，不能凭相同 event 名称路由。[S20][S21] |
| Session 入口 | `session/list`、`session/create`；选择已知 Session 后通过 follow/history 打开，不能凭空另造 `session/resume` Remote。 | A 的列表/创建必需；WebUI-only catalog 是 Host 范围限制，不要求导入既有 TUI catalog。[S15][S22] |
| 发送/取消 | `session/prompt` 带 requestId/sessionId/mode/content/clientTimeZone，回 `{accepted:true}`；`session/cancel`。 | 必需；acceptance 不等于 turn 完成。[S22] |
| 历史/实时 | `session/follow` opening snapshot 含 header/cursor/records/hasMore/projections/可选 assistantStream；后续 event 或 assistant-stream。历史通过 `session/events`（兼容 `page`）和 follow 配合。 | 必需；刷新重取 durable snapshot，并恢复 active assistant baseline，不能重发 prompt。[S23] |
| 投影/控制 | `session/control` 每 generation 先 baseline，后 projection；`session/projections` 返回带序号的 baseline；wire event 含 type/seq/time/data 和可选 surfaceOp/sourceEventSeqs/ignorable。 | 所选 Session client 的重连和 UI 状态必需；不能压缩成 message 数组。[S15][S23] |
| Access | `remoteAccess/follow`；页面可注入 `__DSH_REMOTE_ACCESS__={type:'baseline',owner:true}`。没有 baseline 时 Client 答案先为 false。 | A 的 uiSession/uiWorkspace 必需；这不是认证替代品。[S17] |
| Workspace | `workspace/follow` complete baseline 后增量；现成 uiWorkspace 还持有 workspaces 服务和 directoryPicker namespace。 | A 条件必需；固定 workspace 的精确 DTO 和写动作政策在实施 spec 定稿；B 可用明确服务替代。[S6][S24] |
| Settings | `settings/describe` 启动及重连读取，`settings/mutate` 为表单写操作。 | A 启动至少需真实可用的读取语义；是否支持外观/语言写入需决策。[S14] |
| approval / ask | `approval/request`、`user-questions/request` 是 forwarded waterfalls；user-questions 另调用 `userQuestions.attachWait` / `answer` 并消费 projection。 | 仅 waterfall 提示框不保证刷新后恢复 pending ask；需 Broker 重放/投影及 OMP UI 状态映射。[S21] |
| 附件/命令/扩展动作 | fileUpload 服务为启动依赖；实际上传/历史图片、commands.execute、subagents.prompt/interruptByUser 等按消费路径触发。 | namespace 挂载要求与业务支持范围分开记录；附件若入选需 multipart/native bytes 契约，不能 JSON 字符串替代。[S11][S15][S18] |

Projection 的具体 key、tool schema、未知事件兼容和 OMP→DSH 映射仍是后续设计证据。当前 Client 的 follow-before-page、assistant dense index/revision/settlement、gap repair、generation baseline 清理已足够排除“追加字符串消息即可工作”的假设。浏览器刷新恢复还要求 Host 能重新识别 WebUI Session；本研究没有授权额外 transcript 数据库，也没有解决 Host 进程重启后 catalog metadata 的持久化选择。[S23]

## 5. localhost 启动也必须满足的安全依赖

上游 Web carrier 把认证与请求信任作为前置条件：launch token 在根 GET 交换为签名 cookie、重定向去 token；API/WS 都经 admission；Host/Origin/sec-fetch-site 检查与认证分开。cookie 的上游 signing secret 由 credentials service 持有；如果复用其 Host Connection，credentials/Peer 生命周期也属于启动闭包。如果自行实现 Bun carrier，就需提供等价认证、Host/Origin、WS admission、大小限制和结构化错误，而不因 loopback 省略。[S11][S19]

`__DSH_REMOTE_ACCESS__` 的 owner 标识只供 UI capability 计算，不能保护 HTTP/WS。`$events`/`$events/result` 需要允许 answering 的 Peer，结果还必须属于同一 Peer 的流。没有在 UI 展示某动作不等于 Host 可以免检。本文不要求公网、多用户或任意远程绑定。[S17][S19]

## 6. 已执行、未执行及下一步证据门槛

已执行：通过 GitHub connector 读取上述 pinned 源码/package manifests；交叉读取仓库 AGENTS、architecture、ADR 和 lock；本地对一手源码做静态搜索，并计算上述 28 行 `dsh.client.inject` 闭包。研究缓存放在 `work/research-dsh/`，没有把 DSH 源码或 bundle 纳入研究分支。

未执行：安装依赖、Typert 生成、TypeScript/tsdown/Vite 构建、`pnpm dsh web`、DSH Agent Host 启动、Bun 嵌入 ClientModuleRegistry、独立 HTTP/mux/浏览器 smoke test、真实 OMP 端到端测试。因此没有“构建通过”“无需 Host runtime 依赖”“最终最小 roster”或“可用 MVP”结论。

构建注意事项：上游根 `build:lib:client` 包含 `tsc -b tsconfig.client.json` 与 client-face tsdown；Vite 读取 workspace 已构建 `lib`，不是 source alias 直接替代；root tsdown 还引用生成器的 built plugin。Vite 同时声明独立 preview bootstrap input，preview 的构建依赖不等于 default 页面运行了 Agent Host。需先形成可重现构建顺序/依赖清单，再判断是否值得裁剪构建面。Node `>=24.9.0`、pnpm `11.28.5` 来自本 SHA 根 manifest。[S1][S10][S25]

npm 差异：项目现有锁记录 frontend latest `0.0.1-rc.5`、client-web latest `0.0.1-rc.1`，而本 SHA 两包为 `0.2.2-rc.3`。本次没有重新查询 registry 或检查 tarball；这些旧 npm 值只作为已有锁记录，绝不作为本 release 的 bundle 兼容证据。禁止把 `work/evidence/dsh/` 的较新 master 缓存当本 release 依据。

后续建议形成一个独立、受限的验证前提：从 exact SHA 产出匹配 browser artifacts，固定选定候选 graph，在**不启动 DSH Agent Host**时由最小 Host 注入/服务它，验证所有 required/pending dependencies、无意外 Remote 调用、一个 harmless unary、mux 打开/取消和刷新后的 baseline。保存构建命令、资产清单、完整调用清单、失败位置及浏览器证据。这个实验不会替人类批准 A/B，也不需要实现 OMP 产品流程。

下个人类决策：选择 A 的现成服务闭包，还是授权 B 的小型 Client/service 替代；确认固定 cwd 下保留/限制哪些现成动作，尤其 settings writes/attachments/directory picker；确认刷新恢复所需 WebUI Session 标识的保存范围。研究已把问题压缩到这些可判断的取舍，不把未运行的技术假设当作人类答案。

## 一手来源索引

以下均为 `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`：

[S1]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/apps/web/package.json
[S2]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/apps/web/src/main.ts
[S3]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/web/src/boot.ts#L51
[S4]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/web/src/boot-client.ts#L16
[S5]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/ui-chat/src/client/apply.ts#L80
[S6]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/ui-workspace/src/client/index.ts#L135
[S7]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/web/package.json
[S8]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/modules/src/index.ts#L588
[S9]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/modules/src/client/manifest.ts
[S10]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/apps/web/vite.config.ts#L12
[S11]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/connection/README.md#browser-authentication-and-request-trust
[S12]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/web/src/platform.ts
[S13]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/ui-chat/package.json
[S14]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/ui-settings/src/client/index.ts#L39
[S15]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/src/client/index.ts#L110
[S16]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/remotes/src/client/index.ts#L208
[S17]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/remote-access/src/client/state.ts#L35
[S18]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/connection/src/client/rpc.ts#L38
[S19]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/gateway/README.md
[S20]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/gateway/src/stream-protocol.ts#L33
[S21]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/ui-user-questions/src/client/index.ts#L219
[S22]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/src/index.ts#L467
[S23]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/src/types.ts#L434
[S24]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/workspace-controller/src/client/index.ts#L42
[S25]: https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/package.json#L21

补充精确源码入口：

- [Client factory/CSS/asset 构建 preset](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/tsdown.client.ts#L941)；[root tsdown 生成器耦合](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/tsdown.config.ts)。
- [Gateway descriptor mount](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/gateway/src/client/index.ts#L254)；[forwarded event allowlist](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/remotes/src/remote-events.ts#L29)。
- [Conversation 服务 inject](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/ui-conversation/src/client/apply.ts#L62)；[sidebar inject](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/ui-sidebar/src/client/index.ts)；[sidebar-right inject](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/ui-sidebar-right/src/client/index.ts#L89)。
- [locale inject/configForms](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/locale/src/client/index.ts#L558)；[theme inject/configForms](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/ui-theme/src/client/index.ts#L595)；[settings.describe](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/ui-settings/src/client/settings-mirror.ts)；[settings.mutate](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/ui-settings/src/client/config-form.ts#L134)。
- [Approval waterfall listener](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/ui-approval/src/client/index.ts#L107)；[Remote access follow](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/remote-access/src/client/mount.ts#L152)；[access global key](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/remote-access/src/snapshot.ts)。
- [Session journal 实际调用](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/src/client/transport.ts#L115)；[Session README 的重连/echo 语义](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/README.md)。
- 候选闭包 manifest 的可复核规则：每个 `dsh-client-X` 对应 `packages/client/X/package.json`（`dsh-client-locale/resources/shortcuts/connection/modules/file-upload` 同理）；`dsh-api-X` 对应 `packages/api/X/package.json`；registry 对应 [packages/typert/registry/package.json](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/typert/registry/package.json)。例如 [ui-workspace manifest](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/ui-workspace/package.json)、[ui-conversation manifest](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/ui-conversation/package.json)、[ui-input-trigger manifest](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/ui-input-trigger/package.json)；上游全量 Web profile 仅作对照，见 [web-app/cordis.patch.yml](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/bundle/web-app/cordis.patch.yml#L225)。
