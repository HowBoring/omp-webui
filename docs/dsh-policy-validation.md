# DSH 公开导航与动作策略的隔离验证

Status: 前置实验通过；产品 Host、原生 OMP 与最终客户端组合仍待集成。
日期：2026-11-16（Asia/Singapore）。对应[DSH 导航与能力接缝：自动创建及动作门禁实证](https://github.com/HowBoring/omp-webui/issues/27)。

## 固定证据

- [实验说明与公开接口](https://github.com/HowBoring/omp-webui/blob/83efd4cf31d2afd7e3d9a551519743b59f65e171/experiments/dsh-policy-seam/README.md)
- [完整 manifest 与文件清单](https://github.com/HowBoring/omp-webui/blob/83efd4cf31d2afd7e3d9a551519743b59f65e171/experiments/dsh-policy-seam/manifest.json)、[SHA256SUMS](https://github.com/HowBoring/omp-webui/blob/83efd4cf31d2afd7e3d9a551519743b59f65e171/experiments/dsh-policy-seam/SHA256SUMS)
- [可审计 patch](https://github.com/HowBoring/omp-webui/blob/83efd4cf31d2afd7e3d9a551519743b59f65e171/experiments/dsh-policy-seam/dsh-public-client-policy.patch)、[独立双轴审查](https://github.com/HowBoring/omp-webui/blob/83efd4cf31d2afd7e3d9a551519743b59f65e171/experiments/dsh-policy-seam/review.md)

DSH 官方基线仍为 `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`。补丁 SHA-256 为
`d70bfb244979edd3dbc3732f5b19d219923e1abe854901964d2def00de8177d4`；应用到独立原始基线后，
Git tree 与验证源码一致：`be590b5411230c215158bb6359635d409a653523`。
本次本地候选构建提交为 `87f58a4730996725a9ae00df7ed075c22b3e77cf`，它不是官方上游提交。
实验分支仅保存补丁、fixture、摘要和证据，不保存 DSH 源码树或生成 bundle，也不合并进产品运行时。

## 已证实的公共扩展

- 公开 `WebBootEntry.config` 将配置交给真实 Cordis Loader；配置变更须刷新页面，不能依靠图中的 `inject` 保证插件挂载顺序。
- 外部 Workspace 导航等待公开 `workspaceNavigation` 服务，分别提交恢复、工作区选择和显式新建意图。缺少提供者不回退到自动创建；较早的显式操作不会被后到的启动恢复覆盖。
- Session 与 Workspace Controller 在各自执行入口检查不可用动作；菜单、行操作、双击与快捷键据此呈现，真实 owner 权限保持独立。
- 忙时 prompt、steer 和排队消息 steer 被拒绝；草稿保留且可编辑，停止与空闲发送可用。失败提供结构化标识和本地化提示。
- 公开根 Slot 与 Connection/Gateway 可承载尚未获取 Session 身份时的 fixture 启动交互，不需要伪造可用 Session。

## 实证结果与边界

原版与补丁版使用相同的合成数据和 owner baseline。原版启动隐式创建、忙时入队及重命名入口可触发；
补丁版首开、失效选择刷新和工作区选择没有创建，显式打开读取现有历史，显式新建仅创建一次且不自动发送。
两个浏览器报告均通过，无 page/console error；97 个客户端测试文件、2,306 项测试通过，
构建 8 项及聚合检查 2 项通过，lint、类型文档、翻译配对和 UI 文案检查通过。双轴审查无遗留实质问题。

构建含 371 项客户端资产；实验装载原候选 28 插件及两个 fixture 插件，总计 30 个，不能视为最终产品 roster。
未运行 DSH Agent Host、模型、真实 OMP、用户配置或原生历史，也未运行上游完整发布 CI。

快捷键证据来自 Linux Chromium 中明确模拟的 Win32 Web profile、公开快捷键偏好和 Playwright 键盘投递。
固定上游 Linux Web 没有这些 Workspace 默认键位，且仅允许三组有限组合；后续[验收交接](mvp-acceptance-and-handoff.md)已选 Linux Chromium＋Windows Chrome/WSL2，真实平台键位仍须补齐并验证。本实验不能宣称已通过 Linux 快捷键或 Windows 硬件测试。
两页面测试覆盖首个答复及后续旧答复拒绝，不是同时竞争回答的压力测试。根交互、目录授权和登记均是 fixture，
不代表完整 Broker、持久授权或原生 RPC 准入。`probe/*` 仅为实验端点，不是产品 Remote/RPC 契约。

## 产品实施门禁

保持 [client composition](client-composition.md)、[交互生命周期](interaction-lifecycle-contract.md)和
[RPC 交付](rpc-delivery-contract.md)的既有约束：真实 Host 必须独立执行鉴权、能力与 busy 准入，
实现实际 RPC 扩展、身份回读、队列撤回和静止确认。附件、树与历史投影、原生接续、全局 OMP 兼容组合、
持久目录权限、同时回答竞争，以及最终 roster/资产分发仍需实际验证。此次通过不改变上游生产锁或 M0 的真实闭环退出条件。
