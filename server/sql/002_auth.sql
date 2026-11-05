-- Development only. Do not deploy before HTTPS, login rate limiting and migration review.
CREATE TABLE IF NOT EXISTS mars_users (
 id text PRIMARY KEY CHECK (id ~ '^[a-zA-Z0-9_-]{3,80}$'),
 login text NOT NULL UNIQUE,
 role text NOT NULL CHECK (role IN ('owner','director','accountant','dispatcher','mechanic','operator')),
 password_hash text NOT NULL,
 active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS mars_sessions (
 token_hash char(64) PRIMARY KEY,
 user_id text NOT NULL REFERENCES mars_users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mars_sessions_expiry_idx ON mars_sessions(expires_at);
