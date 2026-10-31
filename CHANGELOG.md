# Changelog

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
