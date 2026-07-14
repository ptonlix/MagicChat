# 项目与任务服务端设计

日期：2026-07-10

## 目标

- 为项目页面提供真实的项目、群组关系、动态成员和任务 API。
- 每个用户拥有一个不可删除的个人工作区。
- 协作项目通过关联群组实时派生访问成员，不维护独立项目成员表。
- 任务支持状态、数字优先级、单用户负责人、日期、Markdown 描述和标签。
- 延续现有 Go、Echo、GORM、Postgres、Goose 和统一 JSON envelope 约定。

## 非目标

- 不实现 Owner 转让。
- 不实现项目或任务恢复 API。
- 不实现任务操作历史、附件、子任务、依赖、提醒或重复规则。
- 不实现 App/Agent 项目权限或任务负责人。
- 不实现项目与任务 WebSocket 事件。
- 不在本阶段接入前端真实 API。

## 架构

沿用当前服务端结构：

- `server/migrations/` 保存显式 SQL migration、约束和索引。
- `server/internal/store/models.go` 保存 GORM 模型和枚举常量。
- `server/internal/httpserver/project_handlers.go` 负责项目、群组关联和动态成员 API。
- `server/internal/httpserver/task_handlers.go` 负责任务 API。
- Handler 直接使用注入的 GORM DB，复杂写操作使用事务。
- 权限查询封装为文件内共享 helper，所有入口使用同一判定。

不增加 repository 或 service 层，保持与现有会话 API 一致。

## 数据库

### projects

```text
id                  uuid PRIMARY KEY
name                text NOT NULL
description         text NOT NULL DEFAULT ''
avatar              text NOT NULL DEFAULT ''
owner_user_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT
created_by_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT
is_personal         boolean NOT NULL DEFAULT false
created_at          timestamptz NOT NULL
updated_at          timestamptz NOT NULL
deleted_at          timestamptz
```

约束和索引：

- 项目名称去除首尾空格后长度为 1 到 120 个字符。
- 每个 Owner 最多有一个 `is_personal = true` 的项目。
- 为 Owner 的未删除项目和项目更新时间建立索引。
- 任务或项目群组关系发生变化时同步更新项目 `updated_at`。

普通项目和个人工作区使用同一张表。个人工作区通过 `is_personal` 施加 API 行为限制。

### project_groups

```text
project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE
conversation_id   uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE
linked_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT
created_at        timestamptz NOT NULL
PRIMARY KEY (project_id, conversation_id)
```

为 `conversation_id` 建立反向索引。关系只允许指向 `kind = group` 且 `status = active` 的会话，该跨表规则由事务内业务校验保证。

### tasks

```text
id                  uuid PRIMARY KEY
project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE
title               text NOT NULL
description         text NOT NULL DEFAULT ''
status              text NOT NULL DEFAULT 'todo'
priority            smallint NOT NULL DEFAULT 2
assignee_user_id    uuid REFERENCES users(id) ON DELETE SET NULL
start_date          date
due_date            date
labels              text[] NOT NULL DEFAULT '{}'
created_by_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT
completed_at        timestamptz
canceled_at         timestamptz
created_at          timestamptz NOT NULL
updated_at          timestamptz NOT NULL
deleted_at          timestamptz
```

约束：

- 标题去除首尾空格后长度为 1 到 240 个字符。
- `status` 只能是 `todo`、`in_progress`、`done`、`canceled`。
- `priority` 只能是 `1`、`2`、`3`，分别对应低、中、高。
- 开始日期和截止日期同时存在时，开始日期不能晚于截止日期。
- `done` 只有 `completed_at` 有值。
- `canceled` 只有 `canceled_at` 有值。
- `todo` 和 `in_progress` 的两个结束时间都为空。

索引：

- 项目内未删除任务按更新时间查询。
- 项目内按状态、负责人、开始日期和截止日期查询。
- `labels` 使用 GIN 索引。

标签规则：

- 最多 20 个。
- 每个标签去除首尾空格后长度为 1 到 32 个字符。
- 请求内大小写不敏感去重，保留首次出现的文本。

## 个人工作区

- 管理员创建用户时，在同一事务中创建个人工作区。
- Migration 为所有已有用户回填个人工作区。
- 名称固定为“个人工作区”。
- 不能删除、关联群组或通过客户端创建第二个。
- Owner 为对应用户且不支持转让。
- 数据库 `avatar` 保持空字符串，API 响应使用 Owner 当前用户头像。
- 用户被禁用时数据保留，但用户不能登录访问。

## 权限

有效项目访问条件：

```text
项目 deleted_at IS NULL
AND (
  当前用户是 owner_user_id
  OR 当前用户是任一关联 active 群组中的 active user 成员
)
```

- 只计算 `conversation_members.member_type = user` 且 `left_at IS NULL` 的成员。
- App 成员不获得项目权限。
- 同一用户来自多个群组时按用户 ID 去重。
- API 响应动态返回 `current_user_role = owner | member`，不写入数据库。

Owner 专属操作：

- 修改项目名称、描述和头像。
- 绑定或解绑群组。
- 软删除协作项目。

Owner 和派生成员都可以：

- 查看项目、群组和动态成员。
- 创建、查看、修改、变更状态和软删除任意任务。

绑定群组只校验操作者是项目 Owner，不要求操作者在目标群中或拥有群角色。个人工作区禁止绑定。

不可访问的项目和任务统一返回 404，避免泄露资源存在性。能访问项目但执行 Owner 专属操作时返回 403。

## 任务规则

- 创建请求只有标题必填。
- 状态省略时默认 `todo`。
- 优先级省略时默认 `2`。
- 描述默认空字符串，标签默认空数组。
- 负责人、开始日期和截止日期默认 `null`。
- 负责人非空时必须是启用用户，并且当前对项目有访问权。
- 用户后来失去项目访问权时保留历史负责人，但不能再被新指派。
- `project_id` 和 `created_by_user_id` 创建后不可修改。
- 状态允许在四个值之间任意流转。
- 进入 `done` 时设置 `completed_at` 并清空 `canceled_at`。
- 进入 `canceled` 时设置 `canceled_at` 并清空 `completed_at`。
- 进入 `todo` 或 `in_progress` 时清空两个结束时间。
- 状态没有变化时保留当前结束时间。
- `canceled` 是业务状态，软删除使用 `deleted_at`，两者不等价。

## 项目 API

```text
GET    /api/client/projects
POST   /api/client/projects
GET    /api/client/projects/:project_id
PATCH  /api/client/projects/:project_id
DELETE /api/client/projects/:project_id

GET    /api/client/projects/:project_id/groups
PUT    /api/client/projects/:project_id/groups/:group_id
DELETE /api/client/projects/:project_id/groups/:group_id

GET    /api/client/projects/:project_id/members
```

创建项目请求：

```json
{
  "name": "Dianbao 研发",
  "description": "项目说明",
  "avatar": "",
  "group_ids": ["group-id-1", "group-id-2"]
}
```

- `name` 必填。
- 其他字段可省略。
- `group_ids` 可为空，创建人自动成为 Owner。
- 客户端不能提交 `is_personal` 或 `owner_user_id`。
- 项目和可选群组关联在同一事务中创建。

后续绑定使用幂等 `PUT`。解绑使用 `DELETE`。两者只允许项目 Owner 调用。

## 群组创建扩展

现有创建群组请求增加可选字段：

```json
{
  "name": "研发群",
  "member_ids": ["user-id"],
  "project_ids": ["project-id-1"]
}
```

- `project_ids` 可省略或为空。
- 当前用户必须是每个目标项目的 Owner。
- 个人工作区不能绑定。
- 群组、成员、系统消息和项目关系在同一事务中创建。
- 任一项目无效或无权绑定时整个请求失败。
- 群组解散时删除对应 `project_groups`，并更新受影响项目时间。

## 任务 API

```text
GET    /api/client/projects/:project_id/tasks
POST   /api/client/projects/:project_id/tasks
GET    /api/client/projects/:project_id/tasks/:task_id
PATCH  /api/client/projects/:project_id/tasks/:task_id
DELETE /api/client/projects/:project_id/tasks/:task_id
```

创建任务请求：

```json
{
  "title": "完成项目 API 设计",
  "description": "使用 **Markdown**",
  "status": "todo",
  "priority": 2,
  "assignee_user_id": null,
  "start_date": null,
  "due_date": "2026-07-18",
  "labels": ["后端", "API"]
}
```

PATCH 语义：

- 字段缺失表示不修改。
- `null` 清空负责人、开始日期或截止日期。
- 空数组清空标签。
- 不接受项目 ID 和创建人 ID。
- 标题如果出现，去除首尾空格后不能为空。

任务列表筛选参数：

```text
keyword
status
priority
assignee_user_id
label
start_date_from
start_date_to
due_date_from
due_date_to
limit
cursor
```

- `keyword` 搜索标题和 Markdown 描述。
- 多个状态和优先级使用逗号分隔。
- 第一版一次过滤一个标签。
- 所有查询默认过滤软删除任务。

## 响应

所有接口沿用：

```json
{
  "success": true,
  "data": {}
}
```

项目响应包含：

- 基本字段、Owner 用户摘要和 `current_user_role`。
- `group_count`、动态 `member_count`。
- `task_counts`，分别返回四个状态及总数。
- 创建和更新时间。

项目列表把个人工作区独立返回：

```json
{
  "personal_project": {},
  "projects": [],
  "next_cursor": null
}
```

动态成员响应包含用户摘要、`owner | member` 角色和去重后的 `source_group_ids`。

任务响应包含完整任务字段、负责人和创建人用户摘要。负责人可以为 `null`，标签始终返回数组，日期使用 `YYYY-MM-DD`，时间戳使用 RFC3339。

## 分页

- 项目、项目群组、动态成员和任务列表使用 cursor 分页。
- 默认 `limit = 50`，最大 `limit = 100`。
- cursor 是服务端生成的不透明字符串。
- 协作项目和任务按 `updated_at DESC, id DESC` 排序。
- 项目群组按关联的 `created_at DESC, conversation_id DESC` 排序。
- 动态成员按显示名称和用户 ID 升序排序。
- 无下一页时 `next_cursor = null`。
- 个人工作区不进入协作项目分页。

## 错误

- `400 invalid_request`：请求格式、字段、日期、标签或枚举值不合法。
- `401 unauthorized`：未登录。
- `403 forbidden`：可访问项目，但没有 Owner 权限。
- `404 not_found`：资源不存在或当前用户无权知道其存在。
- `409 conflict`：唯一约束或并发关系冲突。
- `500 internal_error`：数据库或服务端异常。

## 并发与事务

- 创建项目及可选群组关系使用一个事务。
- 创建群组及可选项目关系使用一个事务。
- 创建、更新、删除任务时在同一事务中更新项目 `updated_at`。
- 绑定和解绑群组时在同一事务中更新项目 `updated_at`。
- `PUT` 群组关联幂等。
- 第一版任务 PATCH 使用最后写入覆盖，不实现乐观锁。

## 测试

- Migration 和 GORM 模型约束测试。
- 个人工作区回填及新用户自动创建测试。
- 项目 Owner 与群组派生权限测试。
- 项目创建、更新、删除、绑定和解绑群组测试。
- 群组创建时绑定项目及事务回滚测试。
- 任务最小创建、完整创建、更新、任意状态流转和软删除测试。
- 负责人、日期、标签和筛选验证测试。
- cursor 分页和不可见资源 404 测试。
- 运行 `go test ./...`、`go vet ./...`、migration 测试和 API 文档生成。
