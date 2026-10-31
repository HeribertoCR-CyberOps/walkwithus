# Contributing

Thank you for helping. Three kinds of contribution matter most, in this order:

1. **Translations by native speakers.** Use the *Translation correction* issue form, or edit `public/js/strings.js` directly. Mark a language reviewed by setting `reviewed: true` in `META` once two native speakers agree.
2. **Running it.** Community organizations that pilot it find the real problems. See `docs/FOR-ORGANIZATIONS.md`.
3. **Code.** Bug fixes, accessibility, and performance on low-end phones.

## Ground rules (non-negotiable)

- **It coordinates adults; it never tracks children.** No feature that stores a child's name, photo, school, route or location will be accepted.
- **No third-party requests, no analytics, no ads, no AI at runtime** (`docs/AI-POLICY.md`).
- **The Worker has zero runtime dependencies.** Dev tooling only.
- **Rule of Two stays in the database.** Walks always need two approved adults.
- Data minimization beats features. If in doubt, collect less.
- **Tests come with the change.** New functionality and every bug fix add or extend an automated test in `test/` (end-to-end, browser or property-based); a pull request without one is not merged unless it changes only documentation.
- **Coding standard:** TypeScript in `strict` mode with `noUncheckedIndexedAccess` (`npm run typecheck` must be clean), ES modules, no runtime dependencies, `.editorconfig` formatting. User-facing text goes in `public/js/strings.js`, never inline.

## Development

```bash
nvm use            # Node 22 (.nvmrc)
npm ci
npm test           # 24 end-to-end tests: real Workers runtime + local D1
npm run test:property  # property-based tests of the crypto core
npm run test:ui    # browser checks in every language, RTL, offline (first time: npx playwright install chromium)
npm run typecheck
npm run dev        # http://127.0.0.1:8787 — seed a local org as in test/ui-smoke.mjs
```

## Pull requests

- Small and focused, one change per PR; the PR template lists the checks.
- `main` is protected: tests, browser checks and CodeQL must pass, and history is linear (squash merge).
- Sign off on the license: contributions are under AGPL-3.0-only (code) and CC BY 4.0 (docs).

## Security

Report vulnerabilities privately: **Security → Report a vulnerability**. See `SECURITY.md`.
