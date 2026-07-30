export const MESSAGE_CACHE_SCHEMA_V1 = `
  CREATE TABLE IF NOT EXISTS cached_messages (
    -- Server 的稳定隔离键，由规范化地址和 Server 标识共同确定，避免不同部署间数据串用。
    server_key TEXT NOT NULL,
    -- 当前登录用户的服务端用户 ID，用于同一 Server 上不同账号之间的数据隔离。
    user_id TEXT NOT NULL,
    -- 消息所属的会话 ID，是读取、分页和淘汰缓存的基本作用域。
    conversation_id TEXT NOT NULL,
    -- 消息的服务端唯一 ID；与前三个作用域字段共同组成记录主键。
    message_id TEXT NOT NULL,
    -- 消息在会话内单调递增的服务端序号，用于排序、增量同步和缺口检测。
    seq INTEGER NOT NULL,
    -- Reaction 数据的版本号；只接受不低于当前版本的更新，防止旧事件覆盖新状态。
    reaction_version INTEGER NOT NULL DEFAULT 0,
    -- payload_json 所遵循的客户端消息结构版本，用于识别不兼容或损坏的缓存记录。
    payload_schema_version INTEGER NOT NULL,
    -- 完整消息对象序列化后的 JSON；缓存命中后由 Renderer 反序列化并校验。
    payload_json TEXT NOT NULL,
    -- payload_json 的 UTF-8 字节数，用于容量统计、配额判断和 LRU 淘汰。
    payload_bytes INTEGER NOT NULL,
    -- 消息的服务端创建时间，保留原始 ISO 时间字符串供消息模型恢复使用。
    created_at TEXT NOT NULL,
    -- 本记录最近一次写入缓存的 Unix 毫秒时间戳，用于缓存维护和诊断。
    cached_at INTEGER NOT NULL,
    -- 同一 Server、用户和会话内，message_id 唯一标识一条缓存消息。
    PRIMARY KEY (server_key, user_id, conversation_id, message_id)
  );

  -- 保证同一会话内 seq 唯一，并加速按服务端序号定位消息。
  CREATE UNIQUE INDEX IF NOT EXISTS cached_messages_by_seq
  ON cached_messages (server_key, user_id, conversation_id, seq);

  -- 加速读取会话最新消息，以及按 seq 向前分页。
  CREATE INDEX IF NOT EXISTS cached_messages_recent
  ON cached_messages (server_key, user_id, conversation_id, seq DESC);

  CREATE TABLE IF NOT EXISTS message_sync_state (
    -- Server 的稳定隔离键，与 cached_messages.server_key 含义一致。
    server_key TEXT NOT NULL,
    -- 当前登录用户的服务端用户 ID，与 cached_messages.user_id 含义一致。
    user_id TEXT NOT NULL,
    -- 当前同步状态所属的会话 ID。
    conversation_id TEXT NOT NULL,
    -- 已通过 HTTP 连续确认同步到的最大 seq；Realtime 消息不会单独推进该水位。
    http_synced_through_seq INTEGER NOT NULL DEFAULT 0,
    -- 当前缓存中最早消息的 seq；缓存为空时为 NULL。
    oldest_cached_seq INTEGER,
    -- 是否可能继续通过 before 接口获取更早消息；SQLite 以 0/1 表示布尔值。
    has_more_before INTEGER NOT NULL DEFAULT 1,
    -- 最近一次成功完成 HTTP 同步的 Unix 毫秒时间戳；从未同步时为 NULL。
    last_synced_at INTEGER,
    -- 最近一次访问该会话缓存的 Unix 毫秒时间戳，用于会话级 LRU 淘汰。
    last_accessed_at INTEGER NOT NULL,
    -- 每个 Server、用户和会话只保存一份同步状态。
    PRIMARY KEY (server_key, user_id, conversation_id)
  );

  -- 加速从最久未访问的会话开始执行 LRU 淘汰。
  CREATE INDEX IF NOT EXISTS message_sync_state_lru
  ON message_sync_state (last_accessed_at ASC);

  CREATE TABLE IF NOT EXISTS message_cache_stats (
    -- Server 的稳定隔离键，与 cached_messages.server_key 含义一致。
    server_key TEXT NOT NULL,
    -- 当前登录用户的服务端用户 ID，与 cached_messages.user_id 含义一致。
    user_id TEXT NOT NULL,
    -- 当前统计数据所属的会话 ID。
    conversation_id TEXT NOT NULL,
    -- 当前会话已落盘的消息记录数量，避免每次统计都扫描消息表。
    message_count INTEGER NOT NULL DEFAULT 0,
    -- 当前会话所有 payload_json 的 UTF-8 字节数之和，用于配额和占用展示。
    payload_bytes INTEGER NOT NULL DEFAULT 0,
    -- 每个 Server、用户和会话只保存一行聚合统计。
    PRIMARY KEY (server_key, user_id, conversation_id)
  );

  CREATE TABLE IF NOT EXISTS message_cache_metadata (
    -- 全局元数据名称，例如 payload_schema_version。
    key TEXT PRIMARY KEY,
    -- 元数据对应的整数值；用于记录不属于单个会话的缓存版本信息。
    value INTEGER NOT NULL
  );
`

export const MESSAGE_CACHE_SCHEMA_V2 = `
  CREATE TABLE IF NOT EXISTS message_cache_generations (
    -- 清理作用域的稳定键，可表示 global、server、user 或 conversation 作用域。
    scope_key TEXT PRIMARY KEY,
    -- 作用域当前代数；每次清理时递增，使清理前启动的迟到写入失效。
    generation INTEGER NOT NULL DEFAULT 0
  );
`
