-- Fictional demo data only. Never store real accounting information here.
CREATE TABLE IF NOT EXISTS mars_demo_state (
 id integer PRIMARY KEY CHECK (id=1),
 state jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
