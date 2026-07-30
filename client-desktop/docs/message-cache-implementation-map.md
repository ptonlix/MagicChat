# Desktop 消息缓存设计

本文定义 MagicChat Desktop 消息缓存的架构、数据边界、同步不变量、安全约束和故障处理。
Server 始终是消息事实来源；本地缓存用于加快最近消息恢复、保存连续同步边界，并在短时网络
不可用时提供已经缓存的历史。缓存不构成完整离线工作区。

## 设计目标

- 应用完成认证和工作区初始化后，优先恢复会话最近缓存，再通过 Server 校准最新状态。
- 断线、重连、休眠恢复和应用重启后，从已确认的 HTTP 游标完整追赶所有增量页面。
- 统一处理 HTTP、Realtime、发送结果和消息状态更新，避免不同入口产生不一致状态。
- 将 SQLite 和文件系统能力限制在 Electron Main 管理的 Worker 中。
- 按 Server、用户和会话隔离数据，阻止注销、切换和清理后的迟到写入。
- 对 Renderer 工作集、单会话持久记录和全局缓存容量设置独立上限。
- 数据库、Worker、权限或磁盘故障不得阻止在线聊天和成功消息展示。
- 提供稳定迁移、损坏恢复、定向清理、日志脱敏和用户可见的缓存状态。

## 非目标

- 不提供完整冷启动离线工作区。认证、当前用户、联系人、会话摘要和项目初始化仍依赖 Server。
- 不提供离线发送、离线 reaction/choice 提交或跨设备冲突解决。
- 不缓存图片、语音、文件等附件二进制，只保存消息正文、展示元数据和资源引用。
- 不修改 Server 的分页、Realtime 或消息协议。
- 不使用 SQLCipher 或应用级消息正文加密。

## 总体架构

```text
                         MagicChat Server
                    最终权威消息与业务状态
                              ▲
                              │ HTTP / WebSocket
                              ▼
┌──────────────────── Electron Main 可信进程 ────────────────────┐
│                                                               │
│  Transport                                                    │
│  MessageCacheService                                          │
│    └── MessageCache Worker                                    │
│          └── node:sqlite                                      │
│                └── messages-v1.sqlite3                        │
│                                                               │
└──────────────────────────────┬────────────────────────────────┘
                               │ Preload / DesktopBridge
                               │ 版本化窄类型接口
┌──────────────────────────────▼────────────────────────────────┐
│                         Renderer                              │
│                                                               │
│  HTTP / Realtime / UI 命令 ──► MessageManager                 │
│                                    │                          │
│                                    ├──► MessageRepository     │
│                                    │      └── messageCache    │
│                                    ├──► 消息工作集             │
│                                    └──► 消息领域事件           │
│                                               │               │
│                                               ▼               │
│                                  ClientDataProvider / UI      │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

各层职责如下：

- Server：保存最终权威消息和业务状态，负责分页、可见性和权限判断。
- Main Transport：执行受认证的 HTTP 和 WebSocket 通信。
- `MessageCacheService`：验证认证目标和缓存参数，管理 Worker 生命周期并映射稳定错误码。
- MessageCache Worker：独占 SQLite 连接，执行 schema、事务、迁移、维护和恢复。
- Preload/Bridge：只转发白名单缓存操作，不暴露通用 IPC、路径、SQL 或 Node.js 对象。
- `MessageManager`：统一消息合并、同步游标、工作集、tombstone、generation 和降级行为。
- `ClientDataProvider`：订阅消息领域事件，保留会话摘要、未读、发送状态和 UI 编排职责。

## 数据目录与运行时配置

数据库位于 Electron 用户数据目录：

```text
<app.getPath("userData")>/
└── message-cache/
    ├── messages-v1.sqlite3
    ├── messages-v1.sqlite3-wal
    └── messages-v1.sqlite3-shm
```

Worker 使用以下 SQLite 配置：

- `journal_mode=WAL`
- `foreign_keys=ON`
- 有界 `busy_timeout`
- `synchronous=NORMAL`

POSIX 平台将缓存目录限制为 `0700`，数据库文件限制为 `0600`；Windows 继承当前用户
`userData` 目录的 ACL。数据库路径不会通过 Bridge 返回 Renderer。

## 认证作用域

缓存目标由不可变认证信息组成：

```text
server id + normalized URL + user id + conversation id
```

Main 根据 Server Profile 校验 Server ID 和规范化 URL，并验证 `userId` 属于当前认证身份。
数据库使用由 Server ID 和规范化 URL 共同确定的稳定 `server_key`，再与 `user_id`、
`conversation_id` 组成作用域。当前选中的 Server、单独 URL 或 Renderer 声明的用户身份都
不能作为可信缓存边界。

## Bridge 契约

Renderer 只能使用版本化的 `DesktopBridge.messageCache`：

- `readRecent`：读取会话最近缓存页。
- `readBefore`：读取指定 `beforeSeq` 之前的连续缓存页。
- `getById`：读取单条持久消息，用于更新工作集之外的消息。
- `getSyncState`、`listSyncStates`：读取当前认证用户的同步状态。
- `commitLatest`、`commitBefore`、`commitAfter`：事务提交 HTTP 页面和同步边界。
- `upsert`、`removeMessage`：保存 Realtime/本地成功结果或删除记录。
- `getStats`：读取当前认证用户的近似缓存统计。
- `clearConversation`、`clearUser`：执行 Renderer 所需的定向清理。

全量清理和 Server 级清理只由 Main 生命周期内部调用，不向 Renderer 暴露。Bridge 不提供
任意 SQL、数据库路径、文件路径、Worker 控制或通用 channel。

Main 对所有请求逐字段校验：

- ID 最大长度为 128；
- seq 必须是非负安全整数；
- 单页和单批最多 100 条；
- 单条 payload 最大 512 KiB；
- 单批总大小最大 4 MiB；
- payload schema version 必须受支持；
- 同一批记录必须属于同一认证目标和会话；
- generation 必须与事务内当前作用域一致。

校验失败时原子拒绝整个操作，不写入部分记录，不推进同步状态，也不输出敏感参数。

## 数据模型

### cached_messages

保存规范化消息记录，关键字段包括：

- `server_key`、`user_id`、`conversation_id`
- `message_id`、`seq`
- `reaction_version`
- `payload_schema_version`、`payload_json`
- `created_at`、`cached_at`

主键按认证作用域和消息 ID 隔离；同一会话内 seq 唯一。最近消息索引按作用域和 seq
降序排列，同时支持 `seq < beforeSeq` 的历史查询。

### message_sync_state

每个认证作用域会话保存一行同步状态：

- `http_synced_through_seq`：HTTP 已确认连续处理到的最大 seq；
- `oldest_cached_seq`：当前连续缓存窗口最老的 seq；
- `has_more_before`：Server 是否仍可能存在更早历史；
- `last_synced_at`：最近一次成功 HTTP 同步时间；
- `last_accessed_at`：最近缓存访问时间，用于 LRU 淘汰。

同步状态是否存在不等同于 latest HTTP 初始化完成。Realtime 或本地 upsert 可以创建缓存
记录，但不能伪造已经完成的 HTTP 连续边界。

### message_cache_stats

按认证目标保存消息数量、会话数量和 payload 逻辑字节数。统计与消息事务一起更新，设置页
读取近似逻辑占用，不承诺等于 SQLite 文件系统大小。

### message_cache_generations

保存四层清理 generation：

```text
global → server → user → conversation
```

所有写操作携带启动时捕获的完整 generation。任一层发生变化，旧操作都会以
`cache_generation_stale` 被拒绝，防止清理后的迟到响应重新创建数据。

### message_cache_metadata

保存 payload schema version 等全局缓存元数据，用于启动校准和不兼容 payload 重建。

## 消息序列化与完整性

Renderer 将规范化 `ClientMessage` 序列化为版本化 JSON。Main 将 payload 当作不透明数据，
只校验大小、版本和记录元数据，不在可信进程复制富消息业务逻辑。

缓存读取后执行两层完整性检查：

1. Main 隔离并删除无法解析或元数据不一致的数据库记录。
2. Renderer 反序列化并验证消息 ID、会话 ID、seq 和核心消息结构。

只要任一层丢弃记录，页面就标记为 `complete=false`。有效记录仍可用于改善展示，但该页不能
作为完整缓存命中，Renderer 必须使用相同 `beforeSeq` 回源 Server。

## MessageManager

`MessageManager` 是 Renderer 消息语义的统一入口，负责：

- 按消息 ID 去重并按 seq 排序；
- 串行执行同一会话的消息操作；
- 合并 HTTP、缓存、Realtime 和成功本地操作；
- 维护当前 Renderer 消息工作集；
- 保护 reaction、choice、topic 和撤回/删除终态；
- 管理同步单飞、内存游标、operation token 和 tombstone；
- 发布 `messages-changed`、同步错误等领域事件；
- 发生持久故障后切换到当前进程内存模式。

HTTP、Realtime 或 mutation 响应必须先经过 Manager，再更新持久层和 UI。组件不能绕过
Manager 直接维护另一套消息数组。

## 消息合并规则

- 同一消息只保留一条，排序以 seq 为准。
- 较低 `reactionVersion` 不能覆盖较高版本 reaction 状态。
- 旧 choice 状态不能回退响应数量或清除当前用户已经确认的选择。
- 缺少 topic 字段的旧 payload 不能抹除已有 topic 元数据。
- 撤回是终态，迟到的活动 payload 不能恢复撤回前的 choice 或 reactions。
- 删除通过当前进程 tombstone 阻止旧 HTTP 或 Realtime 响应复活消息。
- 对工作集之外的 reaction、choice、topic 或删除目标，Manager 按 ID 读取持久记录并更新，
  不需要把整个会话历史加载进 Renderer。

永久 tombstone 不写入 SQLite。应用退出会取消当前进程请求，重启后由 Server 最新状态校准。

## 缓存优先加载

打开会话时执行以下流程：

1. 等待当前认证和工作区初始化完成。
2. 读取最近缓存页并立即发布可用消息。
3. 缓存读取失败时忽略缓存故障，继续请求 Server。
4. 无论缓存是否命中，都立即请求 Server latest 页面校准。
5. 合并 Server 页面并按同步规则提交缓存。

缓存命中只缩短首屏消息等待时间，不能永久抑制网络同步。缓存可用但 latest 请求失败时，
保留已经展示的时间线并报告非阻塞同步错误。

## 历史分页

历史页只有同时满足以下条件才能作为本地命中：

- 请求位于 `oldestCachedSeq` 到 `httpSyncedThroughSeq` 的已确认连续区间；
- 请求没有越过当前最老缓存边界；
- 返回页通过 Main 和 Renderer 完整性检查；
- 缓存页有足够消息，或者同步状态已经确认 `hasMoreBefore=false`。

边界未知、记录不足、页面损坏或范围被淘汰时，Renderer 必须回源 Server。Server before 页面
只有与当前 `oldestCachedSeq` 连续衔接时，才允许在同一事务中写入记录并扩展历史边界；随机
历史页或断层页面可以在当前工作集展示，但不能写入 SQLite 后伪装成连续缓存。

## 连续增量同步

`httpSyncedThroughSeq` 只表示 HTTP 已确认的连续边界，不表示本地见过的最大 seq。

### latest 页面

- 尚未完成 HTTP 初始化时，latest 页面可以初始化连续游标和最老缓存边界。
- 已有连续游标时，latest 页面可以补充或更新消息，但不能跳跃推进连续游标。

### after 页面

- 从当前 `httpSyncedThroughSeq` 请求 `afterSeq` 页面。
- 持续消费 `hasMoreAfter`，直到 Server 明确返回 `false`。
- 下一游标必须严格大于请求游标。
- 页面包含错误会话、游标停滞或空页仍声明有后续时，停止本轮同步并报告协议错误。
- 只有请求 `afterSeq` 等于事务内当前游标时，页面才能通过 compare-and-set 推进游标。
- 过期并发响应不能推进游标，也不能产生重复消息。

### Realtime 和成功本地操作

Realtime、发送、转发、reaction、choice 和其他成功 mutation 可以立即展示并 upsert，但不能
推进 HTTP 连续游标。即使已经收到较高 seq 的实时消息，后续仍从最后确认的 HTTP 游标追赶，
以补齐中间可能缺失的消息。

### 调度与响应性

- 同一认证目标和会话使用单飞 Promise，合并重复恢复信号。
- 优先同步当前会话，其次未读和最近活动会话。
- 每处理 10 页主动让出事件循环，大缺口从最近已提交游标继续。
- 中间页网络失败时保留最后成功游标，下一次恢复从该位置续跑。

## Renderer 工作集与容量

Renderer 工作集和 SQLite 使用独立上限：

- 当前活动消息视图保留用户正在阅读的页面和既有保护窗口。
- 非活动 Renderer 会话可压缩到最近 300 条，控制 React 渲染和 JavaScript 堆占用。
- SQLite 每个会话最多保留最近 3000 条消息。
- 全局 SQLite 逻辑缓存最多 200 MiB。

单会话裁剪后重新计算 `oldestCachedSeq` 并设置 `hasMoreBefore=true`，确保后续能够回源加载更早
历史。全局超限时按 `lastAccessedAt` 淘汰最冷的整个会话缓存和同步状态。淘汰不影响当前
Renderer 工作集，Server 可以重新建立数据。

Worker 内的维护任务最多每 60 秒调度一次，负责容量裁剪、统计一致性和受控 WAL checkpoint。
常规消息写入不扫描全库，也不自动执行 VACUUM。

## Schema 迁移与恢复

数据库 schema version 与消息 payload schema version 独立维护。schema 使用从版本 1 开始的
连续迁移注册表：

- 空库和旧库使用同一条逐级迁移路径；
- 注册表重复、缺失、乱序或目标版本未登记时，在修改数据库前拒绝启动；
- 所有待执行迁移和 `PRAGMA user_version` 更新位于同一个独占事务；
- 任一步失败时结构、数据和版本号整体回滚；
- 已发布迁移不可改写，只能追加新版本；
- 无法安全解释旧 payload 时，清空消息、同步状态和统计，由 Server 重建。

数据库无法打开、schema 过高或迁移失败时，Worker 关闭连接并按以下顺序临时隔离文件：

```text
WAL → SHM → 主数据库
```

任一步失败时逆序恢复本轮已移动文件。隔离文件不是恢复源、诊断产物或备份；新库初始化和
权限设置成功后立即清除。Worker 启动以及会话、用户、Server、孤立 Server 和全量缓存清理
时也会清扫合法隔离文件。清扫只匹配固定数据库 basename 和纯数字时间戳，不能删除相似
名称、目录或其他业务文件。

如果新库已经创建但隔离文件无法删除，缓存不能报告 `available`，必须进入稳定内存降级。

## 生命周期与清理

### 应用启动和退出

- 启动时初始化 Worker、迁移数据库、清扫隔离文件并执行健康检查。
- 普通关闭和升级重启前停止接收新请求、drain 已入队操作、checkpoint WAL 并关闭 Worker。
- 升级安装失败且应用继续运行时，重新打开或重建 Worker。

### 显式注销

- 只有远端注销成功后，才失效 Manager scope、清理当前用户缓存并切换到登录页。
- 远端注销失败时保留认证 Session、消息缓存和 Renderer 工作集，并提示用户重试。

### 401 或远端 Session 失效

- 立即关闭 Realtime、失效当前消息 scope 并切换到登录页。
- 用户缓存清理以显式消费失败的 best-effort 操作执行，不能延迟认证失效或产生未处理拒绝。
- 清理期间立即撤销旧用户缓存访问资格，避免失败后重新读取遗留数据。

### 用户和 Server 变化

- 同一 Server 切换用户时创建新的认证作用域，旧用户缓存不能进入新用户 UI、统计或通知。
- 移除 Server 时先取消请求和实时连接，再清理该 Server 的全部用户缓存。
- Server 缓存清理失败不阻塞 Profile、凭据和 Session 清理；Main 在运行期重试，下一次启动
  继续清理没有对应 Profile 的孤立 Server 数据。

### 会话移除和恢复

- 会话移除、退出或解散时清理消息、同步状态、工作集和 tombstone，并递增会话 generation。
- 会话恢复后从 Server 创建新的同步状态，不能复用移除前的游标。

### 用户主动清理缓存

- 设置页只清理当前认证用户的本地消息缓存。
- 清理不删除服务端消息、认证、草稿、主题、设置、下载或附件。
- 当前 Renderer 工作集可以保留，避免正在阅读的时间线突然消失。
- 清理后持久边界视为未知，历史分页回源 Server。
- 清理时已经加载的会话在下次进入时强制执行一次 latest 校准；失败后保留待校准标记并重试。

## 并发与迟到响应

每个消息操作启动时：

1. 等待当时可见的清理屏障；
2. 捕获 Manager scope epoch、会话 epoch 和四层 generation；
3. 发起 HTTP、Realtime 或 mutation 操作；
4. 响应返回时复用原快照验证，不重新读取清理后的 generation；
5. epoch 或 generation 失效时取消展示和持久化。

清理事务会递增对应 generation。全量清理即使面对尚未登记的作用域，也会递增持久 global
generation，使清理前捕获的默认 generation 0 失效。

## 故障降级

缓存对 Renderer 暴露三种稳定状态：

- `available`：缓存可正常读写；
- `rebuilding`：Worker 正在恢复或重建；
- `degraded`：缓存不可用，在线聊天继续使用内存模式。

Main 将 Worker、SQLite、权限、磁盘满、损坏和迁移异常映射为稳定缓存错误码，不返回原始
错误或路径。

缓存读取失败时，最近页和历史页必须继续 HTTP 回源。Server 请求成功而缓存写入或 generation
获取失败时，Manager 先把消息合并到工作集，再将当前 Manager 生命周期单向切换为内存模式：

- 不再读取、写入或自动恢复 SQLite；
- HTTP、Realtime、发送和成功 mutation 继续展示；
- 同步使用当前进程确认的内存游标；
- 显式隐私清理仍由 Main 执行；
- 只有完整重启应用并创建新的 Manager 后，才重新尝试持久缓存。

该策略避免在故障期间形成部分落盘状态，也避免把只存在于 Renderer 的游标误认为已经持久化。
重启后必须从持久游标和 Server 重新建立可信连续边界。

## 安全与隐私

- Renderer 被视为不可信输入源，所有缓存操作都在 Main 重新验证身份和资源归属。
- 数据库不保存 Cookie、Token、附件二进制或任意文件内容。
- 日志、崩溃记录和诊断导出不得包含消息 payload、身份 ID、Server URL、数据库路径、SQL
  参数或原始 SQLite 错误。
- Renderer 只获得稳定错误码、缓存状态、近似大小和非识别性计数。
- 明文 SQLite 的保护边界是操作系统账户、用户数据目录权限和系统磁盘加密。
- 隔离文件采用成功状态零保留策略，不能作为长期明文备份。

## 验证要求

自动验证至少覆盖：

- latest/before/after 连续性、游标停滞、重复页面和并发 compare-and-set；
- 单会话单飞、大缺口分页和事件循环让出；
- 消息乱序、去重、reaction/choice/topic 版本保护和 tombstone；
- 事务回滚、重启恢复、schema 迁移、统计、裁剪和 LRU 淘汰；
- Bridge 契约、恶意输入、跨用户隔离和敏感信息不泄漏；
- 清理 generation、迟到响应、注销、401、Server 移除和升级重启；
- 缓存读取失败 HTTP 回源、持久写入失败内存降级和重启恢复。

常规检查命令：

```bash
pnpm check
pnpm test
pnpm build
pnpm verify:build
```

发布前仍需在 Windows x64/arm64、Linux x64/arm64 和 macOS Universal 产物中手工验证首次
建库、权限、事务、迁移、缓存命中、退出重开、清理和损坏恢复；还需在真实网络切换、休眠
唤醒、Server 重启和大量消息缺口下验收完整追赶、UI 响应性和通知无重复。
