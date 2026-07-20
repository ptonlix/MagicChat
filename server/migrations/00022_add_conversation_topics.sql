-- +goose Up
ALTER TABLE conversations
  DROP CONSTRAINT conversations_kind_check;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_kind_check
  CHECK (kind IN ('direct', 'group', 'app', 'topic'));

CREATE TABLE conversation_topics (
  conversation_id uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  parent_conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  source_message_id uuid NOT NULL REFERENCES message_registry(id) ON DELETE RESTRICT,
  source_message_seq bigint NOT NULL,
  source_message_body jsonb NOT NULL,
  source_message_summary text NOT NULL DEFAULT '',
  source_sender_type text NOT NULL,
  source_sender_id uuid,
  source_sender_name text NOT NULL DEFAULT '',
  source_message_created_at timestamptz NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by_app_id uuid REFERENCES apps(id) ON DELETE RESTRICT,
  archived_at timestamptz,
  archived_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  archived_by_app_id uuid REFERENCES apps(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT conversation_topics_parent_check CHECK (conversation_id <> parent_conversation_id),
  CONSTRAINT conversation_topics_source_sender_type_check CHECK (source_sender_type IN ('user', 'app')),
  CONSTRAINT conversation_topics_source_sender_id_check CHECK (source_sender_id IS NOT NULL),
  CONSTRAINT conversation_topics_source_seq_check CHECK (source_message_seq >= 1),
  CONSTRAINT conversation_topics_source_message_unique UNIQUE (source_message_id)
);

CREATE INDEX conversation_topics_parent_conversation_id_index
  ON conversation_topics (parent_conversation_id, conversation_id);

CREATE INDEX conversation_topics_archived_at_index
  ON conversation_topics (archived_at);

CREATE INDEX conversation_topics_created_by_app_id_index
  ON conversation_topics (created_by_app_id);

CREATE TABLE conversation_topic_participants (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  participant_type text NOT NULL,
  participant_id uuid NOT NULL,
  joined_reason text NOT NULL,
  joined_at timestamptz NOT NULL,
  history_visible_from_seq bigint NOT NULL DEFAULT 1,
  last_read_message_id uuid,
  last_read_seq bigint NOT NULL DEFAULT 0,
  last_mentioned_seq bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (conversation_id, participant_type, participant_id),
  CONSTRAINT conversation_topic_participants_type_check CHECK (participant_type IN ('user', 'app')),
  CONSTRAINT conversation_topic_participants_reason_check CHECK (joined_reason IN ('creator', 'automatic', 'manual', 'message', 'mention')),
  CONSTRAINT conversation_topic_participants_visible_seq_check CHECK (history_visible_from_seq >= 1),
  CONSTRAINT conversation_topic_participants_read_seq_check CHECK (last_read_seq >= 0),
  CONSTRAINT conversation_topic_participants_mentioned_seq_check CHECK (last_mentioned_seq >= 0)
);

CREATE INDEX conversation_topic_participants_member_index
  ON conversation_topic_participants (participant_type, participant_id, conversation_id);

-- +goose Down
DELETE FROM conversations
WHERE kind = 'topic';

DROP TABLE conversation_topic_participants;
DROP TABLE conversation_topics;

ALTER TABLE conversations
  DROP CONSTRAINT conversations_kind_check;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_kind_check
  CHECK (kind IN ('direct', 'group', 'app'));
