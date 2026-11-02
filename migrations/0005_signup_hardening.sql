-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Savvy Solution Pros LLC. Walk With Us — see NOTICE.
-- 0005 (v1.3.1): the person who signed a program up is recorded on the program itself.
-- Before, "who applied" was inferred from admin membership, so a pending program could list someone else as an admin:
-- that person then looked like its lead to the reviewer and was blocked from starting their own program.
-- The partial unique index makes "one pending program per lead" atomic.
ALTER TABLE orgs ADD COLUMN applied_by TEXT CHECK (applied_by IS NULL OR applied_by = lower(applied_by));
-- Backfill only where the applicant is unambiguous: a pending program with exactly ONE admin. Where a 1.3.0 lead had
-- already added other admins there is no reliable way to tell who signed up, so applied_by stays NULL and the reviewer
-- sees "not recorded" plus every admin, instead of a guessed (possibly impersonated) lead.
UPDATE orgs SET applied_by = (SELECT c.email FROM coordinators c WHERE c.org_id = orgs.id AND c.role = 'admin')
  WHERE status = 'pending' AND applied_by IS NULL
    AND (SELECT COUNT(*) FROM coordinators c WHERE c.org_id = orgs.id AND c.role = 'admin') = 1;
CREATE UNIQUE INDEX idx_one_pending_per_lead ON orgs(applied_by) WHERE status = 'pending';
