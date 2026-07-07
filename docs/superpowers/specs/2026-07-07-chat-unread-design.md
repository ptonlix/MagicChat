# 聊天未读提醒设计

日期：2026-07-07

## 背景

客户端聊天列表需要显示会话未读提醒的小红点。现有服务端已经有 `conversations.last_message_seq`，消息也按会话内递增 `seq` 排序；`conversation_members` 里已有 `last_read_message_id`，但没有可直接用于计算未读数的 seq 字段。

本设计采用 `last_read_seq` 作为每个用户在每个会话里的已读位置。未读数由服务端基于 `last_message_seq - last_read_seq` 返回给前端，避免直接维护孤立计数导致并发或重试后漂移。

## 范围

本次实现：

- 在聊天列表显示每个会话的未读红点/数字。
- 用户打开会话后标记该会话为已读。
- 用户当前停留在某个会话时，定时清理该会话的未读数。
- 实时收到新消息后，本地及时更新对应会话的未读数。

本次不实现：

- 群成员级别的已读回执展示。
- 消息气泡上的已读/未读状态。
- 精确到多设备前台可见性的服务端在线状态。
- 管理端未读统计。

## 数据模型

在 `conversation_members` 增加字段：

```sql
last_read_seq bigint NOT NULL DEFAULT 0
```

语义：

- `last_read_seq` 表示该成员已经读到的最大消息 seq。
- 新会话默认 `0`，表示还没有读过任何消息。
- 任何更新都只能前进，不能回退。
- 用户自己发送成功的消息会自动把自己的 `last_read_seq` 推进到该消息 seq。

现有 `last_read_message_id` 暂时保留，不作为本次前端未读数的计算依据。后续如果不再需要，可以单独清理。

## 服务端 API

### 会话列表

`GET /api/client/conversations` 的每个会话项新增：

```json
{
  "last_read_seq": 9,
  "unread_count": 3
}
```

计算方式：

```text
unread_count = max(last_message_seq - last_read_seq, 0)
```

如果后续需要排除自己跨设备发出的历史消息，可以再改成按 messages 表统计非本人消息；本次先采用 seq 差值，并通过发送消息时推进发送者已读位置，满足当前产品预期。

### 标记会话已读

新增：

```text
POST /api/client/conversations/:conversation_id/read
```

请求体可以为空。为空时，服务端把当前用户在该会话的 `last_read_seq` 更新到该会话当前 `last_message_seq`。

可选请求体：

```json
{
  "up_to_seq": 123
}
```

如果提供 `up_to_seq`，服务端更新到 `min(up_to_seq, conversation.last_message_seq)`。

服务端必须校验：

- 当前用户必须是该 active 会话的未退出成员。
- `conversation_id` 必须是合法 UUID。
- `up_to_seq` 如果存在，必须为正整数。
- 更新使用 `GREATEST(last_read_seq, target_seq)`，避免旧请求覆盖新状态。

响应：

```json
{
  "conversation_id": "uuid",
  "last_read_seq": 123,
  "unread_count": 0
}
```

错误码沿用现有会话 API：`400 invalid_request`、`401 unauthorized`、`403 forbidden`、`404 not_found`、`500 internal_error`。

## 发消息流程

`createUserMessage` 创建新消息时，在同一个事务内：

1. 锁定并更新会话的 `last_message_seq`。
2. 插入消息。
3. 更新 `conversations.last_message_*`。
4. 更新发送者的 `conversation_members.last_read_seq` 到新消息 seq。
5. 发送 `message.created` 实时事件。

这样自己发出的消息不会让自己在会话列表里出现未读。

## 前端数据层

`ClientConversation` 增加：

```ts
lastReadSeq: number
unreadCount: number
```

`client-data-api` 增加 `markConversationRead(conversationId, upToSeq?)`。

`ClientDataProvider` 增加：

- `markConversationRead(conversationId, options?)`：调用服务端 API，并在成功后更新本地会话的 `lastReadSeq` 和 `unreadCount`。
- `updateConversationUnreadFromMessage(message, activeConversationId, visible)`：实时消息进入时决定是否增加未读。

本地更新规则：

- 收到自己发送的消息：不增加未读。
- 收到别人发到非当前会话的消息：该会话 `unreadCount += 1`。
- 收到别人发到当前会话，且页面可见：不展示未读，触发标记已读。
- 收到别人发到当前会话，但页面不可见：增加未读。
- 如果本地没有该会话，继续沿用现有 `refreshConversations()` 拉取完整列表。

## 前端页面行为

聊天列表：

- `unreadCount > 0` 显示红点或数字。
- `1..99` 显示具体数字。
- `>99` 显示 `99+`。
- 当前选中的会话如果仍有未读，可在 API 成功后立即清零。

打开会话：

- 用户点击会话后，如果该会话 `unreadCount > 0`，调用 `markConversationRead(conversationId)`。
- 如果消息加载还没完成，也可以先清未读；服务端标记的是会话最新 seq，不依赖前端已经渲染完历史消息。

当前会话定时清理：

- 在 `ChatPage` 或独立 sync 组件中监听当前 `conversation_id`。
- 页面可见、当前会话存在、`unreadCount > 0` 时，每 15 到 30 秒调用一次 `markConversationRead`。
- 定时 API 失败静默处理，不 toast；下次定时或刷新列表会重新校准。

## 实时与通知关系

现有 `message.created` 继续作为新消息入口。

- 桌面通知仍按现有逻辑：当前会话且页面可见时不通知。
- 未读数和桌面通知共用“当前会话 + 页面可见”的判断，但互不依赖。
- 标记已读 API 成功后只影响本地红点，不主动关闭已弹出的系统通知。

## 测试策略

服务端测试：

- 会话列表返回 `last_read_seq` 和 `unread_count`。
- 新成员默认 `last_read_seq = 0`。
- 发送者发送消息后自己的 `last_read_seq` 推进。
- 其他成员未读数增加。
- 标记已读只能操作自己的会话成员记录。
- 标记已读不允许回退。
- `up_to_seq` 超过最新消息时只更新到 `last_message_seq`。

前端测试：

- API normalization 解析 `unread_count` 和 `last_read_seq`。
- 标记已读 API 请求路径和响应处理正确。
- 数据层收到实时消息时按当前会话、发送者和页面可见状态更新未读数。

如果当前前端任务仍要求不新增前端测试，则只做服务端测试和构建验证，前端用 `typecheck`/`build` 覆盖类型与集成错误。

## 迁移与兼容

新增字段默认值为 `0`，旧数据迁移后会把所有已有会话视为未读。为了避免上线后老会话全部亮红点，迁移应把现有成员的 `last_read_seq` 初始化为对应会话的 `last_message_seq`：

```sql
UPDATE conversation_members cm
SET last_read_seq = c.last_message_seq
FROM conversations c
WHERE c.id = cm.conversation_id;
```

新字段添加与初始化应在同一个 migration 中完成。

## 验收标准

- 用户 A 给用户 B 发消息后，B 的会话列表显示未读红点，A 不显示自己的未读。
- B 打开该会话后红点消失，刷新页面后仍保持消失。
- B 当前停留在该会话且页面可见时，新消息不会长期保留未读红点。
- B 页面不可见或停留在其他会话时，新消息会增加对应会话未读数。
- 服务端未读位置不会因重复请求、旧请求或并发请求回退。
