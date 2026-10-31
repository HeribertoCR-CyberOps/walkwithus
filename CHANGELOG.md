# Changelog

## 1.1.7 — 2026-10-31
**Security hardening from an independent audit, accessibility verification in CI, ownership and naming policy.** Full findings table: `docs/AUDIT.md` → "Independent review — v1.1.7".
- **Rate limits** are keyed on the client network (IPv4 address or IPv6 /64), closing a bypass where one household's /64 could flood a program. Refused requests no longer cost a database write.
- **Key rotation** walks every row with a persistent cursor and reports done only after a clean full sweep (`checks.rekey_pending`). Before, it only ever re-sealed the first 300 rows. Rows no key can open raise `rekey_unreadable_rows` instead of failing silently.
- **Volunteer encryption is bound to the row** (AAD includes the per-org phone HMAC). Existing records are upgraded automatically by maintenance.
- **Suspension reopens the person's upcoming walks**, so a coordinator must assign two other adults. Rule of Two can no longer be silently broken.
- **Approving volunteers and issuing check-in links are admin-only.** No one can change their own access, the last admin cannot be removed, and there is a new remove-coordinator action. The audit records who was changed (keyed hash) and the exact role transition. Coordinator dashboard views are audited.
- **Privacy:**
  - The public health probe shows pass/fail only, no activity counts.
  - Workers invocation logs are off, so client IPs aren't stored next to requests.
  - New and duplicate volunteer applications take identical work, so timing no longer reveals who already applied.
- **Correctness:**
  - Cross-org corner deactivation is refused (404) instead of writing a false audit entry.
  - Oversized bodies are refused before being read.
  - An unknown Access signing key triggers one key refresh instead of an hour-long lockout.
- **Self-diagnosis:**
  - The probe reports `turnstile_secret_set_but_ui_not_wired`, catching the one setting that would break both public forms.
  - New `scripts/incident.mjs`: the monitor workflow confirms failures on a retry, opens or updates one "incident" issue with a specific next step per failing probe, and closes it on recovery.
- **Accessibility:**
  - axe-core (WCAG 2.2 AA + best practice) and 320 px reflow checks run in CI on 4 pages × light/dark × English/Arabic.
  - Fixed a reflow failure on the home page at 320 px.
  - The browser suite runs on Chromium, WebKit (Safari, every iOS browser) and Firefox (`ENGINE=`).
- **Ownership and licensing:**
  - New `NOTICE` (copyright Savvy Solution Pros LLC; code AGPL-3.0-only, free forever; docs CC BY 4.0).
  - New `TRADEMARK.md`: the name "Walk With Us" may be used only by programs that keep every safety guarantee.
  - SPDX license headers on every source file.
- Docs corrected where the audit found them overstating the code (row-bound encryption, Turnstile readiness, per-network limits).
- Tests: 29 end-to-end tests (including IPv6 /64, refused-request writes, suspension, coordinator management, cross-org corner, a rotation cursor in batches of 2 with legacy-row upgrade), 12 property tests, and the full browser suite with 16 accessibility scans.

## 1.1.6 — 2026-10-31
**Anti-spam and readiness: nothing is accepted unless a real, connected program stands behind it.**
- **Readiness gate.** A program takes walk requests only when it has at least one coordinator to call families back **and** at least two approved adults (Rule of Two). Until then the API answers `409 program_not_ready` and the family page replaces the form with "This program isn't taking walk requests yet. In danger, call 911.", plus the organization's phone. Volunteer applications stay open. The public page updates the moment a volunteer is approved or suspended or a coordinator is added (edge cache invalidated). Readiness is re-checked inside the `INSERT`, so a suspension racing a request cannot slip a row through.
- **Per-program daily ceilings.** `WALK_DAILY_CAP` (default 100) and `APPLY_DAILY_CAP` (default 50) per New York day, counted from real stored rows and enforced atomically in the `INSERT`. A concurrent burst at the ceiling stores nothing extra (tested with 8 parallel requests). Past the ceiling, families see "call the organization directly" and 911. Coordinators see today's counts and a warning at 80%.
- **Demo programs never store anything.** New `orgs.demo` flag (migration 0003 sets it for the `demo` program). Forms validate exactly as in a real program, but no row and no audit entry is written; the page says "Demo: nothing was saved and no one will call."
- **Self-healing dashboard.** One undecryptable volunteer record (corruption, or a key it was not sealed under) used to fail the whole coordinator dashboard. It is now shown as an unreadable record, excluded from walk assignment, logged without personal data, and counted (`unreadable_records`).
- **Coordinator "Program status" panel:** taking requests or not, exactly what is missing, and today's counts against the ceilings.
- **Readiness probe:** `checks.programs { total, demo, accepting_walks }` (no personal data).
- Strings: `not_ready`, `demo_saved`, `program_not_ready`, `program_daily_limit` in all 11 languages (52 strings + 7 error messages in every language).
- Tests: 3 new end-to-end tests (readiness gate, demo no-store, ceilings including concurrency) and 4 new browser checks (demo note, not-ready card, single-program redirect, coordinator status panel). 27/27 end-to-end tests pass.
- Service worker cache `wwu-v7`.

## 1.1.5 — 2026-10-31
- **Honest home page:** `/` no longer jumps into the demo when the demo is the only program. It shows what Walk With Us is, says plainly that no program runs in the area yet (with 911), links to the demo labelled as made-up corners, and gives organizations a contact to start one. When exactly one real program exists, `/` still opens it directly; with several, it lists them. The demo is never treated as a real program. New strings in all 11 languages (non-English drafts pending native review).
- **Fix (visible since 1.1.3):** the emergency buttons read "Call911", "tip:1-800-577-TIPS" and "line:988". Each button is a flex container, which drops the space at the edge of each text piece; the label is now one inline span. A browser test now checks every button in every language for the space before its number (Chinese correctly keeps its full-width colon). Verified: all 22 language/theme checks fail on the buggy version and pass on the fix.
- Service worker cache `wwu-v6`.

## 1.1.4 — 2026-10-31
- **Security fix (client-side request forgery, CodeQL alert #7):** the coordinator page built API paths from the raw `?o=` query value. A crafted link such as `c.html?o=demo/volunteers/1/suspend` made later clicks reach unintended endpoints with the coordinator's session; for example, **Add corner** would have suspended volunteer 1. Both the coordinator and family pages now accept only slugs matching the server's own rule (`^[a-z0-9-]{3,40}$`) and encode every path segment. Regression tests prove the old code made the forged request and the new code does not. No evidence of exploitation: the instance is a demo with test accounts, and every coordinator action is in the audit log.
- Test harness: the browser test opens its server log once and shares the descriptor (CodeQL alert #6, file-system race).
- Property tests moved to `test/property.test.ts` so OpenSSF Scorecard's fuzzing check detects fast-check.
- Service worker cache `wwu-v5`.

## 1.1.3 — 2026-10-31
- **Walk form after hours:** once the last slot of the day has passed, the form now moves to the next day with open times. Before, it showed an empty time list with no explanation. If a family picks a day with nothing left, the list says so in their language (new string `no_times`, all 11 languages; non-English drafts pending native review).
- **Emergency buttons:** phone numbers no longer break across lines ("1-800-577-TIPS" stays whole), and button text is centered with padding.
- Service worker cache bumped (`wwu-v4`) so installed copies pick up the new interface.
- Docs: `docs/API.md`, a complete HTTP API reference checked against the code. CONTRIBUTING now states the test policy and coding standard, and the PR template requires tests.
- Tests: browser check for the after-hours date advance (fixed clock) and the one-line tip number.

## 1.1.2 — 2026-10-31
- **Fix:** `randomString` threw for lengths above 32,768 characters because WebCrypto caps one `getRandomValues` call at 65,536 bytes. Random bytes are now drawn in chunks. Found by the new property tests; production only requests 6–43 characters, so the live service was never affected.
- **Property-based tests** (fast-check, 1,000 generated cases per property in CI): seal/open round-trip for any Unicode, fresh IV per value, AAD binding across rows/fields/orgs, wrong-key rejection, any single-bit tamper detected, malformed ciphertext rejected, HMAC separation, base64/base64url round-trip, alphabet and length of random strings, chi-square test for modulo bias, 256-bit capability tokens, constant-time compare equals `===`.
- CI: Playwright is now a pinned devDependency locked in `package-lock.json`; no unpinned `npm install` remains in any workflow.

## 1.1.1 — 2026-10-30
- **Privacy fix found on the first live deploy:** the Cloudflare edge was injecting a Web Analytics beacon and bot-detection script into HTML pages. The CSP already blocked them, but they broke the "no third-party requests" promise. All pages now send `Cache-Control: no-transform`, which stops edge injection; coordinator and volunteer pages are `no-store, no-transform` on both their canonical (`/c`, `/v`) and `.html` URLs.
- Monitor: new `no_injection` probe fails if any non-first-party `<script>` appears in the app shell or `no-transform` is missing.
- Deploy config: custom domain only; `workers.dev` and preview URLs disabled so there is one entry point behind one Access policy.
- Repository: GitHub Actions pinned to commit SHAs with least-privilege tokens; new dependency-review (PRs) and OpenSSF Scorecard workflows; `npm audit signatures` in CI; Dependabot grouped weekly updates; CODEOWNERS, issue forms (bug, translation, organization), PR checklist, CONTRIBUTING, CODE_OF_CONDUCT, SUPPORT; SECURITY.md response targets and supported versions.
- Dev tooling: wrangler 4.150.0 → 4.156.0 and workers-types → 5.20261031.1 (clears 8 undici advisories in the local dev server; the deployed Worker has zero runtime dependencies and was never affected).
- Docs: tester guide. Template `wrangler.jsonc` for forks; `wrangler.ssp.jsonc` for the reference deployment.

## 1.1.0 — 2026-10-30
- Hardening audit, self-healing operations (stale-if-error schedule cache, hourly maintenance, key rotation, readiness endpoint), all ten NYC Local Law 30 languages with RTL, offline mode.

## 1.0.0 — 2026-10-30
- First release: privacy-first safe-passage coordination on Workers + D1.
