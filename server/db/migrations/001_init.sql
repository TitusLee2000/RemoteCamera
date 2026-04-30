DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'operator', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role         user_role NOT NULL DEFAULT 'viewer',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS camera_slots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  code         TEXT UNIQUE NOT NULL,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "session" (
  "sid"    VARCHAR NOT NULL COLLATE "default",
  "sess"   JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

CREATE TABLE IF NOT EXISTS recordings (
  id           TEXT PRIMARY KEY,
  slot_id      UUID REFERENCES camera_slots(id) ON DELETE SET NULL,
  filename     TEXT NOT NULL,
  start_time   TIMESTAMPTZ NOT NULL,
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  file_size    INTEGER NOT NULL DEFAULT 0,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
