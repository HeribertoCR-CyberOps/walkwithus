# Walk With Us

[![test](https://github.com/HeribertoCR-CyberOps/walkwithus/actions/workflows/test.yml/badge.svg)](https://github.com/HeribertoCR-CyberOps/walkwithus/actions/workflows/test.yml)
[![codeql](https://github.com/HeribertoCR-CyberOps/walkwithus/actions/workflows/codeql.yml/badge.svg)](https://github.com/HeribertoCR-CyberOps/walkwithus/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/HeribertoCR-CyberOps/walkwithus/badge)](https://scorecard.dev/viewer/?uri=github.com/HeribertoCR-CyberOps/walkwithus)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-0f6b4f)](LICENSE)

> **Live demo (made-up data):** <https://walk.savvysolutionpros.com/?o=demo> · Not an emergency service: in danger, call **911**.

**Free, privacy-first safe-passage coordination for community organizations.**
Trained adult volunteers on public corners at school times — the model that cut violent crime 14% along Chicago's Safe Passage routes (McMillen, Sarmiento-Barbieri & Singh, *Journal of Urban Economics*, 2019).

**It coordinates adults. It never tracks children.**

- Families see where and when adults are on duty, and can ask for **two adults** to walk with a student.
- Volunteers apply, are **met in person and approved** by the organization, and check in at a corner with a private link.
- Coordinators see coverage, assign walks to **two approved adults** (enforced by the database), and call families back.
- One-tap **911 / Crime Stoppers / 988** on every screen — and they keep working offline. Plain-language rights info (safety transfers, bullying complaints).
- **English + all ten NYC Local Law 30 languages** (Spanish, Chinese, Russian, Bengali, Haitian Creole, Korean, Arabic, Urdu, French, Polish), right-to-left layout for Arabic and Urdu; callbacks can also be requested in Twi, Wolof and Pulaar.
- Installable on any phone from a QR code. Works offline after the first visit. No ads, trackers, third-party requests — and **no AI** ([policy](docs/AI-POLICY.md)).
- Self-healing operations: edge-cached schedule that survives a database outage, hourly maintenance with recorded results, background key rotation, readiness endpoint, external monitor ([SLO](docs/SLO.md)).

See [`docs/API.md`](docs/API.md) for the HTTP API, [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) for the design and its mathematical guarantees, and [`docs/AUDIT.md`](docs/AUDIT.md) for the security and reliability audit.

## For organizations

You run the program; the software is free. Read [`docs/FOR-ORGANIZATIONS.md`](docs/FOR-ORGANIZATIONS.md) for what you provide, what the maintainers support, and how to start.

## Repository layout

| Path | What it is |
|---|---|
| `src/` | The Worker: routing, Access JWT verification, AES-256-GCM field encryption, maintenance |
| `migrations/` | D1 schema; Rule of Two and the append-only audit log are enforced here |
| `public/` | Static app (no framework, no third-party code): family, volunteer, coordinator pages, service worker, 11 languages |
| `test/` | End-to-end tests against the real Workers runtime + browser checks |
| `scripts/monitor.mjs` | External availability probe (also run by the `monitor` workflow) |
| `docs/` | Blueprint, audit, SLO, deployment, organization guide, volunteer briefing, translations |
| `wrangler.jsonc` | Template config for your own deployment |
| `wrangler.ssp.jsonc` | The reference deployment operated by Savvy Solution Pros |

## Deploy (≈30 minutes, $0)

Requirements: a Cloudflare account (free), Node 20+.

```bash
npm ci
npx wrangler d1 create walkwithus                 # paste database_id into wrangler.jsonc
npx wrangler d1 migrations apply walkwithus --remote
openssl rand -base64 32 | npx wrangler secret put DATA_KEY
openssl rand -base64 32 | npx wrangler secret put HMAC_KEY
npx wrangler deploy
```

Then: protect `/c.html*` and `/api/c/*` with a Cloudflare Access application, put its AUD tag and team domain in `wrangler.jsonc` → `vars`, redeploy, and seed your organization (see [`docs/DEPLOY.md`](docs/DEPLOY.md)).

**Back up `DATA_KEY`** somewhere safe (a password manager). Without it, encrypted contact numbers cannot be read; that is by design.

## Test

```bash
npm test          # 24 end-to-end tests: real Workers runtime + local D1 (auth, privacy wall, Rule of Two, rate limits, audit chain, purge, key-rotation drill)
npm run test:property  # property-based tests of the crypto core (fast-check)
npm run test:ui   # 26 browser checks: every language in light and dark, RTL, offline mode, volunteer and coordinator pages
npm run typecheck
node scripts/monitor.mjs https://<your-host> <org-slug>   # external availability probe
```

## License

Code: [AGPL-3.0](LICENSE) — anyone may use, modify and host it; anyone who runs a modified version for others must publish their changes. Documentation: CC BY 4.0.

## Not an emergency service

If someone is in danger, call **911**.
