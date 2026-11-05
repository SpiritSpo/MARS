BEGIN;
CREATE TABLE IF NOT EXISTS finance_machines (
 id text PRIMARY KEY,
 display_name text NOT NULL,
 machine_type text NOT NULL,
 plate text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS finance_imports (
 id uuid PRIMARY KEY,
 sha256 char(64) NOT NULL UNIQUE,
 filename text NOT NULL,
 period char(7) NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 status text NOT NULL CHECK (status IN ('staged','approved','rejected')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS finance_monthly (
 id bigserial PRIMARY KEY,
 import_id uuid NOT NULL REFERENCES finance_imports(id),
 machine_id text NOT NULL REFERENCES finance_machines(id),
 period char(7) NOT NULL,
 revenue numeric(16,2) NOT NULL CHECK (revenue >= 0),
 fuel numeric(16,2) NOT NULL CHECK (fuel >= 0),
 repairs numeric(16,2) NOT NULL CHECK (repairs >= 0),
 payroll numeric(16,2) NOT NULL CHECK (payroll >= 0),
 other_expenses numeric(16,2) NOT NULL CHECK (other_expenses >= 0),
 reported_expenses numeric(16,2) NOT NULL CHECK (reported_expenses >= 0),
 reported_profit numeric(16,2) NOT NULL,
 review_status text NOT NULL CHECK (review_status IN ('ok','needs_review')),
 UNIQUE(import_id,machine_id,period)
);
CREATE INDEX IF NOT EXISTS idx_finance_monthly_period ON finance_monthly(period,machine_id);
COMMIT;
