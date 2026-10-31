-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Savvy Solution Pros LLC. Walk With Us — see NOTICE.
-- v1.1 hardening.
-- 1) Call-language set widened to NYC Local Law 30 designated citywide languages + West African languages common in
--    the Bronx (Twi/Akan, Wolof, Fula). SQLite cannot alter a CHECK, so walk_requests is rebuilt in place.
-- 2) system_status: self-check results written by cron and read by /api/health (no personal data).

CREATE TABLE walk_requests_v2 (
  id            TEXT PRIMARY KEY CHECK (length(id) = 26),
  ref           TEXT NOT NULL CHECK (length(ref) = 6),
  org_id        INTEGER NOT NULL REFERENCES orgs(id),
  corner_id     INTEGER NOT NULL REFERENCES corners(id),
  slot_start    INTEGER NOT NULL CHECK (slot_start % 900 = 0),
  callback_enc  TEXT NOT NULL,
  callback_hmac TEXT NOT NULL,
  lang          TEXT NOT NULL DEFAULT 'en'
                CHECK (lang IN ('en','es','zh','ru','bn','ht','ko','ar','ur','fr','pl','ak','wo','ff')),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','done','cancelled')),
  v1            INTEGER REFERENCES volunteers(id),
  v2            INTEGER REFERENCES volunteers(id),
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at    INTEGER NOT NULL,
  CHECK (status NOT IN ('assigned','done') OR (v1 IS NOT NULL AND v2 IS NOT NULL AND v1 <> v2))
);
INSERT INTO walk_requests_v2 SELECT id, ref, org_id, corner_id, slot_start, callback_enc, callback_hmac,
  CASE WHEN lang IN ('en','es','fr','ak') THEN lang ELSE 'en' END, status, v1, v2, created_at, expires_at FROM walk_requests;
DROP TABLE walk_requests;
ALTER TABLE walk_requests_v2 RENAME TO walk_requests;
CREATE INDEX idx_walk_org ON walk_requests(org_id, status, slot_start);
CREATE INDEX idx_walk_exp ON walk_requests(expires_at);

CREATE TABLE system_status (
  k   TEXT PRIMARY KEY,
  v   TEXT NOT NULL,
  at  INTEGER NOT NULL
);
