-- WA-Agent Initial Database Schema for Supabase

-- 1. Users Table (Access Control & Roles)
CREATE TABLE IF NOT EXISTS users (
  phone_number VARCHAR(30) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'member', -- 'super_admin', 'admin', 'member'
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'pending', 'blocked'
  target_sheet_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Transactions Table
CREATE TABLE IF NOT EXISTS transactions (
  id VARCHAR(50) PRIMARY KEY, -- e.g. TRX-20260820-001 or UUID
  user_phone VARCHAR(30) NOT NULL REFERENCES users(phone_number) ON DELETE CASCADE,
  user_name VARCHAR(100) NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  merchant VARCHAR(150) NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT 'Lain-lain',
  subtotal NUMERIC(15, 2) NOT NULL DEFAULT 0,
  tax NUMERIC(15, 2) NOT NULL DEFAULT 0,
  discount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(15, 2) NOT NULL,
  payment_method VARCHAR(50) DEFAULT 'Cash',
  raw_text TEXT,
  gdrive_file_id VARCHAR(255),
  gdrive_web_view_link TEXT,
  gdrive_download_link TEXT,
  gsheet_row_index INTEGER,
  status VARCHAR(30) NOT NULL DEFAULT 'recorded', -- 'recorded', 'reconciled', 'cancelled'
  confidence_score NUMERIC(5, 2) DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Receipt Items Breakdown Table
CREATE TABLE IF NOT EXISTS receipt_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id VARCHAR(50) NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  item_name VARCHAR(255) NOT NULL,
  qty NUMERIC(10, 2) NOT NULL DEFAULT 1,
  price NUMERIC(15, 2) NOT NULL,
  total_price NUMERIC(15, 2) NOT NULL,
  category VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Chat Logs Table
CREATE TABLE IF NOT EXISTS chat_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_phone VARCHAR(30) NOT NULL,
  user_name VARCHAR(100),
  message_type VARCHAR(30) NOT NULL, -- 'text', 'image', 'audio', 'document'
  direction VARCHAR(20) NOT NULL, -- 'inbound', 'outbound'
  content TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for Fast Querying
CREATE INDEX IF NOT EXISTS idx_transactions_user_phone ON transactions(user_phone);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
CREATE INDEX IF NOT EXISTS idx_receipt_items_transaction_id ON receipt_items(transaction_id);
CREATE INDEX IF NOT EXISTS idx_chat_logs_user_phone ON chat_logs(user_phone);
