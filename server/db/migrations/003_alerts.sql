-- v7 — AI & Smart Detection
-- Alert rules, push subscriptions, and alert event log.

CREATE TABLE IF NOT EXISTS alert_rules (
  slot_id          UUID PRIMARY KEY REFERENCES camera_slots(id) ON DELETE CASCADE,
  enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  object_classes   TEXT[]  NOT NULL DEFAULT '{}',
  min_confidence   REAL    NOT NULL DEFAULT 0.7,
  cooldown_seconds INTEGER NOT NULL DEFAULT 60,
  email_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  email_address    TEXT,
  push_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           SERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
  ON push_subscriptions (user_id);

CREATE TABLE IF NOT EXISTS alert_log (
  id              SERIAL PRIMARY KEY,
  slot_id         UUID REFERENCES camera_slots(id) ON DELETE SET NULL,
  detected_class  TEXT NOT NULL,
  confidence      REAL NOT NULL,
  alerted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  push_sent       BOOLEAN NOT NULL DEFAULT FALSE,
  email_sent      BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_alert_log_slot_id_alerted_at
  ON alert_log (slot_id, alerted_at DESC);
