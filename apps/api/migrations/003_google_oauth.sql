-- Migration 003: Google OAuth & Email support
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id varchar(128) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email varchar(255);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(lower(email));
