# Desktop 实时诊断

Desktop 实时诊断默认只保存在本机。用户通过设置页导出后，诊断包包含两个
5 MiB JSONL 日志文件中的全部有效事件，并按 Main 分配的 `eventSeq` 合并为单一
时间线。导出不会上传数据，`remoteTelemetryEnabled` 始终为 `false`。

## 导出结构

导出文件使用 schema version 4，包含以下顶层字段：

- `timeline`：事件总数、首尾 `eventSeq`、时间范围和轮转次数。
- `summary`：按 type 和错误类别的计数、连接汇总计数、恢复片段数量、同步结果和
  被聚合的重复解析失败数量。
- `events`：完整原始时间线。`summary` 只能帮助定位，不能代替它作为故障结论依据。
- `clientEvidenceBoundary`：明确客户端未观察到某个实时事件，不能推断服务端未发送。

每个新事件都采用固定信封：

```json
{
  "eventSeq": 1042,
  "timestamp": "2026-08-11T08:00:00.000Z",
  "origin": "renderer",
  "type": "message-sync.cache-committed",
  "context": {
    "episodeId": "...",
    "conversationId": "...",
    "syncOperationId": "...",
    "requestId": "..."
  },
  "data": {
    "afterSeq": 128,
    "committedSeq": 156
  }
}
```

`origin` 只会是 `main`、`renderer` 或 `gpu`。`context` 只在存在关联字段时出现，
不能是空对象；`data` 只保存白名单中的状态、序号、耗时、环境摘要或分类错误，
不保存关联 ID 或任意文本。写入端的 `DiagnosticEventInput` 会按 `type` 静态限制
字段和值；例如列表事件只能使用 `conversation-list` endpoint，消息分页事件只能使用
`message-after-seq` endpoint。IPC 和 JSON 读取边界仍以 `unknown` 接收原始数据，只有通过
运行时解析后才进入受控事件。

## 关联字段

| 字段                   | 用途                                                       |
| ---------------------- | ---------------------------------------------------------- |
| `episodeId`            | 一次初始连接、睡眠恢复、锁屏恢复、窗口激活或连接恢复片段。 |
| `targetScope`          | 已校验的本地 Server 范围，不含 URL、用户 ID 或凭据。       |
| `connectionInstanceId` | Main 创建的某个 WebSocket 实例。                           |
| `conversationId`       | 已校验的真实会话 ID，用于关联列表、追赶、缓存与 UI。       |
| `listRefreshId`        | 一次会话列表刷新及其序号分叉。                             |
| `syncOperationId`      | 一次消息追赶从 candidate 到最终状态的完整链路。            |
| `requestId`            | 一个 after-seq 请求、响应和缓存提交。                      |

这些 ID 仅存在于 Main/Renderer IPC 和本地诊断文件，不会进入 HTTP 请求、WebSocket
消息、请求 Header 或远程遥测。

## Type 对照

- 连接：`realtime.connection-created`、`realtime.socket-opened`、
  `realtime.socket-closed`、`realtime.reconnect-scheduled`、
  `realtime.authorization-checked`、`realtime.system-ready`、
  `realtime.state-changed`。
- 桥接：`realtime-bridge.snapshot-sent`、`realtime-bridge.snapshot-received`、
  `realtime-bridge.snapshot-missed`、`realtime-bridge.delivery-failed`。
- 会话列表：`conversation-list.completed`、`conversation-list.failed`、
  `conversation-list.seq-diverged`。
- 消息追赶：`message-sync.candidate`、`message-sync.started`、
  `message-sync.page-requested`、`message-sync.page-received`、
  `message-sync.cache-committed`、`message-sync.completed`、
  `message-sync.failed`、`message-sync.cancelled`、`message-sync.skipped`。
- 缓存与界面：`message-cache.state-changed`、`conversation-ui.view-changed`、
  `conversation-ui.state-observed`。
- 环境与性能：`environment.lifecycle-changed`、
  `environment.window-state-changed`、`environment.network-changed`、
  `runtime.stall-observed`、`gpu.process-error`。
- 解析异常：`realtime.event-parse-failed` 和带抑制数量、序号范围、时间窗口的
  `realtime.parse-failures-aggregated`。

普通一秒运行时心跳和普通实时消息不会逐条落盘。Renderer 卡顿仍按冷却采样，
重复解析失败被定期聚合，因此关键状态转换不会被高频事件挤出双文件保留窗口。

## 排查顺序

1. 先读 `summary`，定位异常 type、错误类别或异常的 `syncOperationId`。
2. 按 `eventSeq` 展开该恢复片段：Main 已 `system-ready` 而没有同一连接实例的
   `snapshot-received`，说明问题位于 Main 到 Renderer 的桥接证据范围。
3. 找到 `conversation-list.seq-diverged` 后，以相同 `conversationId` 和
   `listRefreshId` 查找 `message-sync.candidate` 与 `message-sync.started`：前者存在而
   后者缺失，说明客户端追赶条件未执行；不代表服务端没有发送实时消息。
4. 对同一 `syncOperationId` 和 `requestId`，依次核对 `page-requested`、
   `page-received`、`cache-committed`。响应成功后没有缓存提交属于缓存或过期操作问题。
5. 对比 `message-cache.state-changed` 与 `conversation-ui.state-observed`：缓存序号已增加、
   展示序号未增加时，再检查 `viewMode=history` 和待处理消息数量，避免把历史模式误判为丢消息。

诊断不会记录消息正文、会话名称、发送者/成员信息、Token、Cookie、请求 Header、完整 URL
或文件路径。唯一的身份关联例外是专用实时诊断事件中的、经过字符集和长度校验的
`context.conversationId`；缓存服务自身日志和消息 payload 仍不记录身份标识。
