-- +goose Up
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  avatar text NOT NULL DEFAULT '',
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  is_personal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  CONSTRAINT projects_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX IF NOT EXISTS projects_one_personal_per_owner
  ON projects (owner_user_id)
  WHERE is_personal AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS projects_owner_user_id_index
  ON projects (owner_user_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS projects_updated_at_index
  ON projects (updated_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS project_groups (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  linked_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS project_groups_conversation_id_index
  ON project_groups (conversation_id, project_id);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'todo',
  priority smallint NOT NULL DEFAULT 2,
  assignee_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  start_date date,
  due_date date,
  labels text[] NOT NULL DEFAULT '{}',
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  completed_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  CONSTRAINT tasks_title_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 240),
  CONSTRAINT tasks_status_check CHECK (status IN ('todo', 'in_progress', 'done', 'canceled')),
  CONSTRAINT tasks_priority_check CHECK (priority BETWEEN 1 AND 3),
  CONSTRAINT tasks_date_order_check CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date),
  CONSTRAINT tasks_completed_at_check CHECK (
    (status = 'done' AND completed_at IS NOT NULL)
    OR (status <> 'done' AND completed_at IS NULL)
  ),
  CONSTRAINT tasks_canceled_at_check CHECK (
    (status = 'canceled' AND canceled_at IS NOT NULL)
    OR (status <> 'canceled' AND canceled_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS tasks_project_updated_at_index
  ON tasks (project_id, updated_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tasks_status_index
  ON tasks (project_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tasks_assignee_user_id_index
  ON tasks (project_id, assignee_user_id)
  WHERE deleted_at IS NULL AND assignee_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_start_date_index
  ON tasks (project_id, start_date)
  WHERE deleted_at IS NULL AND start_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_due_date_index
  ON tasks (project_id, due_date)
  WHERE deleted_at IS NULL AND due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_labels_gin_index ON tasks USING gin (labels)
  WHERE deleted_at IS NULL;

INSERT INTO projects (
  id,
  name,
  description,
  avatar,
  owner_user_id,
  created_by_user_id,
  is_personal,
  created_at,
  updated_at
)
SELECT gen_random_uuid(), '个人工作区', '', '', id, id, TRUE, created_at, updated_at
FROM users
ON CONFLICT (owner_user_id) WHERE is_personal AND deleted_at IS NULL DO NOTHING;

-- +goose Down
DROP TABLE tasks;
DROP TABLE project_groups;
DROP TABLE projects;
