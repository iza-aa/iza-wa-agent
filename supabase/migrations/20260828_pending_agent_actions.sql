-- Migration: Pending Agent Actions for Meta WA True AI Agent
-- Supports Human-in-the-Loop confirmation state machine

CREATE TABLE IF NOT EXISTS pending_agent_actions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_phone VARCHAR(30) NOT NULL,
  user_name VARCHAR(100),
  action_type VARCHAR(50) NOT NULL DEFAULT 'CREATE_TRANSACTION',
  payload JSONB NOT NULL DEFAULT '{}',
  media_url TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pending_agent_actions_user_status 
  ON pending_agent_actions(user_phone, status);

CREATE INDEX IF NOT EXISTS idx_pending_agent_actions_expires 
  ON pending_agent_actions(expires_at);
