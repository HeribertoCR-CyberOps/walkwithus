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
