-- Migration: Budgets and Recurring Bills tables
CREATE TABLE IF NOT EXISTS budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category VARCHAR(100) NOT NULL,
  month VARCHAR(7) NOT NULL,           -- 'YYYY-MM', e.g. '2026-08'
  limit_amount NUMERIC(15, 2) NOT NULL,
  alert_threshold_percent INTEGER DEFAULT 80,
  is_alerted_80 BOOLEAN DEFAULT false,
  is_alerted_100 BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_budgets_category_month UNIQUE(category, month)
);

CREATE TABLE IF NOT EXISTS recurring_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_name VARCHAR(150) NOT NULL,
  amount NUMERIC(15, 2) NOT NULL,
  due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  category VARCHAR(100) DEFAULT 'Tagihan & Utilitas',
  payment_method VARCHAR(50) DEFAULT 'Cash',
  reminder_days_before INTEGER DEFAULT 3,
  last_paid_period VARCHAR(7),         -- 'YYYY-MM', e.g. '2026-08'
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_budgets_month ON budgets(month);
CREATE INDEX IF NOT EXISTS idx_bills_status ON recurring_bills(status);
