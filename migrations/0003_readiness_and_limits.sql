-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Savvy Solution Pros LLC. Walk With Us — see NOTICE.
-- 0003: program readiness, demo mode, and per-program daily ceilings.
-- A demo program accepts form submissions for demonstration but never stores them.
ALTER TABLE orgs ADD COLUMN demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0,1));
UPDATE orgs SET demo = 1 WHERE slug = 'demo';
-- Daily ceilings count real rows created since NY midnight; these indexes keep that count O(log n).
CREATE INDEX IF NOT EXISTS idx_walk_org_created ON walk_requests(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_vol_org_created ON volunteers(org_id, created_at);
