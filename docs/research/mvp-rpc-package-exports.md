# OMP 公共 RPC 模块分发：包导出与 Bun 加载实证

- 日期：2026-11-15；研究票[OMP 公共 RPC 模块分发：锁定包导出与 Bun 加载实证](https://github.com/HowBoring/omp-webui/issues/26)，服务于[原生会话 MVP 的 OMP 公共 client 接入路线](https://github.com/HowBoring/omp-webui/issues/18)，属于[OMP WebUI 可用 MVP：原生会话发现与历史导航决策地图](https://github.com/HowBoring/omp-webui/issues/14)。
- 基线：OMP `18.20.2` / `7c49c11aa5bbaf3f418406583096168ad5b8c6dc`；Linux x86_64，Bun `1.4.4`，Node `24.22.1`，npm `11.19.1`。DSH 不在本次验证范围。
- 范围：npm 包、公开模块解析/导入与合成 framing 输入；未启动 OMP CLI/Worker、模型、工具或 Session，未读取用户配置/会话。本文提供选择证据，不替用户决定 transport 路线。

## 结论

公开低层模块在这个 Bun/Linux 基线上可以使用：`rpc-frame` 实际导入并完成 v2 大帧往返；手写 `rpc-types` 和独立生成 wire types 的源码、声明文件均在 npm 包内，运行时导入为空命名空间。**这些结果证明模块分发可用，不证明完整 Host transport 或交互闭环。**[S1][S2][S3]

JSON Schema 的包内字节存在，但没有可解析的 JSON 公共子路径。公开 `wire/index` 的 `buildRpcWireBundle()` 实际可调用，生成结果与包内固定 schema 深度相等；它是 schema 生成器，不是现成的 frame validator。Host 可把固定 SHA 的官方 schema 作为构建输入，或评估公开生成器；不能据此绕过 export map 在运行时定位包内 JSON 文件。[S2][S4]

`rpc-client` 公共子路径可解析；其静态 import closure 会触及 `.env` 加载和 native addon 初始化。本次为遵守不读用户配置的研究边界，**没有执行 RpcClient 的 runtime import**，因此不报告其加载成功、性能或 native ABI 兼容性。[S5][S6][S7]

## 四层证据

下表子路径均以 `@oh-my-pi/pi-coding-agent/modes/rpc/` 为前缀。

| 子路径 | 固定源码 / 发布包字节 | Bun 解析 | 实际导入 / 使用 |
|---|---|---|---|
| `rpc-frame` | `src/.../rpc-frame.ts` 与固定 SHA 逐字节相同；有 `.d.ts` | 成功，到 `src/modes/rpc/rpc-frame.ts` | 成功，导出 `RpcFrameDecoder`、`RpcFrameEncoder`、`encodeRpcFrame`、两个上限常量 |
| `rpc-types` | TS 与固定 SHA 相同；有 `.d.ts` | 成功 | 成功，`Object.keys(module) = []`；仅类型，不能验证 wire 数据 |
| `wire/rpc-wire.generated` | 独立生成 TS 与固定 SHA 相同；有 `.d.ts` | 成功 | 成功，空命名空间；源码没有 runtime import，避免手写 types 的内部类型依赖面 |
| `wire/index` | TS 与固定 SHA 相同；有 `.d.ts` | 成功 | 成功，仅导出 `buildRpcWireBundle`；调用得到 JSON Schema 2020-12，299 个 `$defs`、74 个 commands |
| `wire/rpc-wire.schema.json` | JSON 与固定 SHA 相同、包内确实存在 | **失败** | 未导入；extensionless `wire/rpc-wire.schema` 也失败 |
| `rpc-client` | TS 与固定 SHA 相同；有 `.d.ts` | 成功 | **未执行**；配置/native 副作用见下文 |

源码 `exports["./modes/rpc/*"]` 的 `types` 和 `import` 均指向 `./src/modes/rpc/*.ts`；发布包的 `import` 保持不变，`types` 改为 `./dist/types/modes/rpc/*.d.ts`。Wildcard 能覆盖包含 `/` 的 `wire/...`；对 `.json` 则仍追加 `.ts`，并不提供 JSON 导出。不能把源码 export map、tarball 文件存在、resolver 成功和真实 import 混为一项。[S1][S2]

本次只确认声明文件存在及 Bun 类型擦除后的 import；没有运行 TypeScript 项目级类型检查，因此未证明某个 Host tsconfig 下全部传递声明都兼容。生成 wire types 是公开合同输入，不应把其类型断言当作未知 JSON 的可信校验。[S3]

## 精确实验与结果

所有下载、解包、node_modules、lockfile、cache、tooling 和脚本均在 `/workspace/work/rpc-public-module-probe`（下称 `P`），没有修改项目依赖或全局工具，也没有重设 `HOME`/`CODEX_HOME`。通过 Python `urllib.request` 读取以下固定 npm 元数据及其 `dist.tarball`；下载字节先按 `dist.integrity` 校验，再用 `tarfile.extractall(filter='data')` 解包。[S2][S8]

```text
@oh-my-pi/pi-coding-agent@18.20.2：16,216,236 compressed bytes
sha512-ljShWzxyd0+8TPbpqf1GiPAUFz7Pk7tn8ieXBE6jKC6Qy18iuGurq1j3054sYciYW+knBVvzMFkNueRlg25L7g==
@oven/bun-linux-x64@1.4.4：52,418,437 compressed bytes
sha512-CHbbkmHVM28T1GFq+6GL4Ao4ujwwYwj1CxFFwEFzLanPfNsId9AhbIP0Q4reWuWBkGimUkoQygrK7Rgjtj3vog==
```

校验表达式为 `'sha512-'+base64.b64encode(hashlib.sha512(bytes).digest()).decode()`，与元数据严格比较。Bun 来自官方 `@oven` 平台包，直接使用 `P/tooling/bun/package/bin/bun`，未执行安装器。`package.json` 仅设置 `private:true`、`type:module`、精确依赖 `@oh-my-pi/pi-coding-agent:18.20.2`，然后在 P 执行：

```bash
env PATH=/workspace/work/dsh-tooling/node-v24.22.1-linux-x64/bin:$PATH \
  npm_config_cache=/workspace/work/rpc-public-module-probe/cache/npm \
  npm_config_userconfig=/workspace/work/rpc-public-module-probe/npmrc \
  npm_config_globalconfig=/workspace/work/rpc-public-module-probe/global-npmrc \
  npm install --ignore-scripts --no-audit --no-fund
# added 64 packages；native Linux x64 optional package 版本为 18.20.2
# package-lock.json SHA256:
# c4188bca447298ea2eed62532cf2fc319431f84fcd04d7fe2e16bf1b6a1764c2
```

resolver 探针逐项调用 `import.meta.resolve(prefix + subpath)`，允许执行的模块再 `await import(...)`，记录 `Object.keys(module)`。上表列出全部结果；两个 schema 子路径均报 `Cannot find package '@oh-my-pi/pi-coding-agent' imported from .../[eval]`。该文案不能反推整包未安装：同一进程的其他公开子路径均成功。

合成探针执行命令（退出码 0）：

```bash
env BUN_INSTALL_CACHE_DIR=/workspace/work/rpc-public-module-probe/cache/bun \
  TMPDIR=/workspace/work/rpc-public-module-probe/tmp \
  tooling/bun/package/bin/bun --no-env-file probe.ts
```

探针只从公开 `rpc-frame`、`wire/index` 及 Node assert/fs 模块导入。用 `RpcFrameEncoder.setProtocolVersion(2)` 编码 `{type:'response',id:'synthetic-only',command:'get_state',success:true,data:{text:'🙂'.repeat(300000)}}`：逻辑 JSON **1,200,097 bytes**，产生 **5** 个物理 JSONL 帧，各帧 ≤1 MiB。逐行 `JSON.parse` 后送入 `RpcFrameDecoder.push()`，最终对象与原对象深度相等。

另有 5 项 `assert.throws` 均通过：null 输入、首 chunk index=1、chunk 序列被普通对象打断、非 canonical base64、chunkId 中途改变。未知普通对象 `{type:'unknown_future_event',extra:true}` 被原样接受，直接证明 decoder **不做语义 schema validation**。本次没有穷举 decoder 的所有错误分支；严格 UTF-8、完整元数据/重组上限策略仍以固定源码为合同，后续 transport 验收须有专门 fixtures。[S3]

公开 `buildRpcWireBundle()` 的结果与从已校验 tarball 读取的 schema JSON `assert.deepEqual` 通过；该文件读取只用于本次研究比对，不是建议 Host 绕过导出。schema 保留 `x-rpc`、`x-open`、`x-unknown-fallback`、`x-scalar-or-array` 等合同；普通 JSON Schema validator 是否足以实现对应兼容政策，本次未验证。[S4]

## Native 与初始化边界

`rpc-frame` 的 runtime closure 只直接依赖 `node:util`、公开 `pi-utils/type-guards` 和模块级 `crypto.randomUUID()`；`rpc-types` import 是 `import type`。这一选择避开 `pi-utils` 根 barrel。`rpc-types` 自身的内部 Session/Agent 关联也是 type-only；生成 wire types 更独立，但都不授予 Host 调用内部对象的权限。[S3][S5]

`rpc-client` 与其 `rpc-messages` runtime import `@oh-my-pi/pi-utils` 根入口；它 re-export `env`、`ptree` 等。`env.ts` 在模块加载时读取 home/config/agent/project `.env` 并修改 Bun.env；`ptree.ts` import `pi-natives` 的 `Process`，native 根入口顶层调用 `loadNative()`。loader 的源码路径包含 addon 选择、require、release identity 检查、Tokio runtime 安装、grammar dir 配置和旧版本清理。因此“只导入 client，还没 start Worker”并不能证明无全局副作用或无 native 依赖。[S5][S6][S7]

本次 npm 安装带上了 Linux x64 baseline/modern `.node` 文件，但未 dlopen，未检验 CPU/glibc/缺失 native 包行为。曾探查 bwrap 隔离能力：网络 namespace 返回 `Operation not permitted`，不建网络 namespace 时 uid-map 返回 `Read-only file system`；没有继续扩大权限，也没有导入 RpcClient。**其解析成功、静态副作用证据、运行时未测试是三个独立结论。**

## 对接入路线决策的作用与剩余验证

低层路线的模块分发前提已有实证，但仍需实现有界 JSONL、语义校验、request/UI correlation、超时、EOF/drain 和监督；FrameDecoder 只处理已 parse 对象及 v2 chunks。client 补齐路线仍要解决通用 Extension UI listener/response、保留 prompt ack、graceful stdin EOF/drain 的既有公共 API 缺口，同时评估上述 import 副作用。本文没有修改或重选两条路线。[S3][S5]

下一阶段仍需独立验证完整 `rpc-ui` 启动/协商/交互、真实生命周期和失败清理；本次完全不承担该 Worker smoke。schema validator、TS 类型检查、其他平台和其他 Bun 版本亦未验证。现有 npm bytes 及固定源码相符不表示未来发布同样可用，应继续固定版本和 integrity。

## 第一方固定来源

- [S1 固定源码 package.json](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/package.json)
- [S2 npm 18.20.2 metadata](https://registry.npmjs.org/@oh-my-pi/pi-coding-agent/18.20.2)；[实际 tarball](https://registry.npmjs.org/@oh-my-pi/pi-coding-agent/-/pi-coding-agent-18.20.2.tgz)
- [S3 rpc-frame](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-frame.ts)；[rpc-types](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-types.ts)；[生成 types](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/wire/rpc-wire.generated.ts)
- [S4 wire/index](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/wire/index.ts)；[schema JSON](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/wire/rpc-wire.schema.json)
- [S5 rpc-client](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-client.ts)；[rpc-messages](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-messages.ts)
- [S6 utils barrel](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/utils/src/index.ts)；[env eager load](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/utils/src/env.ts#L289)；[ptree](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/utils/src/ptree.ts)
- [S7 native entry](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/natives/native/index.js)；[loader](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/natives/native/loader-state.js#L999)
- [S8 官方 Bun 平台包 1.4.4 metadata](https://registry.npmjs.org/@oven/bun-linux-x64/1.4.4)；[tarball](https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-1.4.4.tgz)
