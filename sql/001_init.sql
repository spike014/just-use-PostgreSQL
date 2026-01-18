-- 表结构参考文章：缓存、pub/sub、队列、sessions、限流。
-- 注意：cache 使用 UNLOGGED（更快，但崩溃后不保留）。

CREATE UNLOGGED TABLE IF NOT EXISTS cache (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache (expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS jobs (
  id bigserial PRIMARY KEY,
  queue text NOT NULL,
  payload jsonb NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_queue_scheduled
  ON jobs (queue, scheduled_at)
  WHERE attempts < max_attempts;

CREATE TABLE IF NOT EXISTS rate_limits (
  user_id int PRIMARY KEY,
  request_count int NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS logs (
  id bigserial PRIMARY KEY,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 仅通知新行 id（payload 更小，消费者回表查询完整数据）。
CREATE OR REPLACE FUNCTION notify_new_log() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('logs_new', NEW.id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS logs_inserted ON logs;
CREATE TRIGGER logs_inserted
AFTER INSERT ON logs
FOR EACH ROW
EXECUTE FUNCTION notify_new_log();
