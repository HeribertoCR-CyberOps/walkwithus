## What and why

## Checklist
- [ ] `npm test` and `npm run test:ui` pass locally
- [ ] No new runtime dependency (the Worker ships zero), or it is justified here
- [ ] No new personal data field; if any data handling changed, `docs/BLUEPRINT.md` privacy wall and `SECURITY.md` updated
- [ ] No third-party request added (CSP stays `default-src 'none'`)
- [ ] User-facing text added in `public/js/strings.js` for **all** languages (English fallback acceptable only with a `translation` issue opened)
- [ ] Migration is additive and reversible, or the rollback is described here
- [ ] `CHANGELOG.md` updated
