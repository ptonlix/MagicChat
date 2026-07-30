# 桌面架构与安全模型

本文描述 Desktop 当前实现。正式发布前尚未落地的能力会明确标记为长期方案，不能
将其视为已经可用。

Stable OTA 校验 HTTPS、Stable SemVer、平台、架构、清单、文件大小和 SHA-512。
Renderer 只接收 Main 归一化后的更新状态和纯文本发布说明，不接收构建签名状态、
GitHub Token、完整更新 URL、Header 或本地缓存路径；手动下载地址由 Main 根据固定仓库
`ptonlix/MagicChat` 生成。

## 进程与代码边界

```text
独立 React Renderer
        │ DesktopBridge v1
        ▼
      Preload
        │ 白名单 IPC
        ▼
 Electron Main ── HTTP/WebSocket ── MagicChat Server
        │
        └── 文件、通知、权限、剪贴板、更新和系统窗口
```

- `src/main` 持有 Server Profile、Electron Session、Cookie、HTTP、WebSocket、
  文件、通知、更新、深链接和安全存储。
- `src/preload` 只暴露 `DesktopBridge v1`，不向 Renderer 提供 `ipcRenderer`、Node
  或 Electron 对象。
- `src/renderer` 是本地打包的独立 React 应用，启用 context isolation、sandbox
  和 webSecurity，不读取 `client-web` 的源码或资源。
- `src/shared` 只存放进程间契约，不承载页面或平台业务实现。

生产 Renderer 从 `magicchat-app://app/` 加载。主窗口拒绝远程导航和任意新窗口，
外部 HTTPS 链接必须通过 Bridge 交给系统浏览器。CSP 禁止远程脚本、对象、Frame
和 Renderer 直接发起任意网络连接。

## Renderer 独立策略

Desktop 首轮功能以 `client-web` 提交
`e1998bd852ad9bc7feff11355ed47b7889cb7887` 为一次性冻结来源。完成迁移后：

- Web 与 Desktop 的页面、交互和平台能力分别演进，禁止用 Web 目录整体覆盖 Desktop。
- `@/*` 指向 `src/renderer`，`@main/*`、`@preload/*`、`@shared/*` 分别对应
  Electron 三层及其跨进程契约；跨层导入不得使用 `../` 穿越目录。
- `publicDir` 只指向 `client-desktop/public`。
- `pnpm verify:boundaries` 禁止 Web 内部路径和 `client-core` 运行时依赖。
- 暂不建立公共运行时包。纯 DTO、协议归一化或消息转换只有在至少两次跨端一致修改、
  且不依赖 DOM/Electron 后，才另行评估抽取。

当前 UI 只允许用户填写和使用一个 Server，不提供多服务器切换。底层 Profile 和
Session 仍使用 Server ID 隔离，以保证移除服务器时可以定向清理 Cookie、连接、
缓存、临时文件和凭据。

## 网络与会话

每个 Server ID 使用独立的 `persist:magicchat-server-<id>` Session partition。
Main 只接受已保存的 Server 以及相对 `/api/client/` 路径，并限制请求方法、Header、
超时和响应大小。Cookie 和认证材料不返回 Renderer。

受认证头像、消息图片和音频通过 `magicchat-media://` 读取。Main 使用对应 Server
Session 请求资源并过滤响应 Header；Renderer 不拼接认证 Header，也不能读取 Cookie。
HTTP、WebSocket、文件、通知、权限、剪贴板、更新和外链都通过窄类型 Bridge，参数
在 Main 再次校验。

Updater 资格由 Main 根据打包状态、Stable 通道、平台、架构和可信安装来源决定：Windows
NSIS、macOS 打包应用和 Linux AppImage 可以进入 OTA；Linux deb、开发运行和 test 通道
只进入手动升级；未知平台或架构进入不支持状态。更新检查和下载采用单飞 Promise，远端
发布说明会移除 HTML、控制字符和 URL，并限制长度。安装前必须确认更新已下载且不存在
活跃文件传输，再由 Main 协调资源清理和一次性退出安装意图。

开发环境仅允许 localhost HTTP；打包应用只接受 HTTPS/WSS 和系统信任链。目前不支持
忽略证书错误、应用内导入私有 CA 或 mTLS。网络使用 Electron/Chromium 系统代理，
代理凭据不得写入普通配置。

## 第三方认证

当前 POC 使用受限的内嵌 `BrowserWindow`：

```text
Renderer 请求登录
  -> Main 使用当前 Server 的持久 Session 打开认证窗口
  -> 调用现有 /api/client/auth/third-party/:key/start?redirect=/init
  -> 返回 /init 后通过 /api/client/me 验证会话
  -> 关闭认证窗口并通知 Renderer
```

当前流程不调用 Desktop transaction、callback 和 exchange 三个 handoff 接口。
认证窗口只允许 HTTPS 以及开发环境的 localhost HTTP 导航，禁止下载和新建窗口，
并与普通 Renderer 保持进程和权限隔离。

长期正式方案仍是“系统浏览器 + Desktop handoff”：Server 使用 state/PKCE，完成认证
后生成短时单次 code，通过 `magicchat://auth/callback` 交给 Main 兑换 HttpOnly Cookie。
该方案启用前必须完成服务端接口、深链接校验和三平台协议注册验收。

## 本地数据与诊断

POC 不启用远程崩溃遥测，`crashReporter.uploadToServer=false`，也不接入 Sentry、远程
日志或行为分析。诊断只能由用户主动导出，使用字段白名单，不包含 Server 地址、
身份、消息、文件路径、完整 URL、Header、Cookie、Token 或原始 dump。

消息缓存位于 Electron `userData/message-cache/messages-v1.sqlite3`，由 Main 管理的专用
Worker 使用 Node.js 内置 `node:sqlite` 独占访问。Renderer 只能通过版本化的
`DesktopBridge.messageCache` 执行有界分页、事务提交、状态查询和定向清理，不能获得
数据库路径、SQL、Worker 或 Node.js 能力。数据库使用 WAL 和从首版建立的连续
`user_version` 迁移注册表，
按 Server/用户/会话隔离和 generation 防迟到写入；POSIX 目录与文件权限分别限制为
`0700`、`0600`，Windows 依赖当前用户的 `userData` ACL。

空数据库与旧版本数据库使用同一条逐级迁移路径。迁移注册表必须从版本 1 连续登记到当前
支持版本；重复、缺失、乱序或目标版本未登记会在修改数据库前失败。所有待执行迁移、逐级
`user_version` 更新和 payload schema 校准位于同一个独占事务中，失败时整体回滚；已经发布
的旧迁移不得改写，只能追加更高版本。

数据库无法打开、schema 过高或迁移失败时，Worker 会先关闭失败连接，按 WAL、SHM、
主数据库的顺序临时改名，为同一路径的新库让位；任一步失败都会逆序恢复本轮已移动文件。
临时隔离文件不作为恢复源、诊断产物或备份：
新库完成 schema 初始化和权限设置后立即删除；Worker 每次启动及会话、用户、Server、
孤立 Server 和全量消息缓存清理时也会清扫旧版本或异常中断遗留文件。清扫只匹配固定
数据库 basename 和纯数字时间戳，不能访问任意路径或误删其他业务文件。恢复成功后若
仍无法删除临时文件，缓存进入内存降级，不得在保留明文副本时报告可用。

历史缓存页同时携带完整性状态。Main 删除无法解析的记录或 Renderer 拒绝核心结构不一致的
记录后，可以保留同页其他有效消息用于展示，但该页不能作为完整缓存命中，必须从原始
`beforeSeq` 回源 Server 补齐，避免损坏记录形成永久历史缺口。

与 Mobile 普通 `expo-sqlite` 缓存一致，消息 SQLite 不使用 SQLCipher 或应用级静态加密，
正文在本机以明文数据库形式存在。其保护边界是操作系统账户、应用数据目录权限和系统磁盘
加密。日志、崩溃记录与诊断导出不得包含消息 payload、身份 ID、Server URL、数据库路径、
SQL 参数或原始 SQLite 错误；设置页只展示近似逻辑占用、稳定状态和定向清理操作。

该缓存只保存规范化消息 JSON 与附件引用，不保存图片、语音、文件二进制。它也不提供完整
冷启动离线工作区：当前用户、联系人、会话摘要和项目 bootstrap 仍依赖 Server；完全离线
启动继续进入现有失败与重试流程。用户清理消息缓存不会删除服务端消息、认证、草稿、主题、
设置、下载或附件资源。

## 跨端变更规则

修改以下内容时，必须分别核对 Server、Web、Desktop 和 Mobile，并记录哪些端已修改、
不受影响或尚未实现：

1. API 路径、字段、状态码、错误码和分页语义。
2. 登录、Cookie、第三方认证、注销、深链接和会话失效。
3. 角色、权限、资源归属和客户端可见性。
4. 实时协议、事件、游标、重连和 `system.ready`。
5. 文件、资源 URL、外链、重定向和不可信内容过滤。

安全和协议必须保持一致，页面布局、组件结构及平台交互可以独立实现。消息分区变更
仍需同时核对 `server/internal/store/message_partitions.go` 和
`server/docs/message-partitions.md`。
