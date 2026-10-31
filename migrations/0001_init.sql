-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Savvy Solution Pros LLC. Walk With Us — see NOTICE.
-- Walk With Us — schema v1.
-- PRIVACY WALL (structural, not policy): there is no column anywhere for a child's name, a child's location,
-- a child's school record, or free text. Meeting points are rows in `corners` (public places chosen by the org).
-- Times are quantized to 15-minute slots. Contact numbers exist only as AES-256-GCM ciphertext + keyed hash.

PRAGMA foreign_keys = ON;

CREATE TABLE orgs (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE CHECK (slug GLOB '[a-z0-9-]*' AND length(slug) BETWEEN 3 AND 40),
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 3 AND 120),
  public_phone  TEXT,               -- the org's own published hotline (not personal data)
  borough       TEXT,
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Public meeting points / staffed posts. Public by design (an adult in a vest on a corner is visible anyway).
CREATE TABLE corners (
  id            INTEGER PRIMARY KEY,
  org_id        INTEGER NOT NULL REFERENCES orgs(id),
  label         TEXT NOT NULL CHECK (length(label) BETWEEN 3 AND 120),
  cross_streets TEXT NOT NULL CHECK (length(cross_streets) BETWEEN 3 AND 160),
  lat           REAL NOT NULL CHECK (lat BETWEEN 40.40 AND 41.00),
  lon           REAL NOT NULL CHECK (lon BETWEEN -74.30 AND -73.60),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);
CREATE INDEX idx_corners_org ON corners(org_id, active);

-- Published coverage schedule (the promise to families). Minutes after local midnight, America/New_York.
CREATE TABLE windows (
  id            INTEGER PRIMARY KEY,
  org_id        INTEGER NOT NULL REFERENCES orgs(id),
  corner_id     INTEGER NOT NULL REFERENCES corners(id),
  dow           INTEGER NOT NULL CHECK (dow BETWEEN 0 AND 6),          -- 0 = Sunday
  start_min     INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min       INTEGER NOT NULL CHECK (end_min BETWEEN 1 AND 1440),
  CHECK (end_min > start_min)
);
CREATE INDEX idx_windows_org ON windows(org_id, dow);

-- Coordinators are identified ONLY by a Cloudflare Access-verified email.
CREATE TABLE coordinators (
  email         TEXT NOT NULL CHECK (email = lower(email) AND email LIKE '%_@_%._%'),
  org_id        INTEGER NOT NULL REFERENCES orgs(id),
  role          TEXT NOT NULL DEFAULT 'coordinator' CHECK (role IN ('coordinator','admin')),
  PRIMARY KEY (email, org_id)
);

-- Adult volunteers. Name + phone are ciphertext. Check-in uses a 256-bit capability token; only its hash is stored.
CREATE TABLE volunteers (
  id            INTEGER PRIMARY KEY,
  org_id        INTEGER NOT NULL REFERENCES orgs(id),
  name_enc      TEXT NOT NULL,
  phone_enc     TEXT NOT NULL,
  phone_hmac    TEXT NOT NULL,
  corners_pref  TEXT NOT NULL DEFAULT '[]',     -- JSON array of corner ids
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','suspended')),
  token_hash    TEXT UNIQUE,
  briefing_ack  INTEGER NOT NULL CHECK (briefing_ack = 1),   -- observe-report-never-engage acknowledged at signup
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  approved_by   TEXT,
  approved_at   INTEGER,
  UNIQUE (org_id, phone_hmac),
  CHECK (status <> 'approved' OR (token_hash IS NOT NULL AND approved_by IS NOT NULL))
);
CREATE INDEX idx_vol_org ON volunteers(org_id, status);

-- Shift presence of ADULTS at fixed corners. No continuous GPS.
CREATE TABLE shifts (
  id            INTEGER PRIMARY KEY,
  org_id        INTEGER NOT NULL REFERENCES orgs(id),
  volunteer_id  INTEGER NOT NULL REFERENCES volunteers(id),
  corner_id     INTEGER NOT NULL REFERENCES corners(id),
  checkin_at    INTEGER NOT NULL,
  checkout_at   INTEGER,
  CHECK (checkout_at IS NULL OR checkout_at >= checkin_at)
);
CREATE UNIQUE INDEX idx_one_open_shift ON shifts(volunteer_id) WHERE checkout_at IS NULL;
CREATE INDEX idx_shifts_live ON shifts(org_id, corner_id) WHERE checkout_at IS NULL;

-- "Walk with me" requests. Meeting point = a public corner; time = 15-minute slot; callback = ciphertext.
-- RULE OF TWO is a database invariant: 'assigned' is impossible without two distinct volunteers.
CREATE TABLE walk_requests (
  id            TEXT PRIMARY KEY CHECK (length(id) = 26),
  ref           TEXT NOT NULL CHECK (length(ref) = 6),
  org_id        INTEGER NOT NULL REFERENCES orgs(id),
  corner_id     INTEGER NOT NULL REFERENCES corners(id),
  slot_start    INTEGER NOT NULL CHECK (slot_start % 900 = 0),
  callback_enc  TEXT NOT NULL,
  callback_hmac TEXT NOT NULL,
  lang          TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en','es','fr','ak')),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','done','cancelled')),
  v1            INTEGER REFERENCES volunteers(id),
  v2            INTEGER REFERENCES volunteers(id),
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at    INTEGER NOT NULL,
  CHECK (status NOT IN ('assigned','done') OR (v1 IS NOT NULL AND v2 IS NOT NULL AND v1 <> v2))
);
CREATE INDEX idx_walk_org ON walk_requests(org_id, status, slot_start);
CREATE INDEX idx_walk_exp ON walk_requests(expires_at);

-- Append-only, hash-chained audit log of every privileged action (who, what, when). No personal data in it.
CREATE TABLE audit (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL,
  ts            INTEGER NOT NULL,
  actor         TEXT NOT NULL,
  action        TEXT NOT NULL,
  subject       TEXT NOT NULL,
  prev          TEXT NOT NULL UNIQUE,   -- UNIQUE(prev) makes a forked chain impossible: concurrent writers retry
  hash          TEXT NOT NULL UNIQUE
);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;

-- Fixed-window rate limiting. Keys are keyed hashes with a daily salt: raw IPs are never stored.
CREATE TABLE rate (
  k             TEXT PRIMARY KEY,
  window_start  INTEGER NOT NULL,
  n             INTEGER NOT NULL
);

-- Aggregates kept after raw rows are purged (for funders/reporting): no identities.
CREATE TABLE coverage_daily (
  org_id        INTEGER NOT NULL,
  day           TEXT NOT NULL,
  corner_id     INTEGER NOT NULL,
  adult_minutes INTEGER NOT NULL DEFAULT 0,
  walks_done    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, day, corner_id)
);
