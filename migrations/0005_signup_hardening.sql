-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Savvy Solution Pros LLC. Walk With Us — see NOTICE.
-- 0005 (v1.3.1): the person who signed a program up is recorded on the program itself.
-- Before, "who applied" was inferred from admin membership, so a pending program could list someone else as an admin:
-- that person then looked like its lead to the reviewer and was blocked from starting their own program.
-- The partial unique index makes "one pending program per lead" atomic.
ALTER TABLE orgs ADD COLUMN applied_by TEXT CHECK (applied_by IS NULL OR applied_by = lower(applied_by));
UPDATE orgs SET applied_by = (SELECT min(email) FROM coordinators c WHERE c.org_id = orgs.id AND c.role = 'admin')
  WHERE status = 'pending' AND applied_by IS NULL;
CREATE UNIQUE INDEX idx_one_pending_per_lead ON orgs(applied_by) WHERE status = 'pending';
