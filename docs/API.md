# HTTP API reference

All endpoints live under `/api/`. Everything else is served as static files from `public/`. Source: `src/index.ts` → `route()`.

## Conventions

| | |
|---|---|
| Request body | `application/json` only (`415 json_required` otherwise), at most 4 KB (`413 too_large`). **Unknown fields are rejected** (`400 unknown_field:<name>`); the schema is strict on purpose so location or child data can never be sent. |
| Same-origin | A request carrying an `Origin` header from another site is refused (`403 cross_origin`). |
| Responses | JSON with `cache-control: no-store` (except the public schedule) and the full security header set (CSP `default-src 'none'`, HSTS, `nosniff`, `no-referrer`, `DENY` framing). Each response has `x-request-id`. |
| Errors | `{ "error": "<code>", "request_id": "…" }`. Codes are stable and translated by the front end. Validation codes are `400`. |
| Rate limits | Per network (daily-salted keyed hash of the IP, never the raw IP): 5 walk requests and 5 applications per hour. Per callback number: 3 walk requests per day. `429 rate_limited`. |
| Daily ceilings | Per program, per New York day, counted from stored rows and re-checked inside the `INSERT` (a concurrent burst cannot overshoot): `WALK_DAILY_CAP` walk requests (default 100), `APPLY_DAILY_CAP` volunteer applications (default 50). `429 program_daily_limit`; the family page then shows the organization's phone and 911. |
| Readiness | A program takes walk requests only with ≥ 1 coordinator **and** ≥ 2 approved adults (Rule of Two). Otherwise `409 program_not_ready`, and the public page shows a notice instead of the form. Applications stay open, because that is how a program gets its adults. |
| Demo programs | `orgs.demo = 1`. Forms validate exactly like a real program but **nothing is stored or audited**; responses carry `demo: true`. |
| Times | America/New_York. Dates `YYYY-MM-DD`, times `HH:MM` on a 15-minute grid. |

## Health

| Method & path | Auth | Response |
|---|---|---|
| `GET /api/health` | none | `{ ok, version }` — liveness |
| `GET /api/health/ready` | none | `{ ok, version, problems[], checks{ keys, db, access_configured, rotation_in_progress, programs{ total, demo, accepting_walks }, purge, audit_verify, rekey } }` — readiness; `503` with `problems[]` when degraded (e.g. `db_unreachable`, `maintenance_stale_or_failing`, `audit_chain_broken`) |

## Public (families and volunteers)

| Method & path | Body | Response / notes |
|---|---|---|
| `GET /api/orgs` | — | `{ orgs: [{ slug, name, borough, demo }] }` active programs (`demo` is 0/1) |
| `GET /api/o/:slug` | — | `{ org{ slug, name, borough, public_phone, demo }, accepting_walks, corners[{ id, label, cross_streets, lat, lon }], windows[{ corner_id, dow, start_min, end_min }] }`. Published schedule only: **no live presence, no people**. Edge-cached 60 s fresh, served stale up to 24 h if the database is down (response header `x-cache: stale`, `x-stale-age`). `404 no_org`. |
| `POST /api/o/:slug/walk` | `{ corner_id, date, time, callback, lang, consent: true, turnstile? }` | `201 { ok, ref, meeting_point, slot_start, deletes_at, next, demo? }`. The slot must be inside published coverage and within 14 days. `callback` is a US number, stored only encrypted (AES-256-GCM, row-bound AAD) and deleted 72 h after the slot. `lang` ∈ `en es zh ru bn ht ko ar ur fr pl ak wo ff`. Errors: `program_not_ready` (409), `program_daily_limit` (429), `consent_required`, `bad_phone`, `bad_time`, `bad_corner`, `outside_published_coverage`, `slot_out_of_range`, `bot_check_required`/`bot_check_failed` (when Turnstile is on), `rate_limited`. |
| `POST /api/o/:slug/volunteer` | `{ name, phone, corners: number[], briefing_ack: true, turnstile? }` | `202 { ok, next, demo? }`, identical whether or not the phone already applied (no enumeration). `429 program_daily_limit` past the program's daily ceiling. `briefing_ack_required` without the acknowledgement. Status `pending` until a coordinator meets and approves the person. |

## Volunteer (capability token)

The token comes from the approval link (`/v.html#t=<token>`, URL fragment, never sent to servers in the URL). It is 256 bits, stored only as a hash, rotated on re-approval, and revoked on suspension.

| Method & path | Body | Response |
|---|---|---|
| `POST /api/v/me` | `{ token }` | `{ first_name, shift, walks, corners }`: first name only, the open shift, walks assigned to this volunteer (corner and time, never family numbers), the organization's corners |
| `POST /api/v/checkin` | `{ token, corner_id }` | `{ ok, corner }`. One open shift at a time (`already_checked_in`); the corner must belong to the volunteer's organization (`bad_corner`). |
| `POST /api/v/checkout` | `{ token }` | `{ ok }`; `not_checked_in` if no open shift |

`401 bad_token` for unknown, rotated or suspended tokens.

## Coordinator (Cloudflare Access)

Every request needs a valid Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`): RS256 only, issuer = team domain, audience = `ACCESS_AUD`, unexpired, known key id. The email must be in `coordinators` for that organization. Otherwise the request gets `401 access_required` or `403 not_a_coordinator_for_org`.

| Method & path | Role | Body | Effect |
|---|---|---|---|
| `GET /api/c/me` | any | — | `{ email, orgs[{ slug, name, role }] }` |
| `GET /api/c/:slug/dashboard` | coordinator | — | `{ org, you{ email, role }, readiness{ coordinators, approved_adults, min_approved_adults, accepting_walks }, today{ walks, walk_cap, applications, apply_cap, walks_near_cap, applications_near_cap }, unreadable_records, corners, walks, volunteers, on_shift, … }`. An undecryptable record is shown as `unreadable: true` (name and phone `null`) instead of failing the dashboard. Also: corners right now, open walks, volunteers (names decrypted, **phones masked**; callbacks never included) |
| `POST /api/c/:slug/volunteers/:id/approve` | coordinator | `{}` | Approves, or rotates the link: `{ checkin_link }`, **shown once** |
| `POST /api/c/:slug/volunteers/:id/suspend` | coordinator | `{}` | Revokes the link immediately and closes any open shift |
| `POST /api/c/:slug/volunteers/:id/reveal` | coordinator | `{}` | `{ phone }`, audited, capped at 30 reveals per coordinator per hour |
| `POST /api/c/:slug/walks/:id/reveal` | coordinator | `{}` | `{ callback }`, audited, same cap |
| `POST /api/c/:slug/walks/:id/assign` | coordinator | `{ v1, v2 }` | Two **distinct approved** adults (Rule of Two; also enforced by a database `CHECK`) |
| `POST /api/c/:slug/walks/:id/close` | coordinator | `{ status: "done" \| "cancelled" }` | `done` only from `assigned` |
| `POST /api/c/:slug/corners` | admin | `{ label, cross_streets, lat, lon }` | `201 { id }`; coordinates must be inside NYC, rounded to ~1 m |
| `POST /api/c/:slug/corners/:id/deactivate` | admin | `{}` | Hides the corner from the public schedule |
| `POST /api/c/:slug/windows` | admin | `{ corner_id, dow 0–6, start "HH:MM", end "HH:MM" }` | `201`; 15-minute grid |
| `POST /api/c/:slug/coordinators` | admin | `{ email, role: "coordinator" \| "admin" }` | Adds the person or changes their role |
| `POST /api/c/:slug/audit/verify` | admin | `{}` | Re-verifies the append-only hash chain: `{ ok, entries }` |

Every coordinator action writes an audit entry (actor, action, target, time) to the append-only, hash-chained `audit` table. Database triggers block `UPDATE` and `DELETE` on it, and `UNIQUE(prev)` prevents forks.

## Scheduled maintenance (cron, hourly at :17)

Purges expired walks and stale applications, closes forgotten shifts, aggregates coverage without identities, re-seals data under the current key during a rotation, and verifies the audit chain. Results are visible at `/api/health/ready` → `checks`.
