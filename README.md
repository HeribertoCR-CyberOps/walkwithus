# Walk With Us

**Free, privacy-first safe-passage coordination for community organizations.**
Trained adult volunteers on public corners at school times — the model that cut violent crime 14% along Chicago's Safe Passage routes (McMillen, Sarmiento-Barbieri & Singh, *Journal of Urban Economics*, 2019).

**It coordinates adults. It never tracks children.**

- Families see where and when adults are on duty, and can ask for **two adults** to walk with a student.
- Volunteers apply, are **met in person and approved** by the organization, and check in at a corner with a private link.
- Coordinators see coverage, assign walks to **two approved adults** (enforced by the database), and call families back.
- One-tap **911 / Crime Stoppers / 988** on every screen. Plain-language rights info (safety transfers, bullying complaints).
- English and Spanish. Installable on any phone from a QR code. No ads, trackers or third-party requests.

See [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) for the design and its mathematical guarantees.

## For organizations

You run the program; the software is free. Read [`docs/FOR-ORGANIZATIONS.md`](docs/FOR-ORGANIZATIONS.md) for what you provide, what the maintainers support, and how to start.

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
npm test     # 22 end-to-end tests against the real Workers runtime and a local D1
npm run typecheck
```

## License

Code: [AGPL-3.0](LICENSE) — anyone may use, modify and host it; anyone who runs a modified version for others must publish their changes. Documentation: CC BY 4.0.

## Not an emergency service

If someone is in danger, call **911**.
