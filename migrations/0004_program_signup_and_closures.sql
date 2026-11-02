-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Savvy Solution Pros LLC. Walk With Us — see NOTICE.
-- 0004 (v1.3): program sign-up with operator review, and closure days.
--
-- 1) A program can now be started by its own lead, signed in through Cloudflare Access (verified email). It starts as
--    'pending': the lead can prepare corners, hours and coordinators, but there is no public page, no volunteer form and
--    no walk form until an operator has reviewed the organization and set it 'live'. 'declined' closes it.
--    Existing programs were set up by an operator, so they are 'live'.
-- 2) closures: dates a program is not running (school holiday, recess, remote day, weather, not enough adults).
--    No free text: the reason is a fixed code, so nothing personal can be typed into it.

ALTER TABLE orgs ADD COLUMN status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('pending','live','declined'));
ALTER TABLE orgs ADD COLUMN org_type TEXT CHECK (org_type IS NULL OR org_type IN
  ('nonprofit','school_parent_group','faith','tenant_association','community_board','other'));
ALTER TABLE orgs ADD COLUMN applied_at INTEGER;
ALTER TABLE orgs ADD COLUMN reviewed_at INTEGER;
CREATE INDEX idx_orgs_status ON orgs(status);

CREATE TABLE closures (
  id      INTEGER PRIMARY KEY,
  org_id  INTEGER NOT NULL REFERENCES orgs(id),
  day     TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),   -- New York calendar date
  reason  TEXT NOT NULL CHECK (reason IN ('holiday','recess','remote_day','weather','not_staffed','other')),
  UNIQUE (org_id, day)
);
CREATE INDEX idx_closures_org_day ON closures(org_id, day);
