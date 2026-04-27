-- Migration: Add payload column to webhook_logs
-- Persists the webhook body so retries survive server restarts.
-- Previously the payload lived only in the in-memory invoicePayloads Map.
-- Run against production DB before deploying this version.

BEGIN;

ALTER TABLE webhook_logs
  ADD COLUMN IF NOT EXISTS payload TEXT;

COMMIT;
