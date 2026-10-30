# Launch checklist

Gate = every box checked. Owner in brackets.

## Code (done in this repository)
- [x] End-to-end tests green against the real Workers runtime and local D1 [Claude]
- [x] Typecheck clean [Claude]
- [x] Privacy wall verified by tests: no child/location columns, strict input schema, encryption at rest, 72 h purge, raw IPs never stored [Claude]
- [x] Rule of Two enforced in the database (direct SQL cannot bypass it) [Claude]
- [x] Coordinator auth: forged, expired, wrong-audience, `alg:none`, unknown-key and other-org tokens all refused [Claude]
- [x] Append-only, fork-proof, hash-chained audit log [Claude]

## Before the URL goes public
- [ ] Cloudflare token with Workers Scripts:Edit + D1:Edit (+ Access Apps:Edit), 24 h lifetime [Heriberto]
- [ ] D1 created, migrations applied, DATA_KEY/HMAC_KEY set, **DATA_KEY copied to a password manager** [Claude with token / Heriberto stores key]
- [ ] Access application on `/c.html` and `/api/c/*`; AUD + team set; redeployed [Heriberto or Claude with token]
- [ ] Hostname chosen (e.g. `walk.savvysolutionpros.com` for the pilot, or a neutral domain) [Heriberto]
- [ ] Name check: search "Walk With Us" for conflicting programs/trademarks in NY; rename in `APP_NAME`, `index.html`, `manifest` if needed [Heriberto]
- [ ] Spanish reviewed by a native speaker [Heriberto]
- [ ] Demo org seeded and clearly labelled "Demo — not a live program" [Claude]
- [ ] Smoke test on the live URL from two phones (iPhone + Android): request flow, volunteer flow, coordinator flow, 911 link [Heriberto + Claude]
- [ ] Turnstile decision: on (adds a Cloudflare script/frame; CSP must be widened) or off (rate limits only) [Heriberto]

## Before the first real program
- [ ] A partner organization has agreed to run it, named a lead and a coordinator [Heriberto]
- [ ] Corners and hours chosen by the partner (only what they can staff) [Partner]
- [ ] Volunteers met, briefed (`VOLUNTEER-BRIEFING.md`), approved in the dashboard [Partner]
- [ ] Liability insurance / fiscal sponsor in place [Partner]
- [ ] School and precinct community affairs informed [Partner]
- [ ] Coordinator trained (45 min) [Claude prepares, Heriberto delivers]

## Public repository
- [ ] Create `github.com/<org>/walkwithus` (public), push, enable branch protection + required tests, Dependabot, private vulnerability reporting [Heriberto approves; Claude executes]
