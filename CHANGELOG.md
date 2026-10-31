# Changelog

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
