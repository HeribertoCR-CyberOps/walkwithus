# Security & reliability audit — Walk With Us v1.1.0

Self-assessment by the maintainers, 2026-10-30. This is evidence, not a certification; an independent penetration test is listed under residual risk. Every "Verified" claim below is backed by an automated end-to-end test that runs on every commit against the real Workers runtime and a real D1 database.

## Scope
Worker API (`src/`), schema and migrations, static front end (`public/`), service worker, CI, monitoring script. Out of scope: Cloudflare platform internals, the organization's own devices and Access policy, volunteer conduct.

## OWASP API Security Top 10 (2023)
| Risk | Control | Evidence |
|---|---|---|
| API1 Broken object-level authorization | Every coordinator query is scoped `WHERE … AND org_id=?` using the org derived from the verified identity's membership; volunteers act only through their own capability token; corners are checked against the org. | Verified: other-org coordinator → 403; another org's corner → `bad_corner` |
| API2 Broken authentication | Coordinators: Cloudflare Access JWT verified in the Worker (RS256 only, `kid` lookup, `iss`, `aud`, `exp`, `nbf`). Volunteers: 256-bit random capability, only SHA-256 stored, rotated on re-approval, revoked on suspend. No passwords exist. | Verified: forged, wrong-aud, wrong-iss, expired, `alg:none`, unknown-kid tokens refused; old link dies on rotation |
| API3 Broken object-property-level authorization | Strict request allowlists (unknown field → 400); responses never include ciphertext, hashes or callback numbers; phones masked unless explicitly revealed. | Verified: location/child fields rejected; dashboard has no callback |
| API4 Unrestricted resource consumption | 4 KB body cap; per-network and per-number rate limits; **30 decryptions/hour per coordinator**; health-probe limit; 72 h retention bounds table size. | Verified: 6th request/h → 429; 4th per number/day → 429; 31st reveal → 429 + audit entry |
| API5 Broken function-level authorization | Admin-only actions gated by role; coordinator ≠ admin. | Verified |
| API6 Unrestricted access to sensitive business flows | Walk requests limited to published windows, 15-min grid, 14-day horizon, rate limits; optional Turnstile. | Verified |
| API7 SSRF | No user-controlled outbound requests. Only fixed URLs: Access certs, Turnstile. | Code review |
| API8 Security misconfiguration | CSP `default-src 'none'` on API and strict CSP on pages; HSTS; `nosniff`; `frame-ancestors 'none'`; no CORS; generic errors with request id; service refuses to run without keys. | Verified: headers on API and pages |
| API9 Improper inventory management | Single API surface, documented routes, version in health. | `README`, `docs/BLUEPRINT.md` |
| API10 Unsafe consumption of APIs | Access certs parsed defensively; Turnstile result checked for `success`. | Code review |

## OWASP ASVS 4.0.3 — Level 2 highlights
| Chapter | Status |
|---|---|
| V1 Architecture & threat model | `SECURITY.md` threat model; trust boundaries documented in `BLUEPRINT.md` |
| V2/V3 Authentication & sessions | Delegated to Cloudflare Access (SSO/MFA by org policy); Worker re-verifies every request; no local sessions or cookies issued |
| V4 Access control | Deny by default; org scoping; role checks; Rule of Two as a **database constraint** (verified: direct SQL bypass refused) |
| V5 Validation & encoding | NFKC normalization, control-character and angle-bracket rejection, length caps, E.164 phones; **DOM built with `textContent` only — no `innerHTML` anywhere**; all SQL parameterized |
| V6 Cryptography | WebCrypto AES-256-GCM, 96-bit random IV per value, AAD binds ciphertext to table/field/org/row; HMAC-SHA-256 keyed hashes; key rotation with background re-sealing (verified by drill) |
| V7 Errors & logging | Structured JSON logs with request ids and route templates; never bodies, phones, names or IPs; `DEBUG=1` adds error messages for local debugging only |
| V8 Data protection | Data minimization by schema (no child data possible); 72 h retention with aggregates only; volunteers never see family numbers |
| V9 Communications | TLS at Cloudflare edge; HSTS two years |
| V10 Malicious code | Zero runtime dependencies; CodeQL (security-extended) weekly + on PR; `npm audit`; SBOM per build; Dependabot |
| V11 Business logic | Published-window enforcement; two distinct approved adults; only assigned walks can be completed |
| V12 Files | No file upload surface |
| V13 API | JSON-only, content-type enforced, same-origin check on writes |
| V14 Configuration | Secrets only via `wrangler secret`; no secrets in repo (`.dev.vars` git-ignored); CSP; Permissions-Policy denies geolocation/camera/mic |

## Privacy (NY Child Data Protection Act / COPPA posture)
The system processes **no data about minors**: there is no field for a child's name, school, location or record, and the API rejects attempts to send one. The only personal data are an adult callback number (encrypted, 72 h) and adult volunteer contact details (encrypted). Legal review of this posture by counsel is recommended before scale-up (residual risk R5).

## Reliability
See `docs/SLO.md`. Verified: readiness probe, edge caching and invalidation, maintenance status recording, audit verification, key-rotation drill.

## Findings raised and fixed in this audit
| # | Severity | Finding | Fix | Status |
|---|---|---|---|---|
| F1 | High | Schedule depended on D1 for every read; D1 Free tier now fails queries at daily limits | Edge cache (60 s fresh, 24 h stale-if-error) + service-worker offline copy + call-the-org fallback on write failure | Fixed, tested |
| F2 | High | No ceiling on how many contact numbers one coordinator account could decrypt | 30/hour per coordinator, throttles are audited | Fixed, tested |
| F3 | Medium | No key-rotation path for `DATA_KEY` | `DATA_KEY_PREV` decrypt fallback + hourly background re-sealing; health shows rotation | Fixed, drill-tested |
| F4 | Medium | Limited production diagnostics | Request ids on every response, structured logs, readiness endpoint, maintenance status | Fixed, tested |
| F5 | Medium | Call-language set too narrow for NYC | Local Law 30 languages + Twi, Wolof, Pulaar | Fixed, tested |
| F6 | Low | Past time slots offered for today | Filtered client-side (server already rejected them) | Fixed |
| F7 | Defect (caught by tests) | Exported constants in the entry module prevented the Worker from starting (`Incorrect type for map entry`) — invisible to the type checker | Constants made module-private | Fixed; all API tests failed until fixed |
| F8 | Defect (caught by tests) | Rotation-fallback wrapper called itself (stack overflow) after a bulk rename | Corrected; the readiness and dashboard tests failed until fixed | Fixed |
| F9 | Test quality | Earlier constraint tests would have counted a database-lock error as "constraint held" | Tests now pass only on the specific constraint error | Fixed |

## Residual risks (owner, before or after launch)
| # | Risk | Mitigation / owner |
|---|---|---|
| R1 | No independent penetration test yet | Commission one before citywide scale; scope: API authZ, Access integration, abuse flows |
| R2 | Translations are machine-drafted | Native-speaker review per `docs/TRANSLATIONS.md` before marking reviewed |
| R3 | Workers Free plan D1 limits | Run production on Workers Paid |
| R4 | Edge cache is per data center and requires a custom domain | Use a custom domain; monitor `x-cache` |
| R5 | Legal posture (insurance, volunteer liability, data law) | Partner organization + counsel |
| R6 | Coordinator device compromise | Access policy should require MFA and session ≤ 12 h; reveal ceiling bounds damage |
| R7 | `DATA_KEY` custody | Store in a password manager / vault; rotation procedure in `DEPLOY.md` |
| R8 | Turnstile not embedded by default | Decide at launch; embedding requires widening CSP to Cloudflare's challenge origin |

---

## Addendum — v1.1.1 (first live deploy, 2026-10-30)

| ID | Finding | Severity | Fix | Verified |
|---|---|---|---|---|
| L-1 | Edge injected `static.cloudflareinsights.com` beacon and an inline bot-detection script into HTML. CSP blocked both (no data left the page), but the page attempted a third-party load. | Medium (privacy promise) | `Cache-Control: no-transform` on all pages via `_headers` | Live: 0 injected scripts on `/`, `/?o=demo`, `/privacy`, `/v`; 7-language live browser run with zero console errors |
| L-2 | `/v` and `/c` (canonical URLs after the asset redirect) did not inherit `no-store` set for `/v.html`, `/c.html` | Low | Rules added for both forms | Live header check |
| L-3 | `workers.dev` and preview URLs served a second copy of the app | Low (coordinator API still required a valid Access JWT) | Disabled in `wrangler.jsonc` | `workers.dev` returns 404 |

---

## Independent review — v1.1.7 (2026-10-31)

A separate reviewer audited v1.1.6 from the code alone, with proof-of-concept exploits against an isolated copy. No critical issues were found. Every confirmed finding is fixed in 1.1.7 with a regression test.

| # | Finding (severity) | Fix in 1.1.7 | Test |
|---|---|---|---|
| A1 | Rate limits keyed on the full IP; one IPv6 /64 sent 12 of 12 applications past the 5/hour limit and could exhaust a program's daily ceiling (High) | Limits keyed on the IPv4 address or the IPv6 /64; WAF rate-limit rule documented for the edge | 7 addresses in one /64 → 5 accepted, 2 refused; a different /64 accepted |
| A2 | Refused requests still wrote the rate counter: about 1.2 req/s could burn the free-tier write quota (Medium) | Read first; past the limit a refusal costs no write | `MAX(n)` unchanged after 5 further refusals |
| A3 | Key rotation re-sealed only the first 300 rows of each table forever; removing the old key would orphan the rest (Medium) | Persistent per-table cursor; done only after a clean full sweep; `rekey_pending` and `rekey_unreadable_rows` in the probe | Batch of 2 walks every row; old key removed; 0 unreadable |
| A4 | Suspending a volunteer left them on walks already assigned (Rule of Two silently broken) (Medium) | Suspension reopens their upcoming walks in the same batch; audited with the count | Walk returns to `open` with no adults |
| A5 | Audit could not show who an admin added or demoted; no removal endpoint (Medium) | Audit subject = keyed hash of the target + exact transition; removal endpoint; no self-change; last admin protected | Demotion, removal and last-admin cases |
| A6 | Any plain coordinator could approve applicants and mint check-in links (Medium) | Approving and issuing links are admin-only | Coordinator → 403 `admin_only` |
| A7 | Response timing revealed whether a phone had already applied (Low) | Same work (including the audit write) on both paths | Code review |
| A8 | Volunteer ciphertexts were bound to field and org but not the row; the docs claimed row binding (Low) | AAD includes the row's per-org phone HMAC; old rows open via the legacy binding and are upgraded by maintenance | Legacy-sealed row opens, upgrades, then fails under the old binding |
| A9 | Cross-org corner deactivation returned 200 and wrote a false audit entry (Low) | 404 `no_corner` unless the corner is this org's | No audit entry, corner unchanged |
| A10 | Coordinator dashboard views were not audited (Low) | `dashboard_viewed` at most once per coordinator per 10 minutes | Code review |
| A11 | Public readiness probe exposed activity counts (Suspected) | Public view shows pass/fail and age only | `purge.result` absent |
| A12 | Workers invocation logs may store client IP next to each request (Suspected) | Invocation logs off; the app's own structured logs (no personal data) remain | Config |
| A13 | Unknown Access key id locked coordinators out until the 1-hour cache expired (Suspected) | One forced refetch per minute on an unknown key id; signature still verified | Code review |
| A14 | Body size limit checked after reading the whole body (Info) | `content-length` checked first | Existing 413 test |
| A15 | Setting `TURNSTILE_SECRET` would break both forms because the pages don't send a token (Medium, misconfiguration) | Documented as not wired; the probe reports `turnstile_secret_set_but_ui_not_wired` | Code review |

**Accepted with rationale:**
- **Audit chain uses unkeyed SHA-256.** It detects tampering through the application; someone with direct database console access could rebuild it. Fix planned: an HMAC-keyed chain with the head hash exported off-platform daily.
- **`auditVerify` reads the full table.** Acceptable at current size; incremental verification is planned.
- **The edge cache is cleared per data center.** Other locations may show a stale `accepting_walks` for up to 60 s. The server re-checks readiness inside the `INSERT`, so a stale "open" form can never store a request for a program that isn't ready.
- **The template keeps `workers_dev: true` for quick start.** Production configs disable it (the reference deployment does); DEPLOY explains why.

### Accessibility (v1.1.7)
- **axe-core 4.10.3**, WCAG 2.0/2.1/2.2 A and AA plus best practice: 0 violations on the home, family, volunteer and privacy pages, in light and dark, English and Arabic (RTL), at 320 CSS px, in Chromium, WebKit and Firefox. This now runs in CI.
- **Manual checks:**
  - Reflow at 320 px (one failure found and fixed: an unbreakable email address widened the page).
  - 200% text size.
  - Windows high-contrast (forced colors).
  - Reduced motion.
  - Keyboard: Tab reaches language, then 911, tip line and 988, with a visible focus ring.
