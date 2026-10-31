# Changelog

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
