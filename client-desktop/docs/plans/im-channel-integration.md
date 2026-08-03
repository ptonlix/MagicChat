# 即应自动接管钉钉 / 飞书 / 企业微信消息 — 完整方案

> 版本：v1.0 · 状态：评审中
> 关联项目：MagicChat（即应）
> 核心目标：让用户把钉钉、飞书、企微的消息交给即应 AI 助理"茉莉"自动接管，人不再需要守在多个 IM 客户端。

---

## 1. 需求解读

### 1.1 用户的真实诉求

用户每天在钉钉、飞书、企微三个 IM 里收到大量消息：群里 @、私聊求助、审批催办、业务系统通知。每一个 IM 都是一个需要人盯着的"待办入口"。

"让即应自动接管"指的是：

1. **收**：三个 IM 里的消息，即应机器人能实时收到（私聊、群聊 @ 机器人）。
2. **管**：消息进来先由茉莉理解、总结、分流、草拟处理，而不是直接打断人。
3. **回**：茉莉把处理结果/待确认问题直接回复到对应 IM 会话，用户和消息发起方全程不用离开原 IM。
4. **转**：AI 拿不准、需要权限、需要真人表态时，把消息转给对应的人（在即应客户端内处理，处理后经渠道回写 IM）。
5. **沉淀**：所有跨渠道沟通在即应工作空间里留下统一记录，可检索、可追溯、可统计。

### 1.2 目标场景（按优先级）

| 优先级 | 场景 | 说明 |
| --- | --- | --- |
| P0 | 私聊接管 | 客户/同事在钉钉私聊机器人 → 茉莉自动回复、总结、跟进。 |
| P0 | 群聊 @ 机器人 | 群里 @ 茉莉 → 茉莉参与讨论、回答问题、@ 具体人回复。 |
| P1 | 转人工 | 茉莉判断需要人时，通知即应用户，用户回复后回写 IM。 |
| P1 | 任务与提醒 | 茉莉把 IM 消息里的请求转成任务，到期在 IM 里催办。 |
| P2 | 双向同步 | 即应内的回复/会话同步回 IM（默认单向：IM→即应→IM 回复闭环）。 |
| P2 | 卡片交互 | 使用各平台的交互卡片（按钮/表单）完成确认、审批类操作。 |

### 1.3 明确不做（本期边界）

- 不做"把即应变成另一个 IM"：即应内部会话不反向推送所有消息到钉钉/飞书/企微群。
- 不做 IM 客户端：只做服务端机器人接入。
- 不承诺私有化 IM 协议：仅使用三家开放平台的标准机器人能力。

---

## 2. 三个平台的开放能力盘点（接入前必须知道的事实）

### 2.1 钉钉（DingTalk）

| 项 | 内容 |
| --- | --- |
| 应用形态 | 企业内部应用（旧版）或企业内部机器人（新版）；单聊机器人、群聊机器人。 |
| 接收消息 | ① **Stream 模式**（长连接推送，推荐，无需公网回调）；② HTTP Webhook 回调（需公网 URL）。 |
| 发送消息 | 机器人发送消息 API（单聊、群聊）；主动推送需要权限与频率限制；markdown 为钉钉私有方言。 |
| 身份 | `unionId` / `userId` / `openConversationId`。 |
| 群聊条件 | 机器人需被拉入群；只有 `@机器人` 的消息才会推送给机器人。 |
| 关键限制 | Stream 模式事件里机器人能收到：单聊消息、群 @ 消息；机器人在群内发言有频控；企业内应用需管理员授权。 |

> 结论：钉钉优先走 **Stream 模式**（官方 long-polling/长连接 SDK），避免公网回调的运维负担。

### 2.2 飞书（Lark / Feishu）

| 项 | 内容 |
| --- | --- |
| 应用形态 | 企业自建应用，开启"机器人"能力。 |
| 接收消息 | 事件订阅两种模式：① **长连接模式（WebSocket，推荐，无需公网回调）**；② 网页模式（HTTP 回调，需公网 URL + 事件订阅地址 + 加密）。 |
| 发送消息 | `im/v1/messages`（发送消息）、`im/v1/messages/reply`（回复）；markdown/富文本（post）/图片/交互卡片。 |
| 身份 | `open_id`（应用维度）/ `union_id`（开放平台维度）/ `user_id`（租户维度）。 |
| 群聊条件 | 机器人需进群；接收 `im.message.receive_v1` 事件，群消息只有 @ 机器人（或开启"接收群内所有消息"权限）才会推送。 |
| 关键限制 | 消息接收事件有 `app_id` 隔离；应用需申请消息相关权限点（`im:message`、`im:message.group_at_msg` 等）；发送频率限制（应用级 QPS）。 |

> 结论：飞书优先走 **长连接模式**（官方 SDK 支持），同样免公网。

### 2.3 企业微信（WeCom）

| 项 | 内容 |
| --- | --- |
| 应用形态 | 企业自建应用（可出现在工作台）+ 企业微信机器人；客户联系（外部联系人）需另外开通。 |
| 接收消息 | **只有 HTTP 回调**：配置 `URL` + `Token` + `EncodingAESKey`（AES 加密），消息以 XML 加密报文推送。**没有长连接模式**。 |
| 发送消息 | 应用消息推送 API（`text` / `markdown` / `news` / `textcard`）；主动推送有配额（每企业每应用每分钟上限）。 |
| 身份 | `UserId`（企业内部）/ `ExternalUserId`（外部联系人）/ `ChatId`（群会话）。 |
| 群聊条件 | 自建应用消息回调支持群聊（需开启接收消息）；企业外部群需要"客户联系"功能。 |
| 关键限制 | **必须公网可访问的 HTTPS 回调 URL**；回调报文是 AES-256-CBC 加密的 XML；URL 需通过验证；主动消息配额紧张时需排队。 |

> 结论：企微必须部署公网回调端点（或 HTTPS 隧道/反向代理），需要 `EncodingAESKey` 加解密与 `msg_signature` 验签。

---

## 3. 总体架构

### 3.1 架构决策：三层分离

```
┌───────────────────────────── 渠道接入层 (gateway) ─────────────────────────────┐
│  dingtalk-gateway   feishu-gateway    wecom-gateway                            │
│  协议适配：Stream/长连接/HTTP回调 · 验签 · AES加解密 · IM API调用 · 重试/限流   │
└───────────────┬───────────────────────────────────────────────────────────────┘
                │  归一化消息（统一中间格式，JSON/Protobuf）
┌───────────────▼───────────────────────────────────────────────────────────────┐
│                  渠道服务层 (server: channel 模块)                             │
│  回调端点 /api/channels/{key}/callback · 身份映射 · 会话映射 · 消息归一化      │
│  渠道管理(CRUD) · 绑定管理 · 回调日志 · 幂等/去重                              │
└───────────────┬───────────────────────────────────────────────────────────────┘
                │  既有消息总线 / 会话模型（复用 message/conversation）
┌───────────────▼───────────────────────────────────────────────────────────────┐
│                   AI 助理层 (assistant / 茉莉)                                 │
│  复用现有 Agent + LLM + 工具链，作为"渠道会话"成员自动接管                     │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 方案对比与选型

| 方案 | 描述 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- | --- |
| A. 渠道网关以"第三方应用"身份接入即应 | gateway 走现有 `/api/app/ws` 应用协议收发消息 | server 几乎零改动，完全复用现有协议 | 链路长（IM→gateway→server→茉莉→server→gateway→IM 两跳）；"接管"语义要在茉莉侧额外编排；回调端点还是要加 | 不适合作为主路径 |
| **B. server 原生 Channel 抽象 + 独立 gateway（推荐）** | server 增加 channel 模块做归一化与映射；gateway 独立进程只做协议适配 | 链路短（IM→server→茉莉→server→IM）；管理统一在 admin-web；复用 server 的身份/会话/权限体系；gateway 可水平扩展 | server 改动量中等（消息模型加渠道维度） | ✅ 采用 |
| C. 全部塞进 server 进程 | server 直接依赖三家 SDK | 部署最简单 | 协议适配与核心业务耦合，三家 SDK 更新/私有协议会污染核心；无法独立扩展 | 不采用 |

### 3.3 关键设计原则

1. **协议适配下沉到 gateway，业务归一化收敛到 server**：gateway 不感知业务（不知道"接管"、不知道茉莉），只做 渠道报文 ⇄ 归一化消息 的翻译；server 不感知平台差异。
2. **复用现有会话/消息/权限体系**：IM 会话映射为内部"渠道会话"（新增 `type=channel` 会话），茉莉作为会话参与者自动接管，天然获得现有的话题、@、choice、转发、历史读取等能力。
3. **身份双模式**：自动影子账号 + 管理员显式绑定，详见 §5.3。
4. **幂等与可靠投递**：回调去重（`msgId`/事件 ID）、`external_message_id` 唯一约束、失败重放队列。
5. **防死循环**：机器人发出的消息不回推；发送回执不触发回调；相同内容去重。

---

## 4. 归一化消息模型

所有渠道在 server 内统一为以下中间格式（内部存储可 JSON，消息走既有 Message 模型扩展字段）：

```jsonc
// ChannelMessage（server 内部）
{
  "channel_key": "dingtalk",            // 渠道唯一标识
  "external_message_id": "msg_xxx",     // 平台消息 ID（唯一索引，幂等）
  "external_chat_id": "cid_xxx",        // 平台会话 ID（单聊/群聊）
  "external_sender_id": "uid_xxx",      // 平台用户 ID
  "conversation_type": "single|group",  // 会话类型
  "is_bot_message": false,              // 机器人消息标记（防循环）
  "mentioned_me": true,                 // 群消息是否 @ 机器人
  "reply_to_external_message_id": null, // 引用关系
  "body": {
    "type": "text|markdown|image|file|link|card",
    "content": "..."
  },
  "created_at": "2026-01-01T00:00:00Z",
  "raw": { }                            // 平台原始报文（审计用，脱敏后落库）
}
```

回复时 server 把茉莉的回复转成目标平台的发送请求（gateway 完成格式翻译）：

```jsonc
{
  "external_chat_id": "cid_xxx",
  "external_message_id": "msg_xxx",   // 用于 reply
  "message_type": "text|markdown|card",
  "content": "...",
  "interactive": { }                   // 平台交互卡片（Phase 3）
}
```

---

## 5. 身份与会话映射

### 5.1 会话映射

| 内部实体 | 映射规则 |
| --- | --- |
| 渠道配置 | 一个 `channel` 记录 = 一个平台的某个应用（钉钉企业内机器人 / 飞书自建应用 / 企微自建应用），每个渠道一个 `channel_key`。 |
| 渠道会话 | 首次收到某 `external_chat_id` 消息时，自动创建/复用内部会话（`type=channel`），把"渠道机器人"和茉莉以成员身份加入；内部会话与外部会话通过 `channel_conversations` 表映射。 |
| 群聊 | 内部会话建为群聊；`channel_conversations` 记录群成员快照（Phase 2 用于 @ 真实成员）。 |

### 5.2 身份映射（外部用户 ↔ 即应用户）

```sql
-- 影子账号（自动创建）
INSERT INTO users (name, nickname, origin) VALUES ('张三(钉钉)', '张三', 'channel:dingtalk');
INSERT INTO channel_identities (channel_key, external_user_id, user_id, provider, auto_created)
VALUES ('dingtalk', 'uid_xxx', '<新用户UUID>', 'dingtalk', true);
```

```sql
-- 管理员显式绑定（admin-web 操作）：影子账号并入正式账号
INSERT INTO channel_identities (channel_key, external_user_id, user_id, provider, auto_created)
VALUES ('dingtalk', 'uid_xxx', '<正式用户UUID>', 'dingtalk', false);
```

- 绑定后：IM 里这个人 = 即应里的正式用户，茉莉知道 TA 的完整画像与权限。
- 未绑定时：茉莉以"外部访客"对待，遵循保守权限（不能读取内部敏感信息）。
- 同名冲突：以 `external_user_id` 为唯一键，昵称冲突不影响映射。

### 5.3 映射优先级

1. 管理员显式绑定 > 2. 历史自动绑定（按 union_id 命中） > 3. 自动影子账号。

---

## 6. 核心业务流程

### 6.1 流程一：IM 私聊 → 茉莉自动接管 → 回复（P0）

```
用户(钉钉) ──私聊消息──▶ dingtalk-gateway(Stream) ──归一化──▶ server.channel
  ▶ 校验签名/幂等 → 解析外部会话/用户 → 建/复用内部渠道会话 + 影子账号
  ▶ 写入内部消息（sender=影子用户，会话=渠道会话）
  ▶ assistant 收到 message.created → 茉莉接管：
       理解 → 检索上下文/工具 → 决定：直接回复 | 转人工 | 需要确认
  ▶ 茉莉回复 → server 消息总线 → channel dispatcher → gateway → 钉钉 API → 用户
```

### 6.2 流程二：群聊 @ 机器人（P0）

- 只有 `mentioned_me=true` 的群消息进入内部会话（与现有"应用群聊仅 @ 才推送"规则一致，直接复用）。
- 茉莉回复时若引用原消息，用 `reply_to_message_id` 映射回外部 `reply_to_external_message_id`。

### 6.3 流程三：转人工（P1）

```
茉莉判断需要人确认
  ├─ 发送 choice/卡片："此事需要确认，回复数字选择"（用户可在 IM 内直接回答）
  └─ 或标记"待人工"：在即应客户端对应会话给用户一条待办提示
       用户在即应客户端回复 → server 把该回复回写 IM（reply 原消息）
```

- 用户回答 choice 后，`choice.response_created` 事件沿既有可靠事件通道回到 assistant。
- 即应客户端的人工回复回写 IM：`conversation.dispatch` 检测该会话绑定的 `channel_key`，调用 gateway 发送。

### 6.4 流程四：长任务异步汇报（P1）

- 茉莉收到耗时任务（查数据、生成报表）→ 先回"正在处理"→ 完成后通过 gateway 主动推送结果到原会话。
- 主动推送受各平台频控约束，需排队（§8.3）。

### 6.5 防循环与幂等

| 防护 | 实现 |
| --- | --- |
| 机器人消息不回推 | 回调中 `sender.is_bot=true` 直接丢弃（三家均提供标记）。 |
| 回调重复 | `external_message_id` 唯一索引 + 短时窗口去重。 |
| 发送回执触发回调 | 不回写外部消息 ID；或仅记录不处理。 |
| 与现有应用协议共存 | 渠道消息与第三方应用消息共用 outbox/ACK 机制，保证可靠投递。 |

---

## 7. 数据模型设计（新增表）

```sql
-- 渠道配置
CREATE TABLE channels (
  id            UUID PRIMARY KEY,
  key           TEXT UNIQUE NOT NULL,        -- dingtalk / feishu / wecom / dingtalk:xxx
  name          TEXT NOT NULL,
  provider      TEXT NOT NULL,               -- dingtalk | feishu | wecom
  config        JSONB NOT NULL,              -- app_id, app_secret, aes_key, token, stream_host...
  enabled       BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 会话映射
CREATE TABLE channel_conversations (
  id                 UUID PRIMARY KEY,
  channel_key        TEXT NOT NULL REFERENCES channels(key),
  external_chat_id   TEXT NOT NULL,
  conversation_id    UUID NOT NULL,          -- 内部会话
  conversation_type  TEXT NOT NULL,          -- single | group
  meta               JSONB NOT NULL DEFAULT '{}',
  UNIQUE (channel_key, external_chat_id)
);

-- 用户映射
CREATE TABLE channel_identities (
  id                UUID PRIMARY KEY,
  channel_key       TEXT NOT NULL REFERENCES channels(key),
  external_user_id  TEXT NOT NULL,
  user_id           UUID NOT NULL,
  provider          TEXT NOT NULL,
  auto_created      BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (channel_key, external_user_id)
);

-- 消息映射（幂等 + 双向引用）
CREATE TABLE channel_messages (
  id                          UUID PRIMARY KEY,
  channel_key                 TEXT NOT NULL,
  external_message_id         TEXT NOT NULL,
  internal_message_id         UUID NOT NULL,      -- 内部消息 ID
  direction                   TEXT NOT NULL,      -- inbound | outbound
  UNIQUE (channel_key, external_message_id)
);

-- 回调/出站任务队列（去重 + 重试）
CREATE TABLE channel_outbox (
  id            UUID PRIMARY KEY,
  channel_key   TEXT NOT NULL,
  payload       JSONB NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | sending | sent | failed
  attempts      INT  NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

迁移文件按现有风格命名：`0011_add_channels.sql` 等。

---

## 8. 平台接入细节

### 8.1 钉钉（推荐 Stream 模式）

1. 开放平台创建**企业内部应用/机器人** → 获取 `AppKey`/`AppSecret`；申请权限点：`im:message`（获取消息）、`im:chat`、`contact:user`。
2. 开通 **Stream 模式**：gateway 使用钉钉 Stream SDK 建立长连接，订阅消息事件，无需公网。
3. 消息事件类型：单聊 `RobotSingleChatMessage`、群聊 `RobotGroupMessage`（仅 @ 机器人）。
4. 发送：`机器人发送消息` API，`conversationId` 来自事件回调；markdown 内容需转钉钉方言（`#` 标题、`-` 列表语法差异）。
5. 频控：机器人发言按 org 维度限制，gateway 内置令牌桶 + 失败指数退避。

### 8.2 飞书（推荐长连接模式）

1. 开放平台创建企业自建应用 → 开启**机器人**能力 → 获取 `App ID`/`App Secret`。
2. 事件订阅选择**长连接模式**：应用部署时开启 `im.message.receive_v1` 订阅，SDK 建立 WebSocket；无需公网回调。
3. 权限点：`im:message`（获取群组中所有消息）、`im:message.group_at_msg`（获取群组中 @ 机器人消息）、`im:chat`、`contact:user.base:readonly` 等。
4. 发送：`POST /open-apis/im/v1/messages`（`receive_id_type=open_id`）或 `/im/v1/messages/:message_id/reply`。
5. 注意：同一事件可能按 `app_id` 重复推送，用 `event_id` 去重；长连接断线后 SDK 自动重连，server 侧用 outbox 补偿。

### 8.3 企业微信（必须 HTTP 回调）

1. 企业微信管理后台创建自建应用 → 获取 `corpid`、`secret`、`agentid`。
2. 配置接收消息：`URL`（公网 HTTPS）、`Token`、`EncodingAESKey`（43 位，AES-256-CBC）。
3. gateway 实现：
   - **URL 验证**：`msg_signature` + `timestamp` + `nonce` + `echostr` 解密后原样返回。
   - **消息解密**：XML 报文解密 → 解析 `MsgType`（text/image/voice/link/event）、`FromUserName`、`ToUserName`、`MsgId`。
   - **发送**：`message/send` API（`touser`/`toparty`/`totag` 或群 `chatid`），需 access_token 缓存刷新。
4. 主动推送配额：应用级每分钟限量；`channel_outbox` 承担排队与限速。
5. 公网要求：生产环境需可公网访问的 HTTPS（Caddy 反代已具备）；开发环境可用隧道（如 frp/cloudflared）。

---

## 9. 管理后台（admin-web）

| 页面 | 功能 |
| --- | --- |
| 渠道管理 | 新建/编辑/启停渠道；填写 AppKey/Secret/AES 配置；测试连接；查看在线状态。 |
| 渠道日志 | 回调原始报文（脱敏）、归一化消息、出站结果、失败重试。 |
| 身份绑定 | 按渠道列出外部用户与内部用户映射；手动绑定/解绑；影子账号合并。 |
| 会话概览 | 查看渠道会话映射、活跃度、消息量。 |

---

## 10. 安全与合规

1. **验签与加解密**：企微 `msg_signature` + AES 解密；钉钉/飞书回调 token 校验；密钥存 `channels.config`（DB 加密字段），不在前端暴露。
2. **最小权限**：茉莉对"未绑定影子用户"只做保守回答，不读取内部敏感数据；渠道机器人只申请必要权限点。
3. **防注入**：外部内容一律视为数据，markdown 渲染走既有消息格式化管道，禁止拼接命令。
4. **数据驻留**：外部消息原文仅存脱敏摘要（审计），完整原文按渠道保留策略（如 30 天）清理；可配置关闭原文存储。
5. **审计**：`channel_messages` 全量记录收发，支撑追溯与合规。
6. **滥用防护**：单会话频控、全局限流、异常消息风暴告警。

---

## 11. 部署形态

```
现有 compose.yml 扩展（新增 3 个服务）：
  channel-gateway: 1 个进程，内部按 provider 分发（或拆 dingtalk-gateway / feishu-gateway / wecom-gateway）
  server: 增加 channel 模块（同进程）
  admin-web: 增加渠道管理页面
  postgres: 新增迁移

网络要求：
  钉钉：无需公网（Stream）
  飞书：无需公网（长连接）
  企微：需要公网 HTTPS（现有 caddy 反代 → /api/channels/wecom/callback）
```

---

## 12. 分阶段实施路线图

### Phase 1 — MVP：钉钉单渠道打通（约 2 周）

- 范围：钉钉 Stream 接入；私聊 + 群聊 @；茉莉自动接管与直接回复；影子账号；回调日志；admin-web 渠道管理基础页。
- 里程碑：钉钉用户私聊机器人，茉莉完成一次"理解→回复"闭环；群聊 @ 茉莉可回答。
- 交付物：`channel` 模块、`dingtalk-gateway`、迁移 `0011`、渠道管理页。

### Phase 2 — 三渠道齐平（约 2 周）

- 范围：飞书长连接接入、企微 HTTP 回调接入（含 AES 加解密、公网端点）；身份显式绑定；转人工回写 IM；choice 卡片确认。
- 里程碑：三渠道均可完成"私聊接管 + 群 @ + 转人工"。

### Phase 3 — 增强体验（约 2~3 周）

- 范围：异步任务主动汇报与排队；长文/富文本格式翻译；@ 具体人回复（群成员映射）；渠道数据看板；消息风暴告警。
- 里程碑：把 IM 消息转任务、到期催办在钉钉群完成演示。

### Phase 4 — 平台化（按需）

- 范围：双向同步开关；更多渠道（Slack、Teams、微信公众号、WhatsApp）；渠道 SDK 插件化；自定义接管策略（哪些会话交给茉莉、哪些直接转人）。
- 里程碑：渠道接入只需新增一个 gateway 插件 + 配置，不动 server 核心。

---

## 13. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 企微主动推送配额低 | 长任务汇报延迟/失败 | 出站队列 + 配额预算 + 失败降级为"在即应内查看" |
| 三家 markdown 方言不同 | 回复排版错乱 | 统一中间格式，各 gateway 做方言转换器（Phase 3） |
| 身份重复/冲突 | 数据串人 | `external_user_id` 唯一键 + 管理员绑定优先 + 审计 |
| 机器人间循环对话 | 资源浪费/风暴 | 机器人消息不入流 + 出站不触发入站 + 环检测 |
| 平台 API 变更 | 渠道中断 | gateway 版本隔离 + 渠道级熔断 + 告警 |
| 隐私合规（原文存储） | 合规风险 | 摘要化存储 + 保留期策略 + 企业开关 |
| 影子账号权限过大 | 数据泄露 | 影子用户默认低权限，绑定正式账号后才放开 |

---

## 14. 工作量估算（粗）

| 模块 | 估算 |
| --- | --- |
| server channel 模块（模型/迁移/归一化/派发/幂等） | 5~6 人日 |
| 钉钉 gateway（Stream） | 2~3 人日 |
| 飞书 gateway（长连接） | 2~3 人日 |
| 企微 gateway（回调+AES） | 2~3 人日 |
| 身份绑定与影子账号 | 2 人日 |
| admin-web 渠道页/日志/绑定 | 3~4 人日 |
| 转人工/回写/choice | 2 人日 |
| 测试与联调（三家开放平台） | 3~4 人日 |
| **合计** | **约 21~25 人日（Phase 1+2 约 4 周）** |

---

## 15. 建议的第一步

从 **Phase 1 的钉钉 MVP** 开始，理由：

1. 钉钉有官方 **Stream 模式**，不依赖公网回调，联调环境要求最低。
2. 单渠道闭环可以完整验证"接管"语义（收→理解→回→转人），验证通过后再复制到飞书/企微。
3. 飞书/企微的接入只是新增 gateway + 配置，架构上不阻塞。

建议先产出：渠道模块表结构评审 → 钉钉 gateway 骨架 → 一条消息端到端打通 → 再评估是否进入 Phase 2。
