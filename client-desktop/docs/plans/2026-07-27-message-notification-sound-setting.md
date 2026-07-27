# 新消息提示音开关 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在桌面端设置中增加“新消息提示音”开关，默认开启，关闭后普通新消息不再播放声音，同时不影响系统通知、未读数和会话免打扰逻辑。

**Architecture:** 在现有 `DesktopSettings` 中新增设备级布尔配置 `messageSoundEnabled`，由 Main 进程的 `ConfigStore` 持久化。Renderer 根节点统一持有最新设置，设置面板修改后立即更新 Host 注入能力；消息通知同步组件通过 Host 查询开关，仅决定是否播放声音，不改变后续桌面通知流程。浏览器或未注入 Host 的运行环境继续默认播放，保持当前行为。

**Tech Stack:** Electron 43、React 19、TypeScript 6、Vitest 4、现有 Desktop Bridge 与 `desktop-config.json`。

## 方案选择

**推荐：Renderer 设置状态 + Host 同步读取。** 设置保存后立即生效，不需要每条新消息调用一次 IPC，也不会把 Electron Bridge 直接耦合到通用消息组件。

- 备选 A：收到每条消息时调用 `window.desktop.settings.get()`。实现直接，但引入异步竞态和不必要 IPC，且消息播放时序会变慢。
- 备选 B：在声音工具中保存模块级开关。改动少，但会形成第二份设置状态，设置面板、持久化数据和运行时状态容易失同步。
- 本方案：`DesktopRootContent`/`DesktopWorkspace` 持有唯一 Renderer 设置快照，Host 暴露只读判断函数，消息链路同步判断。

## 产品规则

- 新安装和旧版本升级后默认开启，避免升级后用户突然收不到声音反馈。
- 开关是当前设备级设置，不跟随账号或服务器同步。
- 关闭提示音只抑制声音；系统通知、托盘未读、角标和页面内提醒保持原逻辑。
- 会话免打扰、服务端 `notification_muted`、自己发送的消息和系统消息仍优先拦截声音及通知。
- 开关修改后无需重启，下一条符合条件的新消息立即使用最新值。
- 设置项放在“通知与隐私”区域，名称为“新消息提示音”，说明为“收到普通新消息时播放提示音”。

### Task 1: 扩展桌面设置契约与迁移

**Files:**

- Modify: `client-desktop/src/shared/bridge.ts:69`
- Modify: `client-desktop/src/main/config-store.ts:20`
- Test: `client-desktop/tests/config-store.test.ts:14`

**Steps:**

1. 在配置迁移测试中断言旧配置加载后得到 `messageSoundEnabled: true`。
2. 增加测试：调用 `setSettings({ messageSoundEnabled: false })` 后重新加载仍为 `false`。
3. 运行 `pnpm vitest run tests/config-store.test.ts`，确认新增断言先失败。
4. 在 `DesktopSettings` 增加必填布尔字段 `messageSoundEnabled`。
5. 在 `defaultSettings` 中设置 `messageSoundEnabled: true`，沿用现有浅合并迁移补齐旧配置，不提升 schema 版本。
6. 在 `ConfigStore.setSettings` 校验该字段必须为布尔值，拒绝损坏或越界输入。
7. 再次运行定向测试，期望全部通过。

### Task 2: 放行并校验设置 IPC

**Files:**

- Create: `client-desktop/src/main/settings-validation.ts`
- Modify: `client-desktop/src/main/ipc.ts:299`
- Create: `client-desktop/src/main/settings-validation.test.ts`

**Steps:**

1. 为纯函数 `parseDesktopSettingsPatch` 写失败测试，覆盖允许字段、未知字段和非布尔提示音值。
2. 运行 `pnpm vitest run src/main/settings-validation.test.ts`，确认校验模块尚不存在。
3. 从 `ipc.ts` 抽出当前 `settingsPatch` 为 `settings-validation.ts`，并将 `messageSoundEnabled` 加入允许字段。
4. 在 IPC 边界对 `autoLaunch` 和 `messageSoundEnabled` 做显式布尔校验，避免只依赖 TypeScript 类型。
5. 让 `IPC.settingsSet` 使用新校验函数，删除 `ipc.ts` 内部旧 helper。
6. 运行定向校验测试，期望合法布尔值通过、未知字段和非法值失败。

### Task 3: 让桌面根节点统一持有设置

**Files:**

- Modify: `client-desktop/src/renderer/desktop-root.tsx:48`
- Test: `client-desktop/src/renderer/desktop-root.test.tsx:52`

**Steps:**

1. 更新桌面根节点测试 mock，为默认设置补充 `messageSoundEnabled: true`。
2. 增加失败测试：打开设置后显示已开启的“新消息提示音”复选框。
3. 增加失败测试：点击关闭时调用 `window.desktop.settings.set({ messageSoundEnabled: false })`，并以返回的新设置刷新 UI。
4. 将启动阶段已读取的 `DesktopSettings` 保存到 `DesktopRootContent` 状态，而不只提取 `selectedServerId`。
5. 将设置与更新回调传给 `DesktopWorkspace`、`DesktopHostedApp` 和 `DesktopSettingsPanel`，删除面板内部重复的 `settings.get()`。
6. 在“通知与隐私”区域增加复选开关，保存期间沿用现有自动保存行为；失败时保留原值并显示可理解错误，避免 UI 假成功。
7. 运行 `pnpm vitest run src/renderer/desktop-root.test.tsx`，确认展示、关闭、重新开启和失败回滚行为通过。

### Task 4: 通过 Host 暴露提示音偏好

**Files:**

- Modify: `client-desktop/src/renderer/lib/desktop-host.ts:3`
- Modify: `client-desktop/src/renderer/desktop-root.tsx:136`
- Create: `client-desktop/src/renderer/lib/desktop-host.test.ts`

**Steps:**

1. 增加 Host 单元测试，覆盖未配置 Host 时返回默认允许、配置后返回当前设置、restore 后恢复默认。
2. 在 `DesktopRendererHost` 增加 `messageNotificationSoundEnabled?: () => boolean`。
3. 导出 `isHostMessageNotificationSoundEnabled()`；Host 未提供该能力时返回 `true`，保证浏览器与旧测试兼容。
4. `DesktopHostedApp` 从根节点接收 `messageSoundEnabled`，在 `configureDesktopHost` 中注入同步 getter。
5. 将该值加入 Host 配置 effect 依赖，设置变化后重新注入最新 getter，不重载应用。
6. 运行 Host 和桌面根节点定向测试，确认开关即时传播。

### Task 5: 在新消息链路应用开关

**Files:**

- Modify: `client-desktop/src/renderer/components/client-message-notification-sync.tsx:30`
- Test: `client-desktop/src/renderer/components/client-message-notification-sync.test.tsx:61`

**Steps:**

1. 扩展 Host mock，默认返回 `true`。
2. 增加失败测试：开关关闭时普通消息不播放声音，但仍调用 `showHostMessageNotification`。
3. 保留现有测试，确保事件静音和会话免打扰继续同时抑制声音与通知。
4. 在现有过滤条件之后、系统通知判断之前，仅当 `isHostMessageNotificationSoundEnabled()` 为真时调用 `playMessageNotificationSound()`。
5. 不把声音开关加入整条通知的提前 `return` 条件，避免误关桌面通知。
6. 运行 `pnpm vitest run src/renderer/components/client-message-notification-sync.test.tsx`，确认开启、关闭、会话静音三类路径通过。

### Task 6: 回归验证与人工验收

**Files:**

- Verify: `client-desktop/public/assets/sounds/message-notification.ogg`
- Verify: `client-desktop/src/renderer/lib/message-notification-sound.ts`

**Steps:**

1. 运行提示音、Host、设置面板、配置存储和消息通知同步的定向 Vitest。
2. 运行 `pnpm typecheck`，确认新增必填字段已补齐所有设置 mock 和调用点。
3. 运行 `pnpm lint` 与 `pnpm verify:boundaries`，确认 Renderer 未直接越界访问 Main 能力。
4. 运行 `pnpm build`，确认声音静态资源仍进入 Renderer 产物。
5. macOS、Windows、Linux 各人工验证：默认开启有声音；关闭后无声音但仍有系统通知；重新启动后状态保持；重新开启后下一条消息恢复声音。
6. 人工验证当前会话可见、应用后台、会话免打扰、服务端静音和连续消息场景，确保既有规则不回退。

## 验收标准

- 设置页可见“新消息提示音”开关，默认开启且自动保存。
- 关闭后，符合通知条件的新消息不播放 `message-notification.ogg`。
- 关闭后，系统通知、托盘、角标、未读数仍正常更新。
- 开关切换立即生效，应用重启后状态保持。
- 旧 `desktop-config.json` 无需手工迁移即可获得默认值。
- 非布尔 IPC 输入被拒绝，不新增宽泛 Bridge 或 Renderer/Main 越界访问。
