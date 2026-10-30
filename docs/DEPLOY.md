# Deploy runbook

## 1. Cloudflare resources (one time)

Needs a Cloudflare API token with: **Workers Scripts: Edit**, **D1: Edit**, and (for step 3) **Access: Apps and Policies: Edit**. Use a 24-hour token.

```bash
npm ci
npx wrangler d1 create walkwithus                     # copy database_id into wrangler.jsonc
npx wrangler d1 migrations apply walkwithus --remote
openssl rand -base64 32 | npx wrangler secret put DATA_KEY     # store a copy in a password manager
openssl rand -base64 32 | npx wrangler secret put HMAC_KEY
npx wrangler deploy
```

Custom domain (optional): Workers & Pages → walkwithus → Settings → Domains & Routes → add e.g. `walk.example.org`.

## 2. Bot protection (recommended before public launch)

Cloudflare → Turnstile → add widget for your hostname (Managed mode). Then:
```bash
npx wrangler secret put TURNSTILE_SECRET
```
and set `TURNSTILE_SITEKEY` in `wrangler.jsonc` vars. *(The v1 public page already reads the site key; the widget script embed is the one remaining front-end step before enabling the secret.)*

## 3. Coordinator sign-in (Cloudflare Access)

Zero Trust → Access → Applications → **Self-hosted**:
- Name `walkwithus-coordinators`
- Domains: `<host>/c.html` and `<host>/api/c/*`
- Policy: Allow → emails (or an Entra/Google group) of your coordinators
- Copy the **AUD tag**; set `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` (`<team>.cloudflareaccess.com`) in `wrangler.jsonc` vars; `npx wrangler deploy`.

The Worker verifies the Access JWT itself (RS256, issuer, audience, expiry, key id) — Access in front plus verification behind.

## 4. Seed an organization

```bash
npx wrangler d1 execute walkwithus --remote --command "
INSERT INTO orgs (slug, name, borough, public_phone) VALUES ('example-slug','Example Community Org','Bronx',NULL);
INSERT INTO coordinators (email, org_id, role) VALUES ('lead@example.org', (SELECT id FROM orgs WHERE slug='example-slug'), 'admin');"
```
The admin then adds corners, hours and other coordinators from `/c.html`.

Public page for the org: `https://<host>/?o=example-slug` — print it as a QR code.

## 5. Operations

- **Audit check:** Coordinator dashboard → Admin → Verify audit log (monthly; record the result).
- **Key rotation:** DATA_KEY rotation requires re-encrypting rows; do it only with the maintainers' script (not in v1). HMAC_KEY can be rotated any time (dedupe and rate windows reset).
- **Backups:** `npx wrangler d1 export walkwithus --remote --output backup.sql` — the export contains ciphertext only; still store it encrypted.
- **Logs:** Workers observability is on; the code never logs request bodies or personal data.
- **Offboarding an org:** set `orgs.active=0`, then delete its rows by `org_id`; confirm in writing.
