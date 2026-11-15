# 原生会话目录：发现、导入与工作目录分组

- 研究日期：2026-11-15；OMP `18.20.2`，固定 SHA `7c49c11aa5bbaf3f418406583096168ad5b8c6dc`；DSH `dsh-v0.2.2-rc.3` / `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`，本文不验证 DSH 映射实现。
- 研究票：[原生会话目录：发现、导入与工作目录分组的公共能力](https://github.com/HowBoring/omp-webui/issues/15)；地图：[OMP WebUI 可用 MVP：原生会话发现与历史导航决策地图](https://github.com/HowBoring/omp-webui/issues/14)。
- 已确认范围：cwd→Session 列表，发现/导入既有原生 TUI Sessions，Host 重启保留引用索引，手动 crash 恢复，旧进程退出后 WebUI 继续，树查看/同 Session navigation/历史用户点 branch 到新 Session。活 owner 强行转移不在范围内。
- 本文是固定源码静态证据。未读用户真实 sessions、未启动 OMP/TUI、未调用模型、未安装依赖或实现产品。

## 结论与能力矩阵

**扩大的 MVP 需要新增公共 server catalog/describe 能力。** 这不是只凭 wire 没有 `list_sessions` 的判断：已检查 RPC 命令表、prompt→ACP builtin dispatch、`/resume` 与 `/session` text/TUI handlers，以及 CLI session/--resume 入口。OMP 已有内部全局/按项目 discovery 与丰富元数据，但没有对 Host 暴露等价的结构化、只读、分页 RPC 合同。[C1][C2][C3][C4]

| 需要 | 现有公共入口 | 已证实的边界 |
|---|---|---|
| 全局 cwd→Sessions catalog | RPC schema 没有全局/workspace catalog；get_state 只当前 Session | 不能由新空 worker 发现任意既有 TUI Sessions；get_session_lease 只对给定 ids 探测。[C1][C5] |
| 通过 prompt 发现 | rpc-mode 先执行 ACP text builtin；`/resume` 仅 handleTui；`/session` text 仅当前 info/delete/pin | `prompt("/resume")` 不会调用 TUI selector，也不会返回 catalog；可能落入 extension/普通 prompt，不应拿它当后门发现。[C2][C3] |
| CLI 选会话 | `omp --resume` 无值调用本地/all-project TUI picker；`--resume <id/path>` 可恢复已知目标 | 前者不是 machine-readable catalog；后者需要已知引用。CLI session 子命令是 pack/unpack/moved/lease，无 list/import-register。[C4][C6] |
| 查根目录配置 | `omp config path` 打印 active agentDir；getSessionsDir/profile/XDG 解析在 OMP 内部 | agentDir 不总等于 sessionsRoot 的父目录；没有 RPC roots/profile discovery。CLI config path 不是 Session catalog。[C7] |
| 注册 Imported Session | Host Session Index 可以只保存原生引用与 Workspace 关联 | “导入”在本项目是注册，既非 transcript copy 也非 OMP archive unpack；注册本身不需要 writer、不需改 OMP Session。缺的是可靠的发现/只读描述输入。[C8] |
| 打开已知 Session | `switch_session:{sessionPath,provider?,modelId?}`；`open_session:{sessionDir,...}`；CLI --resume | switch 是写者会话切换而非只读验证；open 选目录最近非空/continuation，不是按指定 id 精确导入。[C9] |
| 判定占用 | `get_session_lease:{sessionIds}` / `omp session lease --json -- <id>...` | 返 `{held,unknown}`，含本进程，不含 owner；不 reservation。发现/注册可只读进行，开始写前按“原进程先退出”政策处理。[C5] |

## 原生内部 discovery 的范围

路径由 OMP 当前 profile、环境与 cwd 解析，Host 不应复制这套规则或扫描目录：

- 默认 getSessionsDir 为 agent 数据子目录 sessions，传统布局通常 `~/.omp/agent/sessions`。命名 profile 位于配置根 profiles/<name>/agent；`OMP_PROFILE` 优先于兼容变量 `PI_PROFILE`，CLI 也有 --profile。默认 profile 可由 `PI_CODING_AGENT_DIR` 覆盖；命名 profile 不沿用该 override。[C7]
- XDG 实际 resolver 在支持平台检查所选 app/profile 路径是否存在，再选择 XDG data/state/cache 根；sessions 属 data，XDG 会去掉 agent/ 层。不能仅拼 agentDir/sessions。dirs.ts 顶部“无 existence check”旧注释与实现不一致，以 DirResolver:385–403 的实际条件为准。[C7]
- `PI_CODING_AGENT_SESSION_DIR` / `--session-dir` 指定某次启动的 Session directory，不会变成“扫描所有自定义目录”的全局 registry。[C10]
- `listAllSessions(storage,sessionsRoot=getSessionsDir())` 只扫描该 root 下每个一级 project bucket 的 *.jsonl，不自动合并其他 profiles/agent overrides。bucket symlink 不跟随，leaf transcript symlink 可跟随，再按 realpath 去重。自定义 root 外文件有内部 custom-session-files 标记供 GC 等使用，但这里 listAllSessions 不读取该 registry；不能宣称全局列表覆盖所有曾打开的任意路径。[C11][C12]
- cwd bucket 名由 canonical location 及 home/tmp/absolute 分类编码，含旧版本路径迁移。真实 cwd 来自 Session header，不可把编码目录名反解当事实。按 cwd 的 picker 默认 worktreeScope:"repo"，可纳入同仓库其他 worktrees；directory scope 才只该 bucket；WebUI 分组不能无意把两个实际 cwd 合并。[C12][C13]
- `SessionManager.list/listAll/listForPicker/listAllForPicker`、`listRecentProjects` 等是 OMP 内部 TypeScript 表面；package 可导出源码不代表 Host 获准 import 内部 Session SDK。

**只读扩展不能直接包 picker。** 普通 `listSessions` 会 recoverOrphanedBackups；`computeDefaultSessionDir` 会迁移/建目录；picker full scan 会更新 history.db title index。已有 `sessionDirForCwd` 与 `listSessionsReadOnly` 避免前两类写入，应在 OMP server 内选择/组合只读实现，并显式报告不可访问范围，而非异常统一吞掉变“空目录”。[C11][C12][C14]

## 现有元数据的准确含义

`SessionInfo` 的确切字段是 `path,id,cwd,title?,parentSessionPath?,continuationOf?,created:Date,modified:Date,messageCount,assistantTurns?,size,firstMessage,allMessagesText,status?`。这些是内部类型，**并非现有 RPC 返回字段**。[C15]

| 信息 | 当前来源与限制 | catalog 候选保证 |
|---|---|---|
| id/path | header id 与当前枚举文件；path 不是永久 identity | 返回原生 id 与可验证 opaque ref；可展示 path，但不能用任意 browser path 直接 open |
| cwd | header.cwd；旧 Session 可为空 | 区分 recordedCwd、规范化 Workspace key；未知 cwd 单列，不能假装当前 worker cwd |
| title | header/title slot 或 short summary；展示可 fallback firstMessage/time | title 可空，display label 与原始 title 分开；不复制 prompt 文本到 Host 持久索引 |
| created / modified | header timestamp → Date；modified 是文件 mtime，不是最后 turn 时间 | wire 用验证过 ISO/epoch 或 null，给字段命名/语义；不把文件 mtime 称为 lastTurnAt |
| parentSessionPath / continuationOf | former 实现直接取 header.parentSession，后者取 continuationOf | parent 原值未必总是 path：有些分支/continuation 写 native id。新合同应显式 parent kind/id/ref，不能照类型名猜路径。[C16] |
| messageCount / assistantTurns / allMessagesText | 4 KiB prefix + 32 KiB tail，必要时 gap scan；messageCount 为窗口计数；assistantTurns 可只是存在性下限；搜索文本不是完整 transcript | 首版可省略；若暴露则标 estimate/preview，不承诺精确统计/全历史全文搜索。[C15] |
| status | `complete|interrupted|aborted|error|pending|unknown`，来自持久 tail；超大末条可能 unknown | 不能当活 worker 状态或 lease；lease 另行 probe，带观察时点 |
| listing order | modified desc→created desc→path；picker 额外 pin/empty 规则 | 固定稳定排序/tie-break，opaque cursor；不要把 index 初步行当最终 metadata |

picker 是两阶段：history.db indexed-title rows 先到，full scan 后到；初步行 cwd=""、messageCount=0、firstMessage/status 未知。它按 id 暂时去重，full scan 则 realpath 去重；原生 distinct copy 即便同 id 仍可能保留。WebUI 不能简单按 title 或 cwd 合并，也不能把 preliminary 数据持久化成“已验证目录”。[C14][C15]

全局扫描的 current implementation 不是数据库分页：每个候选要 stat，完整 listAll 要内容扫描全部；LRU 4096 以 mtime+size 缓存，>64 文件并行、最多16 workers。listRecentSessions 虽 limit 能减少内容扫描，仍先枚举/stat 全部。listRecentProjects 按 bucket 最新非空项的 cwd 建摘要，sessionCount 是桶内文件数且含空 stub；同 cwd 多 bucket 去重时不是跨桶总数。不能直接把其结果承诺为精确全局 Workspace 总计。[C17]

## 身份、导入注册与开始写入是三步

1. **发现**：server 只读返回当前授权 profile/root scope 的原生 descriptors；不改变当前 active Session、不 claim lease、不生成 title/摘要、不启动模型。
2. **注册**：Host 原子保存原生引用、scope、Workspace key、展示元数据/时间；幂等键至少含 source scope 与 native id，并处理同 id distinct copies。它不是创建 OMP Session，不能调用 new_session/fork/unpack 作为“导入”。不能把 OMP transcript、tree、credentials 存入 Index。
3. **打开写者**：另一个操作。确认原 owner 已退出；新 worker 用与 Session recorded cwd 匹配的授权 Workspace 启动，恢复后以 get_state 回读 sessionId/sessionFile。RPC switch 跨 cwd 无 onCwdChange 回调时可能拒绝，不能在任意 cwd 的 catalog worker 上顺便打开所有项目。[C9][C18]

**重要：当前 `switch_session` 不是安全的 validate-only API。** AgentSession 传给 SessionManager.setSessionFile；若目标缺失/空且未设 throwIfMissing，内部会新建并物化 requested path。公开 CLI `--resume <path>` 的分支有 throwIfMissing:true，可避免该具体误建，但仍是恢复进程，不是只读 catalog/注册 API。新 describe/ref 合同应显式拒绝 missing/replaced/identity mismatch，避免把 stale 索引误当新会话。[C9][C18]

Continuation 也不可盲目折叠：另一活进程迫使 writer 换 sibling 会生成新 id+continuationOf；resume 可沿链接选“持有被续接者最新 turn”的副本，双方后来均有独有 turn 时保留原目标；fork 从不设 continuationOf，因此不应被自动追随。目录应保留原生记录/关系，resolve/open 另报告最终 resolved id/ref，Host 显式更新 Index。[C16]

read-only discovery 不需 owner 退出。注册也不抢 owner。只有开始写入受当前“先退出再继续”政策限制；probe 存在 TOCTOU，持有者未知与失败要显式呈现。被占用时继续写产生 sibling 并不算成功接管原 Session。[C5][C16]

## 最小候选公共 server 合同（新增提案，不是已存在 API）

建议落点：OMP `src/modes/rpc/wire` command/result schemas → gen:rpc 输出 → rpc-types/command handler/client 兼容检查；实际扫描留在 OMP Session discovery 层。Host 只调用公共 protocol，不 import discovery 模块。

```ts
// 名称与结构均为提案，待上游/规格决定
list_session_catalog({ scopeId?, cwdKey?, cursor?, limit? })
  -> { scope, snapshotId, sessions: SessionDescriptor[], nextCursor?, warnings? }
describe_session({ sessionRef, expectedSessionId? })
  -> { descriptor, resolvedRef?, continuation?, leaseObservation? }
```

最小 SessionDescriptor：`sourceScopeId,sessionId,sessionRef,recordedCwd?,workspaceKey?,title?,createdAt?,modifiedAt?,parent?,continuationOf?`；时间为可验证 wire scalar 或 null。sourceScope 描述所用 profile/managed root/custom root，不能假装一个 worker自动覆盖全机器所有配置。若一个分页结果已带可验证 descriptor/ref，注册不必再新增“import” server mutation；describe 用于 stale/ref revalidation 与单个已有路径（仅受配置授权的根）入口。

必须定清的保证：只读且无当前会话切换；分页大小/响应字节上限；stable snapshot 或目录变化时 stale_cursor；exact cwd 与 repo-worktree scope 分离；realpath alias 去重与同 id distinct-copy 冲突；empty/titled-empty 是否包含的显式 filter；错误/partial scope warnings；continuation resolution 不静默替换选择；不暴露全历史搜索文本。缺失字段不编造。若需要 workspace-first 分页/总计，再加按真实 cwd 分组摘要；单页 sessions 聚合不能冒充全局所有 Workspaces。[C11][C14][C17]

current native read-only listAll 可作为 server 实现起点，但要补错误传播/identity/分页协议；包装后数组切片不代表扫描代价有界。可在 OMP 内建立可重建 metadata cache/snapshot，不能把成本转嫁为 Host 扫 session dirs。安全打开期望 identity 与原子 ownership 保证是相邻合同，本笔记不把它冒充 catalog 已解决的问题。

## 实际执行、未验证与结论用途

已执行：只读工作树 AGENTS/domain/CONTEXT/ADR/version lock；固定 SHA 读取 wire、RPC/slash dispatch/handlers、CLI entrypoints、dirs、SessionManager/Listing/Paths/Index；本地 schema 枚举和逐行源码对照。未访问用户配置/session 根、未做 runtime/native experiments、未实现或发布扩展。

最小后续实验：空 root 与已有 cwd 分组；profile/agent override/XDG/自定义 root 覆盖；旧 cwd 缺失/未知；leaf 与 bucket symlinks、duplicate ids/copies；continuation/fork；titled-empty/stub；标题/历史增长时分页失效；active owner 下只读发现/注册无副作用；stale/missing path 注册与打开不误建；十万级文件的冷/热扫描预算与 frame 限额。所有实验须在隔离 fixtures，而非用户真实 Session 上执行。

本研究提供扩展依据，不决定发现范围授权/筛选偏好。持久 Session Index 可满足 Host 重启后的已注册会话列表，但**不能替代原生 discovery，也不能自行恢复其从未注册的 TUI Sessions**。

## 固定证据

[C1]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/wire/rpc-wire.schema.json#L6-L827
[C2]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/slash-commands/builtin-lifecycle.ts#L424-L458
[C3]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/slash-commands/builtin-session.ts#L247-L306
[C4]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/main.ts#L2267-L2309
[C5]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/docs/rpc.md#L240-L245
[C6]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/commands/session.ts#L26-L105
[C7]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/utils/src/dirs.ts#L361-L435
[C8]: https://github.com/HowBoring/omp-webui/blob/ae368e5d4648652ad22e51b4ed2c1017ec6fc0ef/CONTEXT.md
[C9]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/docs/rpc.md#L381-L405
[C10]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/cli/args.ts#L247-L264
[C11]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-listing.ts#L651-L711
[C12]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-paths.ts#L207-L310
[C13]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-manager.ts#L4733-L4778
[C14]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-listing.ts#L755-L868
[C15]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-listing.ts#L19-L95
[C16]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-listing.ts#L1041-L1069
[C17]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-listing.ts#L1530-L1604
[C18]: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-manager.ts#L2421-L2452

补充定位：[scan metadata 赋值与窗口计数](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-listing.ts#L424-L542)；[scanBucketFiles/realpath 去重](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-listing.ts#L1397-L1462)；[custom-file marker](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/session-paths.ts#L421-L438)；[profile 根/优先级](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/utils/src/dirs.ts#L83-L134)；[getSessionsDir](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/utils/src/dirs.ts#L1025-L1028)；[config path 实际输出](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/cli/config-cli.ts#L441-L443)；[跨 cwd switch 的拒绝条件](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/agent-session.ts#L14191-L14207)；[CLI resume throwIfMissing](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/main.ts#L1324-L1347)；[RPC prompt builtin 路由](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L1940-L2009)；[ACP 无 text handle 返回 false](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/slash-commands/acp-builtins.ts#L58-L75)。
