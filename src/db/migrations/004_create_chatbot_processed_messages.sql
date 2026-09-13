-- Migration 004: Create chatbot_processed_messages table for Meta message deduplication
-- Strictly additive. Does not modify or drop any existing tables, columns, or indexes.

CREATE TABLE IF NOT EXISTS chatbot_processed_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('whatsapp', 'instagram')),
  message_id VARCHAR(128) NOT NULL,
  sender_id VARCHAR(100) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_chatbot_processed_messages_channel_msg UNIQUE (channel, message_id)
);

CREATE INDEX IF NOT EXISTS idx_chatbot_processed_messages_created ON chatbot_processed_messages(created_at DESC);
