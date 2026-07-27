# Desktop Theme and Chat Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 统一桌面原生窗口与应用主题，优化服务器配置页，补齐聊天置顶/免打扰状态，并修复 macOS 菜单栏图标。

**Architecture:** Renderer 的 `ThemeProvider` 继续作为主题配置源，通过版本化 Desktop Bridge 通知 Main 更新 Electron 原生主题。聊天能力沿用桌面端独立的数据层，在 API、Provider、实时同步和 Sidebar 四层补齐免打扰，不直接引用 Web 源码。Tray 图标仅在 macOS 标记为 Template Image。

**Tech Stack:** Electron 43、React 19、TypeScript 6、Tailwind CSS 4、Vitest 4。

### Task 1: 原生主题同步契约

**Files:**
- Modify: `client-desktop/src/shared/bridge.ts`
- Modify: `client-desktop/src/preload/index.ts`
- Modify: `client-desktop/src/main/ipc.ts`
- Modify: `client-desktop/src/main/window-controller.ts`
- Modify: `client-desktop/src/renderer/components/theme-provider.tsx`
- Test: `client-desktop/tests/bridge.test.ts`
- Test: `client-desktop/src/renderer/components/theme-provider.test.tsx`

**Steps:**
1. 写失败测试，要求 Bridge 暴露 `appearance.setThemeSource`。
2. 运行定向测试确认因契约缺失而失败。
3. 增加严格枚举校验和 Main 原生主题更新。
4. 让 `ThemeProvider` 在主题或系统主题变化时同步 Main。
5. 运行定向测试确认通过。

### Task 2: macOS 菜单栏模板图标

**Files:**
- Modify: `client-desktop/src/main/system-integration.ts`
- Test: `client-desktop/src/main/system-integration.test.ts`

**Steps:**
1. 写失败测试，要求 macOS 图标标记为 Template Image。
2. 运行测试确认当前实现未调用 `setTemplateImage`。
3. 抽取最小图标准备函数并接入 `createTray`。
4. 运行测试确认 macOS 与其他平台行为正确。

### Task 3: 会话免打扰数据链路

**Files:**
- Modify: `client-desktop/src/renderer/lib/client-api/conversations.ts`
- Modify: `client-desktop/src/renderer/lib/client-api/types.ts`
- Modify: `client-desktop/src/renderer/lib/client-data-context.ts`
- Modify: `client-desktop/src/renderer/components/client-data-provider.tsx`
- Modify: `client-desktop/src/renderer/components/client-conversation-realtime-sync.tsx`
- Test: `client-desktop/src/renderer/lib/client-data-api.test.ts`

**Steps:**
1. 写失败测试覆盖开启/关闭免打扰和事件归一化。
2. 运行测试确认 API 与归一化函数缺失。
3. 实现请求、状态更新和实时事件订阅。
4. 更新测试中的 Context mock 契约。
5. 运行数据层定向测试确认通过。

### Task 4: Sidebar 操作与状态图标

**Files:**
- Modify: `client-desktop/src/renderer/components/conversation-list-item-menu.tsx`
- Modify: `client-desktop/src/renderer/components/conversation/conversation-sidebar.tsx`
- Modify: `client-desktop/src/renderer/pages/chat-page.tsx`
- Test: `client-desktop/src/renderer/components/conversation/conversation-sidebar.test.tsx`

**Steps:**
1. 写失败测试覆盖免打扰点击、置顶图标、免打扰图标和静音未读红点。
2. 运行测试确认当前菜单无回调且无状态图标。
3. 增加独立 busy 状态和错误 Toast。
4. 接入 ChatPage 的 Provider 方法。
5. 运行 Sidebar 测试确认通过。

### Task 5: 服务器配置页主题化改版

**Files:**
- Modify: `client-desktop/src/renderer/desktop-root.tsx`
- Modify: `client-desktop/src/renderer/styles.css`
- Test: `client-desktop/src/renderer/desktop-root.test.tsx`

**Steps:**
1. 写失败测试确认所有启动状态都位于 `ThemeProvider` 内并具备新版语义结构。
2. 运行测试确认当前未同步主题且旧结构仍存在。
3. 调整 Root 包裹层和配置页结构。
4. 用主题变量重写配置页样式并移除圆形伪元素。
5. 运行配置页测试确认通过。

### Task 6: 差异清单与完整验证

**Files:**
- Create: `client-desktop/docs/web-chat-parity.md`

**Steps:**
1. 记录本轮已对齐能力和剩余 Web 差异。
2. 运行相关 Vitest 测试。
3. 运行 `pnpm typecheck`、`pnpm lint`、`pnpm verify:boundaries`。
4. 运行 `pnpm build` 并检查构建结果。
