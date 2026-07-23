# 桌面架构与安全模型

本文描述 Desktop 当前实现。正式发布前尚未落地的能力会明确标记为长期方案，不能
将其视为已经可用。

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
- `@` 只指向 `src/renderer`，`publicDir` 只指向 `client-desktop/public`。
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
