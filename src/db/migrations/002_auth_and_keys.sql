-- Add refresh_tokens table and update signing_keys for key rotation

-- Refresh tokens for JWT auth
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES admin_users(user_id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add epoch tracking to signing_keys (already in initial schema, but ensuring)
ALTER TABLE signing_keys 
  ADD COLUMN IF NOT EXISTS epoch_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS epoch_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Update existing signing_keys to have proper epochs
UPDATE signing_keys SET 
  epoch_start = COALESCE(epoch_start, created_at),
  epoch_end = COALESCE(epoch_end, created_at + INTERVAL '30 days'),
  is_active = COALESCE(is_active, true);

-- Index for refresh tokens
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);