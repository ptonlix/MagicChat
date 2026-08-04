# Desktop 文档与 Web V1 对照清单

更新日期：2026-08-04

行为基线：`afe07790dca767b3578510b70bf209e0fc392da6`。

## 协议与模块映射

- 文档列表与 CRUD：Web `client-web/src/lib/document-data-api.ts` 对应 Desktop
  `src/renderer/lib/document-data-api.ts`，两端使用相同 `/api/client/*` 相对路径、
  snake_case 请求字段和 camelCase 严格模型；Desktop 请求经受控 fetch transport。
- 项目文档树：Web `project-documents-tab.tsx` 对应 Desktop 项目文档组件与
  `document-tree.ts`；两端均支持创建、重命名、级联删除、当前项目过滤和拖动排序。
- 文档路由：Web 新标签页行为在 Desktop 保留为单窗口全屏路由
  `/documents/document/:documentId`，文档运行时按路由懒加载。
- 正文协作：两端正文均绑定 `Y.XmlFragment("body")` 并使用 Hocuspocus 协议；Web
  直接使用浏览器 WebSocket，Desktop 通过窄化二进制 Bridge 由 Main 持有 Cookie、Origin、
  系统代理和 TLS。
- 标题协作：两端使用 `/api/client/document/collaboration/:documentId/title`；Desktop
  额外观察 `Y.Text("title")`，并在本地 dirty 时保护输入，避免远端更新回声 PATCH。
- 富文本：两端对齐标题一至三级、段落、粗体、斜体、下划线、删除线、颜色、链接、
  无序/有序/待办列表、引用、代码块、四种对齐、撤销/重做和块操作。

## Desktop 保留差异

- 单窗口导航，不使用浏览器新标签页；标题或正文未同步时统一确认离开。
- 顶部保留 40px 原生窗口拖拽安全区，所有可交互区域使用 `no-drag`。
- 文档链接继续服从 Desktop 外链策略：HTTPS 交给系统浏览器，HTTP 二次确认，非法协议拒绝。
- Renderer 不直接联网、不读取 Cookie，也不能指定 WebSocket URL、Header、Origin 或代理。

## 明确未实现范围

分享、导出、文档信息、版本历史、评论、全局文档搜索、Markdown、文件、脑图、表格、
多窗口文档和 document-server 多实例广播不属于当前 V1。

## 验收用例

- API：响应 DTO、错误 envelope、取消、URL 编码、创建/更新/移动/级联删除。
- 树：排序、孤儿、重复 ID、循环、非目录父节点、64 层限制、Unicode 过滤和祖先保留。
- UI：加载/空/错误/重试、创建、重命名、删除、拖动、刷新和窄窗口导航。
- 协作：二进制帧限制、队列背压、owner/Target 隔离、重连、权限撤销和完整生命周期清理。
- 编辑：双客户端正文合并、远端标题、本地冲突、格式命令、块操作、链接安全和离开保护。
- 构建：文档依赖位于懒加载 chunk，CSP 不增加远程 `connect-src`，Renderer 边界检查通过。
