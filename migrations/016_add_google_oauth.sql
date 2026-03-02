-- Migration 016: Add Google OAuth support to users table
-- Adds google_id (unique token from Google) and avatar_url columns.
-- password_hash is left nullable so existing accounts are unaffected;
-- Google-only accounts will have NULL password_hash.

ALTER TABLE users ADD COLUMN google_id TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;

-- Unique index so two accounts cannot share the same Google ID
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users (google_id)
    WHERE google_id IS NOT NULL;
