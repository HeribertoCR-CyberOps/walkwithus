-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Savvy Solution Pros LLC. Walk With Us — see NOTICE.
-- 0006 (v1.5.0): program staff sign in with Google; the Worker keeps the session (only the operator uses Cloudflare Access).
-- The session id itself never reaches the database: only its SHA-256 is stored, so a database copy cannot sign anyone in.
-- Sessions are ended on sign-out, after 12 idle hours, after 7 days at most, and at once when the person loses their
-- last program role. Expired rows are deleted by the hourly maintenance.
CREATE TABLE sessions (
  id_hash     TEXT PRIMARY KEY CHECK (length(id_hash) = 64),
  email       TEXT NOT NULL CHECK (email = lower(email) AND length(email) <= 254),
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX idx_sessions_email ON sessions(email);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
-- Each email is bound to the first Google account (its permanent "sub" id) that signs in with it. A different Google
-- account presenting the same address later (a former owner of the address, or someone who re-registered a lapsed
-- domain) is refused. Only the operator's lead assignment releases a binding (account recovery, done in person).
CREATE TABLE google_identities (
  email     TEXT PRIMARY KEY CHECK (email = lower(email) AND length(email) <= 254),
  sub       TEXT NOT NULL CHECK (length(sub) BETWEEN 1 AND 255),
  bound_at  INTEGER NOT NULL
);
