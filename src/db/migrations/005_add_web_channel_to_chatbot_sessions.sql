-- Migration 005: Add 'web' channel to chatbot_sessions
-- Preserves existing session data and UNIQUE(channel, sender_id) constraint.

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'chatbot_sessions'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%channel%'
    ) LOOP
        EXECUTE 'ALTER TABLE chatbot_sessions DROP CONSTRAINT ' || quote_ident(r.conname);
    END LOOP;
END $$;

ALTER TABLE chatbot_sessions
  ADD CONSTRAINT chatbot_sessions_channel_check
  CHECK (channel IN ('mock', 'web', 'whatsapp', 'instagram'));
