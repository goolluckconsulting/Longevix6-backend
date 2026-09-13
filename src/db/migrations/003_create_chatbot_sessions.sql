-- Migration 003: Create chatbot_sessions table
-- Strictly additive. Does not modify or drop any existing tables, columns, or indexes.

CREATE TABLE IF NOT EXISTS chatbot_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('mock', 'whatsapp', 'instagram')),
  sender_id VARCHAR(100) NOT NULL,
  current_step VARCHAR(50) NOT NULL DEFAULT 'start',
  selected_brand VARCHAR(50),
  selected_service VARCHAR(100),
  selected_sub_service VARCHAR(100),
  patient_name VARCHAR(255),
  patient_phone VARCHAR(20),
  preferred_time_slot VARCHAR(50),
  is_human_handoff BOOLEAN NOT NULL DEFAULT FALSE,
  handoff_at TIMESTAMP WITH TIME ZONE,
  last_interaction_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_chatbot_sessions_channel_sender UNIQUE (channel, sender_id)
);

-- Query pattern indexes
CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_sender_id ON chatbot_sessions(sender_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_last_interaction ON chatbot_sessions(last_interaction_at DESC);
CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_handoff ON chatbot_sessions(is_human_handoff, handoff_at DESC);
