# 本机访问、目录授权与上传边界合同目标

Status: 用户已确认产品政策；认证、授权操作和运行验证待实现。

日期：2026-11-15。决策：[原生目录与历史导入的本地访问安全边界](https://github.com/HowBoring/omp-webui/issues/20)。
取舍见 [ADR 0006](adr/0006-persistent-local-browser-access.md)。

## 已确认政策

| 范围 | 决定 |
| --- | --- |
| 浏览器登录 | 同一 Host 数据目录及相同访问 origin 下保留 30 天，跨重启有效；到期重新登录，可退出当前浏览器或撤销全部浏览器授权 |
| 工作目录 | 已登录网页可显式授权规范化目录及其子目录；记录持久化且可撤销，普通浏览/打开不自动扩权 |
| 上传 | 只写 Host 配置的专用暂存区，浏览器不能指定磁盘目标或按文件名覆盖项目；通过验证的回执/附件身份消费 |

MVP 继续是 Linux/WSL2、loopback、单用户。这里不开放公网绑定、多用户、任意来源或代理信任。

## 三个不同边界

1. **登录**决定浏览器是否是当前可访问 Host 的 owner；不是一个 OMP Session。
2. **Session Source**决定 OMP 可以发现哪些原生会话，仍按[目录合同](session-catalog-contract.md)
   的当前配置/profile 与本地显式授权的自定义 Session 存储目录，不由网页工作目录授权扩大。
3. **工作目录授权**决定 Host 是否可为某个 cwd 打开/执行 OMP 会话及提供其受保护内容。
   这是 Host 入口控制，不是 OMP 工具可访问文件的操作系统沙箱。

发现的 cwd 未授权、未知或失效时仍可显示已授权来源的目录元数据与原因，不自动读取历史、
启动 worker 或接续执行。跨活 owner 的历史/树浏览仍后置，不因登录或授权目录而得到接管能力。

## 引导、持久凭据与撤销

- 首次登录用 Host 本地展示的随机引导链接。引导 token 只用于明确的根页面交换，不作为
  普通 RPC、上传、下载或 WebSocket 的 query/header 通行证；交换后跳转到干净地址。
- 浏览器凭据可跨 Host 重启，绝对有效期为 30 天；普通访问不默默延长为无限登录。
  更换 Host 数据目录、origin 或撤销/丢失凭据后需要重新引导，不承诺跨端口/主机名复用。
- Host 自己保存验证和撤销所需的私有材料；目录 owner-only、文件仅 owner 可读写并原子更新。
  不复用或复制 OMP provider 密钥，不把有效 token 写入普通日志、版本库或错误响应。
- Cookie 为 host-only、HttpOnly、SameSite=Strict，并绑定正确的 Host 实例/origin。
  Secure 只在实际 TLS listener 下设置；loopback HTTP 不能假装已经提供 TLS 保护。
- 当前浏览器退出须在服务端撤销凭据、清除 Cookie 并关闭其 Peer/流；仅清除前端状态不够。
  同一凭据的标签页一起失效，其他浏览器是否仍可用取决于其自己的有效凭据。
- 撤销全部须持久生效并拒绝旧 Cookie/Peer，轮换引导访问能力；可信本地控制面提供重新引导。
  不在通用 API 中返回能绕过撤销的新 secret。工作目录授权记录不因此被静默删除。
- 重启后的有效 Cookie 只恢复访问资格，不复活旧 worker、未完成提交或 UI 回答。DSH 新
  Connection generation 和 OMP worker generation 按各自合同重新建立。

固定 DSH 的认证已支持持久 signed Cookie；Bun Host 不会因此自动获得它的实现。具体凭据
编码/存储格式属于实现，必须满足撤销与测试要求，不能把原生默认当本项目已经通过。

## 所有入口的 admission

- 只监听配置的 loopback 地址；信任配置固定的 scheme/hostname/port，不接受任意 loopback
  端口、任意 Host、反射 CORS、伪造的 Forwarded/X-Forwarded-* 或浏览器提交的 authority。
- Host 规范化后仍须拒绝缺失、非法或带其他 URL 成分的 authority。Origin 存在时必须与
  当前实际 origin 一致，拒绝 null/非法/其他来源及 cross-site Fetch Metadata。
- 浏览器写操作与 WS upgrade 要求可验证的同源 Origin；不能因 Cookie 存在就绕过来源检查。
  只读 GET/HEAD 可能没有 Origin，但仍需要正确 Host、凭据、资源权限和只读语义。
- 引导链接的根页面交换独立处理：只接受正确本地 authority、有效 secret 和指定方法；
  不把它扩成普通 GET 写操作或让所有 API 使用 query token。
- JSON Remote、raw binary 上传、base64 fallback、历史/附件读取和 WS 都在读取大 body、
  解析敏感参数、对象查找、落盘或启动进程前完成 admission。WS 每个逻辑 open 另校验资源。
- 凭据到期/撤销或授权变化后，不沿用旧 Peer 的缓存权限继续发新请求、流或回答 UI。
- 公开静态构建资产和最小 health 可不带凭据；它们不得包含会话、Host home、目录、secret
  或用户运行状态。动态页面/boot 数据按其内容保护，不能用 SPA fallback 吞掉未知 API。

认证失败用可识别 HTTP/Remote 失败，来源不可信和资源拒绝分开表达，但不在未授权响应泄露
文件是否存在、secret 或底层内容。具体新增 endpoint/code 名称尚未实现，本文不虚构现成 API。

## 网页目录授权和路径身份

- 提供明确的 owner 目录授权操作，输入/选择目录后由服务端验证其存在、可用和规范路径，
  显示真实授权目标与包含子目录的范围，再由用户显式授予；不得把普通 open/create 当授权。
- 该操作只授予工作目录范围，不授予任意 executable、argv、环境、Session 存储源或文件读写
  API；不因此创建真实目录或 Session。新目录、撤销、持久化均走同样的来源/身份/CSRF 边界。
- 执行/历史/附件入口重新核对当前目录授权与来源/Session/对象身份。按路径段比较规范化
  结果，不能用字符串前缀让 project-other 匹配 project，也不能把 symlink 越界当原授权。
- Host 可以验证工作目录和自有暂存区；OMP Session 文件的解析、引用校验与去重仍通过 RPC，
  不因路径授权就直接扫描/读取/修改 native Session 文件。
- 目录消失、移动或 symlink 目标变化时重新验证，不回退到当前 cwd。新 profile/存储源
  不能通过名字相似或先前的旧授权自动获得权限。
- 撤销目录立即拒绝新入站操作/订阅，相关 Host-owned worker 进入停止处理并显示真实状态；
  按[交互生命周期合同](interaction-lifecycle-contract.md)取消 UI/工作并有界关闭。不能在仍执行时声称已停止，
  也不能回滚已经发生的副作用或终止未知外部 TUI。
- 单凭据退出/到期只移除其页面与回答资格，执行与其他有效凭据继续。全撤销停止全部
  Host-owned worker；目录撤权停止实际失去有效授权的 worker。后两种情况采用 30 秒协作/
  排空加 5 秒终止宽限后必要强制回收；普通断线不触发此安全关闭流程。

## 暂存和附件权限

- 暂存目录由 Host 配置，使用私有目录权限、受控对象名和创建/写入方式；浏览器文件名只作
  展示元数据，不是目标路径，不能用 traversal、绝对路径、symlink 或重复名称覆盖项目。
- 授权 owner、目标 Session/工作目录、receipt/object 归属与当前授权分别验证。可猜的 hash、
  公开 attachment ID 或 basename 都不能单独作为读取/下载权限。
- 普通文件交给 OMP 的路径引用由受控映射和原生语法构造，不直接拼接浏览器路径或内容；
  图片/base64 也必须满足协议与 admission 限额。Host URI 文本接口不是任意二进制上传捷径。
- 未受信 HTML/SVG/脚本不得成为同源可执行页面；预览/下载的 MIME、Disposition 和 renderer
  边界需验证。模型/工具/历史内容、名称和链接始终按不可信数据呈现，不自动执行外部动作。
- 原始 byte 生命周期、格式、限额、清理、重启及历史读取由
  [图片与文件输入：格式范围、RPC 链路与存储边界](https://github.com/HowBoring/omp-webui/issues/28)决定。
  本政策不批准永久 Host 附件库、任意文件浏览或直接保存到项目的额外操作。

## 资源、日志与执行边界

- 对普通 RPC body、streaming upload、附件总量、并发、连接/逻辑流、输出队列、缓存和 worker
  分别设置显式预算；鉴权前不落盘，失败/取消有界清理。不能照搬上游大 body 默认值当已验证预算。
- Base64 膨胀、OMP stdin unchunked 物理上限及 v2 stdout 重组上限都纳入附件/传输实验；
  大 HTTP 请求被接受不代表能发给 OMP。限额数值在对应实验/实施规格冻结前不宣称可用。
- 默认只记录必要的请求/worker ID、类型、时长、字节数与结构化失败码；不记 Cookie/token、
  完整 query、prompt、transcript、文件内容、provider 密钥或原始 stderr。诊断也要有界脱敏。
- Browser 无原始 RPC、shell、任意 argv/env/executable 通道。OMP 工具和扩展仍按自身配置、
  当前操作系统权限及原生审批运行；本机同权限恶意进程与已执行副作用不在 Host admission 的隔离保证内。
- 拒绝新请求或断开浏览器，不等于自动 replay、同意 UI 或立即撤销正在执行的工具。
  [交互生命周期合同](interaction-lifecycle-contract.md)记录已确认的关联、取消、停止和未知结果语义。

## 必需验证

1. 真实浏览器根交换/干净重定向、Cookie flags、30 天到期、跨重启、origin/data-dir 变化、退出和全撤销。
2. 无 Cookie、坏 Host、错端口/Origin、null/缺 Origin 写入、cross-site、伪 Forwarded、CSRF、WS upgrade/逻辑流。
3. 未授权目录仍可见元数据但不可打开；网页显式授权/撤销、子目录、前缀混淆、symlink、失效/未知 cwd。
4. raw/base64 上传均鉴权；目录/receipt/object 交叉引用、恶意名称、越界、超额、取消和不覆盖项目文件。
5. 撤销时的旧请求/Peer/回答、运行中 worker 状态、输出停止与有界清理；不误报已停止或重新授权。
6. 未信任渲染与下载、日志敏感字段缺席、静态/health 不泄露私有数据，真实 DSH 兼容与有效正向路径。

本次只有政策与源码对照，没有实现或执行上述安全测试。未通过前不接入真实私有会话 API。

## 固定来源

- [DSH 浏览器认证、Cookie 与请求信任](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/connection/README.md#browser-authentication-and-request-trust)
- [DSH request trust 实现](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/connection/src/api-request-trust.ts)
- [DSH Cookie 实现](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/connection/src/browser-auth.ts)

上游没有现成本项目的目录 grant 或 logout/revoke 合同；Bun Host 必须实现并验证这些新增要求。
