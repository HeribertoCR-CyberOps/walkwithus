# Walk With Us — Blueprint

**One sentence:** coordinate *adults* on *public corners* at *published times*; never collect where a child is.

## 1. The finding that shapes everything

Every design that tracks children in order to protect them hits the same mathematical wall: **base rates**.

A "dead-man's switch" (phone heartbeat every 15 s, alarm if it stops or leaves a corridor) fires on dead batteries, subway tunnels, elevators and phones in backpacks. Let:

- π = probability a given trip involves a real attack (illustrative: 1 in 100,000 trips = 10⁻⁵)
- s = probability the system detects a real attack (generous: 0.9)
- f = probability a normal trip triggers a false alarm (conservative for a phone in a pocket in NYC: 0.05)

Positive predictive value — the chance an alarm is real:

```
PPV = π·s / (π·s + (1−π)·f) = (10⁻⁵ · 0.9) / (10⁻⁵ · 0.9 + 0.99999 · 0.05) ≈ 0.00018
```

**99.98% of alarms would be false.** With 200 students × 2 trips/day, that is ~20 false alarms every school day. Within a week, responders stop responding — and when the system "works", it broadcasts a threatened child's location to everyone who receives the alert. Changing the assumptions by 10× in either direction does not change the conclusion; it only moves the decimal.

The evidence-backed alternative needs no alarms at all: **visible adults on fixed corners at fixed times.** Chicago's Safe Passage program, studied over 10+ years of geocoded police data, found violent crime **14% lower on average** along staffed routes, absences 2.5 percentage points lower, and **no displacement** to nearby blocks (McMillen, Sarmiento-Barbieri & Singh, *Journal of Urban Economics* 110, 2019). The software's job is to make that model cheap to run.

## 2. The privacy wall — invariants, not promises

Each guarantee is enforced by structure (schema, cryptography, protocol) and checked by the test suite.

| # | Invariant | Mechanism | Test |
|---|---|---|---|
| W1 | **Zero bits of child location or identity are stored.** | No column exists for child name, student, school, coordinates of a person, or free text. API rejects any unknown field. | `walk request: strict schema…`, column scan |
| W2 | A request reveals only a *public place* and a *15-minute slot*. | Meeting point is a row from the org's published `corners` (≤ log₂\|P\| bits; with 20 corners, 4.3 bits — what anyone standing there already sees). `slot_start % 900 = 0` is a DB CHECK. | `slot_must_be_15_min` |
| W3 | Contact numbers are unreadable at rest. | AES-256-GCM, fresh 96-bit IV per value, AAD = `table|field|org|row` so ciphertext cannot be moved between rows or orgs. Keyed HMAC for dedupe. | ciphertext inspection |
| W4 | Data dies on schedule. | `expires_at = slot + 72 h`; hourly cron deletes; only anonymous aggregates (adult-minutes, walks completed per corner per day) survive. | `cron purge…` |
| W5 | Every human look is recorded. | Each callback/phone reveal, approval, assignment writes to an append-only SHA-256 hash chain. UPDATE/DELETE blocked by triggers; `UNIQUE(prev)` makes a forked chain impossible. | `audit chain verifies…` |
| W6 | **Rule of Two.** | `CHECK (status NOT IN ('assigned','done') OR (v1 IS NOT NULL AND v2 IS NOT NULL AND v1 <> v2))` — the database cannot represent a one-adult walk. | direct-SQL bypass attempts fail |
| W7 | No third party sees a family's visit. | CSP `default-src 'none'`, no external scripts, fonts, maps, analytics. Map links open OpenStreetMap only when tapped. `Permissions-Policy: geolocation=()`. | CSP test |
| W8 | Raw IP addresses are never stored. | Rate-limit keys = HMAC(key, day ‖ scope ‖ ip); salt rotates daily. | rate table scan |

### Quantities

- **Rule of Two risk.** If each approved adult independently has probability *p* of being unsafe, a single-escort model exposes the child with probability *p*; two independent adults both unsafe: *p²*. At *p* = 1%, that is 1% → 0.01% — a **100× reduction**. Independence is the assumption, so coordinators pair adults from different households.
- **Volunteer link strength.** Check-in links carry a 256-bit random token (only its SHA-256 is stored). At the enforced ceiling of 60 attempts/hour, the probability of guessing any one of 1,000 live tokens in a year is ≈ 1,000 × 525,600 / 2²⁵⁶ ≈ 5 × 10⁻⁶⁹.
- **Breach blast radius (Little's law).** Records at rest L = λ·W. With λ = 40 requests/day and W ≈ 4 days (avg. 1-day lead + 72 h retention), about **160 encrypted rows** exist at any moment — not a growing archive.
- **Abuse ceiling.** ≤ 5 requests/hour per network, ≤ 3/day per callback number, ≤ 5 volunteer applications/hour per network; optional Cloudflare Turnstile on every public form.
- **Reference codes** (6 symbols from a 30-character alphabet, 30⁶ ≈ 7.3 × 10⁸) are for reading over the phone; they grant nothing.

## 3. Architecture

```
Family / volunteer phone ──HTTPS──▶ Cloudflare edge (TLS, DDoS, WAF, optional Turnstile)
                                      │
                    static app shell (PWA, installable, offline-capable, no trackers)
                                      │
                         Worker API (TypeScript, ~600 lines, zero runtime deps)
                          ├─ public:      org schedule · walk request · volunteer application
                          ├─ volunteer:   256-bit capability link (URL fragment, never logged)
                          └─ coordinator: Cloudflare Access JWT (RS256, iss/aud/exp/kid) + org role
                                      │
                                D1 (SQLite) — encrypted fields, CHECK constraints, audit chain
                                      │
                         Cron (hourly): close forgotten shifts · aggregate · purge
```

**Scale.** Workers run in every Cloudflare location and scale per request; there are no servers to size. Free tier covers roughly 100,000 requests/day; a 50-corner program generates well under 1% of that. Multi-tenancy is built in (`org_id` on every row), so one deployment can host many neighborhood programs, or each organization can deploy its own copy for full sovereignty. The $5/month Workers paid plan lifts all practical limits. (Check current Cloudflare free-tier limits before planning a citywide rollout.)

**Why not a native app.** Background location needs App Store/Play review and a permission we refuse to ask for. A PWA installs from a QR code in seconds, updates instantly, and works on any phone.

## 4. Roles

| Role | Identity | Can |
|---|---|---|
| Family / student | none | see schedule, request two adults, see rights info |
| Volunteer | capability link issued in person | check in/out at a corner, see their assigned walks (meeting point + time only) |
| Coordinator | Cloudflare Access (org's email/SSO) | approve/suspend volunteers, see coverage, reveal a callback (logged), assign two adults |
| Admin | same, role=admin | corners, schedule, coordinators, audit verification |

Volunteers never receive a family's phone number. Coordinators never see a child's name, because it is never asked for.

## 5. What this deliberately does not do

No child tracking. No incident reports or descriptions of people (those belong to 911 / NYPD Crime Stoppers, with legal process around them). No dossiers about other students. No automated messages to anyone. No AI in the safety path.
