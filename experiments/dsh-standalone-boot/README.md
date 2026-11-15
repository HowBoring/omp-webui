# DSH 独立构建与启动实证

- 工单：[原生会话 MVP 的 DSH 独立构建与启动实证](https://github.com/HowBoring/omp-webui/issues/16)
- 地图：[OMP WebUI 可用 MVP：原生会话发现与历史导航决策地图](https://github.com/HowBoring/omp-webui/issues/14)
- 日期：2026-11-15；项目基线 `ebaddda6a2ad168926911dcc58662cf68ba562a8`。
- DSH：`dsh-v0.2.2-rc.3` / `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`；未修改上游受版本控制的文件。

## 结果

**固定源码可构建，并能在不启动 DSH Agent Host 的临时 Node 宿主中加载浏览器客户端。**
这次使用此前静态研究的候选 28 插件闭包，不证明它是最小集合或批准最终产品 roster。
实验资产留在独立分支，不合并产品；`master` 的 Host 仍是健康检查骨架。

| 检查 | 实际结果 |
| --- | --- |
| 冻结依赖安装 | pnpm 11.28.5，398 workspace projects，1433 packages；忽略 lifecycle scripts，exit 0 |
| 完整产物构建 | `pnpm run build:artifacts --serial`，8 passed / 0 failed / 0 skipped，142.00 s |
| 聚合检查 | 随后的 `pnpm run build:check --serial`，Host + Client 两项 passed，118.43 s |
| 产物记录 | 上游记录 371 client artifacts，摘要见 evidence/toolchain.json；Web dist 约 23 MiB，含 map/preview 等未在此加载的文件 |
| 裸静态负对照 | Chromium 显示缺失 `window.__ModuleLoader__` facade 的 boot 错误，符合上游要求 |
| 无观测钩子的注入页面 | 正常显示 DSH release、New Session、工作目录侧栏和空会话输入面；无 pageerror |
| 带观测钩子的页面 | 28/28 插件 ACTIVE；无 missing inject、pageerror、console error、失败请求或 HTTP 错误 |
| 资源 | 两批插件（bootstrap + application）、shell/vendor JS/CSS、favicon 返回正确 MIME；未知插件 404 |
| Remote | 实际浏览器 POST 和四个 mux stream 打开成功，使用精确命名 args、关联 rpcId 和原生帧格式 |

运行环境为 Linux x64/glibc、Node 24.22.1、pnpm 11.28.5、Chromium 156.0.8078.79、Python Playwright。
环境初始 Node 缺少 `include/node/node_api.h`，第一次构建在 native 阶段失败；改用相同版本的
官方完整 Node distribution（校验 SHA-256）后通过。未降级锁或修改构建源码。
默认沙箱另曾拒绝 loopback listen；仅为隔离探针开放本地监听后通过。

## 探针的边界

`host.mjs` 使用真实构建产物、上游 `ClientModuleRegistry` / `bootInjections` /
`renderIndexInjections`，只给 Registry 提供静态 package metadata rows，不挂载 DSH Host plugins。
使用 Node HTTP + ws 临时提供同源静态资源及有限 fixture；没有加载 Agent Runtime、模型、工具、
真实 Session 或用户配置。它不属于 OMP Host 的实现，也没有验证 Bun 下的 Registry/asset carrier。

实际启动调用如下，详细输入/关联 ID 和资源响应保存在 [browser.json](evidence/browser.json)：

| 方法 | fixture 响应 |
| --- | --- |
| `settings/describe` | `{namespaces:[], writable:false, hasDocument:false}`；每页观察到两次调用，不推定固定调用次数 |
| `session/list` | `{items:[]}`，请求为 `{args:{_request:{}}}` |
| `workspace/initializeDefault` | 成功值 `undefined`，表示不符合 first-use 初始化条件；不返回创建收据，不产生目录/Session |
| `$events` | ready/clientId/host.home，维持打开 |
| `remoteAccess/follow` | owner baseline，维持打开；此 fixture 不是认证实现 |
| `workspace/follow` | 空 Workspace/archived/pinned baseline，维持打开 |
| `session/control` | `{type:'baseline',value:{projections:{}}}`，维持打开 |

空数据页会自动尝试 `workspace/initializeDefault`；这并非纯列表读取，产品必须在目录/客户端
决策中明确处理，不可把现成 UI 的自动创建语义直接映射到 OMP。本探针只返回合法的“不适用”。
第一次注入探针遗漏 `session/control` 响应时，插件仍全部激活但控制流报错；补上契约后最终
结果无错误。因此“所有插件 ACTIVE”本身不能替代 Remote 行为验证。

浏览器观测器只在 `?observe=1` 下转发模块系统 `entries.start` 并保存 Loader 引用；另一个
不加观测器的页面独立检查实际 shell。早期对 Context.prototype.plugin 的错误观测方式曾干扰
启动，已移除；这些探针调试失败不作为上游缺陷。最终断言使用的结果见提交内证据。

本次未证明聊天/创建/恢复/导入、真实 OMP RPC、历史投影、tree/navigation/branch、审批/ask、
附件、设置写入、断线重连/取消、资源限额、认证或分发。未加载所有懒资源，也未做独立冷环境
二次构建，因此产物摘要是本次身份记录，不是可复现构建保证。上游源码和 bundle 均未提交。

## 复现

在本项目的忽略目录下检出固定 DSH；不要以 floating master 或 npm latest 替换。
选用带开发头文件的 Node >=24.9.0，并将 pnpm/Corepack/store/cache 指向可写的工作目录。

```sh
git clone --depth 1 --branch dsh-v0.2.2-rc.3 https://github.com/deepseek-ai/deepseek-harness.git vendor/dsh-boot-proof
cd vendor/dsh-boot-proof
git rev-parse HEAD
corepack pnpm --version
corepack pnpm install --frozen-lockfile --ignore-scripts --store-dir /path/to/work/pnpm-store
corepack pnpm run build:artifacts --serial
corepack pnpm run build:check --serial
```

回到实验分支根目录，`EVIDENCE_DIR` 须已存在；两个终端分别运行宿主和浏览器探针：

```sh
node experiments/dsh-standalone-boot/host.mjs /absolute/path/to/vendor/dsh-boot-proof /absolute/path/to/EVIDENCE_DIR
python3 experiments/dsh-standalone-boot/browser.py /absolute/path/to/EVIDENCE_DIR
```

探针只监听 `127.0.0.1` 随机端口，写出 server.json；完成后对该记录的 PID 发送 SIGTERM。
Python 需要 Playwright，可用 `DSH_PROBE_CHROMIUM` 指定系统 Chromium 路径。
不要使用本探针提供任何私有会话数据或把它当作产品安全实现。

## 固定来源

- [上游构建依赖顺序](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/scripts/compile-referenced-projects.ts#L177)
- [模块 Registry 与 boot 注入](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/modules/src/index.ts#L608)
- [上游 Web 入口](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/web/src/boot.ts#L51)
- [Session list/control 类型](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/src/types.ts#L573)
- [自动 Workspace 初始化路径](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/ui-workspace/src/client/navigation.ts#L465)
- [initializeDefault 的可缺省成功值](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/workspace-controller/src/index.ts#L96)

后续产品 roster 及服务替代方案由[原生会话与历史导航 MVP 的 DSH 客户端组合](https://github.com/HowBoring/omp-webui/issues/19)决定。
