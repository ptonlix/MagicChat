# Desktop 消息缓存实现映射

本文记录 Desktop 对照 Mobile `a98be93`、`c546cbb` 后的消息路径落点，作为实现和回归检查清单。

| 消息来源或操作                                     | Desktop 入口                           | MessageManager 行为                               | SQLite 行为                                      |
| -------------------------------------------------- | -------------------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| latest HTTP                                        | `ensureConversationMessages`           | 去重、终态与版本合并                              | 首次初始化连续游标；后续不跳跃推进               |
| before HTTP                                        | `loadBeforeConversationMessages`       | 仅在连续缓存不足时回源并合并                      | 与 `oldestCachedSeq` 衔接时扩展历史边界          |
| after HTTP                                         | `syncAfterConversationMessages`        | 持续消费 `hasMoreAfter`，每 10 页让出事件循环     | 请求游标与当前游标相等时 CAS 推进                |
| `message.created` / `message.updated`              | `ClientConversationRealtimeSync`       | 统一合并并保护新状态                              | upsert 消息，不推进 HTTP 连续游标                |
| reaction event / snapshot                          | `ClientDataProvider`                   | 版本保护；工作集外按 ID 读取                      | 更新目标记录，不推进游标                         |
| choice event / snapshot                            | `ClientDataProvider`                   | response count、当前用户选择和删除 tombstone 保护 | 更新或删除目标记录，不推进游标                   |
| topic 更新                                         | `mergeIncomingConversationMessage`     | 保留旧响应缺失的新版 topic 元数据                 | upsert 合并后的消息                              |
| 文本、Markdown、链接、卡片、文件、图片、语音、转发 | `useConversationSenders` 及相应 action | 仅 Server 成功后进入 manager                      | upsert 消息，不推进游标                          |
| 撤回                                               | `useConversationActions`               | 撤回终态优先，旧活动 payload 不得复活             | 保存 revoked payload                             |
| 会话移除、退出或解散                               | `useConversationActions`               | 清理工作集和 tombstone                            | 清理会话并递增 generation                        |
| 注销、401、会话失效                                | Main transport / Renderer 授权错误路径 | 清理当前用户运行时状态                            | 清理用户作用域并递增 user generation             |
| 移除 Server                                        | Main `serversRemove`                   | 连接和请求先停止                                  | 清理 Server 全部用户缓存并递增 server generation |

Desktop 复用既有 `registerConversationMessageView` 和非活动会话 300 条压缩。SQLite 每会话保留最多 3000 条，二者分别服务 React 工作集与重启恢复，不共享生命周期。
