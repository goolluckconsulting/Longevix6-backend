-- Migration 001: Add idempotency_key to orders table
-- Run this once against any existing database.
-- The schema.sql already includes this column for fresh installations.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64);

-- Apply the UNIQUE constraint only if it does not already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_idempotency_key_key'
      AND conrelid = 'orders'::regclass
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_idempotency_key_key UNIQUE (idempotency_key);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_orders_idempotency_key ON orders(idempotency_key);
