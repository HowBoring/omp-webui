# #41 Native 消费端——仅源码准备

[English](./ticket-41-native-consumers.md)

本独立消费端增量基于 Host `df21a34570f35f919d395eadafa55b14e4de970f`，以及稳定补丁 1–6 加该归属检查点的
Native tree `a2d6f32d2978d31be1c859d6c3c2183dc50b379a`。不覆盖负责人累计 `0010`，不改变活动补丁列表，
不声称最终 1–10 已组合，不开放私有或全局准入。之后合并 Host 检查点不会改变该增量声明的 Native 基础。

[增量补丁](../../compatibility/omp/0010-execution-ownership-consumers.delta.patch) 包含 16 个 Native 源码文件、
上游包 README/CHANGELOG 和中英消费端文档。[清单](../../compatibility/omp/execution-ownership-consumers.preparation.json)
记录准确路径、文件 hash、已读取上游 AGENTS 的身份及源码/证据身份。
结果 tree 为 `9052be8a474f01bbeca8ff2e3b568bdbb6e3a5a8`。

项目/全局 broker 客户端不再创建 token/运行文件，也不在连接/重连时派生 broker。构造前取得公开分发器授权；
缓存客户端、请求、取消、完成确认重新验证。授权改变即关闭客户端并抛出类型化错误。子端点、服务日志、Chromium
配置及持久 target 登记使用分发器目录。broker smoke 改为探测独立 broker，不声称验证客户端自行启动。
CLI/ps 元信息、broker 发布、transport/backend 和 worker realm 引导仍属负责人源码范围。

SDK 与旧版工厂第一步初始化归属，先于推理注册和资源重载。命名共享服务、浏览器/relay/健康替换、IDA、文字预测
在共享效果前拒绝；预测先于旧 daemon 关闭和 SmolLM 预取拒绝。已注册私有 LSP 绕过自动 lspmux/共享 transport；
已注册私有 blob 在共享工厂前选择已有本地 backend。不可用状态不选择任一回退。普通 bash、后台任务、父进程子代理、
Source7 与 AgentCore 均未修改。

| 检查 | 实际结果 |
| --- | --- |
| 现有公开归属决策/协议/自有文件系统测试 | 21 PASS，1 kernel SKIP，0 FAIL，76 断言；18 文件类型检查通过 |
| 隔离 | 导入前预加载出站防护；合成 HOME/profile/cwd/XDG 和白名单环境；未启用 kernel 夹具 |
| 消费端源码身份/应用 | 20 个准确文件 hash；私有 index 应用增量等于声明 tree |
| 消费端语法编译 | 转译 16 个 TypeScript 文件；未导入 Native 模块 |
| Host 脚本类型检查 | PASS，56 文件 |
| 同文件/依赖拓扑的完整 SDK 源码类型对照 | 基础与候选均 FAIL，完全相同的 77 条诊断；新增/消失/修改文件诊断均为零 |
| 消费端运行时红绿、SDK/CLI/worker/model/provider/browser/service/LSP/附件 | NOT RUN |
| 实际全局安装、生命周期能力、私有准入 | BLOCKED |

在本自有 worktree 执行：

```sh
bun --no-env-file scripts/check-ownership-preparation.ts vendor/omp-consumers
bun --no-env-file scripts/check-ownership-consumer-preparation.ts vendor/omp-consumers
bun --no-env-file check --no-script -p tsconfig.scripts.json
```

编译对照使用自有临时 config，仅列入 16 个修改源码文件，并将 Native 公开自身导入映射至本源码；不导入运行模块。
先编译候选，暂时从准确基础恢复这些文件并再次编译，再精确恢复并校验候选。共同 77 条诊断包括缺失生成 RPC 契约及
基础 ambient const-enum/依赖错误，不能称为完整 SDK 编译通过。自有依赖符号链接经 ticket-36 最终指向既有 ticket-30
runtime cache，TypeScript 6.0.3；未安装或修改依赖。

先前约定的公开 Native 归属/RPC 与真实浏览器/Host 接缝继续适用；未以源码文字断言或伪造运行成功代替消费端行为测试。
运行时 TDD 须等待协调者安全放行和认证分发器/backend。旧测试自行启动 broker 或构造旧浏览器 scope，须迁移至新公开夹具。

仍须证明嵌套普通 `env -i` 拒绝、缺失/旧分发器、SDK 首效果拒绝、外部 TUI/服务保留、私有 LSP、全部图片/文字/文档
格式和预算、真实工具失败/取消/后台/子代理、崩溃/fence 与进程灭绝。未发进程信号、读取私有 profile、恢复孤儿或改变
fence。当前 Linux；真实 Windows Chrome/WSL2 已由所有者延期。本准备不是 OS 沙箱或外部效果回滚保证。
