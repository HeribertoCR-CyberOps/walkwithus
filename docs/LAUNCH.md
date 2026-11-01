# Launch checklist

A deployment is ready for families when every box is checked. Roles: **maintainer** (code), **operator** (whoever runs the deployment), **partner** (the organization that runs the program).

## Code (verified in CI on every change)
- [x] End-to-end, property and browser tests green (all languages, right-to-left, offline, accessibility) [maintainer]
- [x] Security and reliability audit written, findings fixed (`docs/AUDIT.md`) [maintainer]
- [x] Privacy wall verified by tests: no child or location columns, strict input schema, encryption at rest, 72 h purge, raw IPs never stored [maintainer]
- [x] Rule of Two enforced in the database (direct SQL cannot bypass it) [maintainer]
- [x] Coordinator auth: forged, expired, wrong-audience, `alg:none`, unknown-key and other-org tokens all refused [maintainer]
- [x] Append-only, fork-proof, hash-chained audit log [maintainer]

## Before the URL goes public
- [ ] Deploy credentials are short-lived and scoped to this deployment only; revoked after use [operator]
- [ ] D1 created, migrations applied, `DATA_KEY` / `HMAC_KEY` set, and `DATA_KEY` stored in an offline-recoverable secret store (`docs/DEPLOY.md`) [operator]
- [ ] Access application on `/c.html` and `/api/c/*`; AUD and team domain set in the operator's own (untracked) config; redeployed [operator]
- [ ] Hostname chosen [operator]
- [ ] Name check against conflicting programs or trademarks in the area [operator]
- [ ] Native-speaker review of every non-English language, safety lines first (`docs/TRANSLATIONS.md`) [operator, community reviewers]
- [ ] A Workers plan whose D1 limits cover the expected traffic (`docs/SLO.md`) [operator]
- [ ] External monitor from independent infrastructure (`scripts/monitor.mjs`, `docs/SLO.md`) [operator]
- [ ] Access policy for coordinators requires MFA and a session of 12 h or less [operator]
- [ ] Demo program seeded and labelled "Demo — not a live program" [operator]
- [ ] Smoke test on the live URL from an iPhone and an Android phone: request, volunteer and coordinator flows, 911 link [operator]
- [ ] Turnstile decision: on (adds a Cloudflare script/frame; CSP must be widened) or off (rate limits only) [operator]

## Before the first real program
- [ ] A partner organization has agreed to run it and named a lead and a coordinator [operator, partner]
- [ ] Corners and hours chosen by the partner (only what they can staff) [partner]
- [ ] Volunteers met, briefed (`VOLUNTEER-BRIEFING.md`) and approved in the dashboard [partner]
- [ ] Liability insurance or fiscal sponsor in place [partner]
- [ ] School and precinct community affairs informed [partner]
- [ ] Coordinator trained [operator delivers, partner attends]

## Repository
- [x] Public repository with branch protection, required checks, Dependabot and private vulnerability reporting [maintainer]
