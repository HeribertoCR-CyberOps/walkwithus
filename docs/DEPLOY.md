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

## 2. Bot and flood protection (recommended before public launch)

Built in, nothing to configure: per-network rate limits (IPv4 address or IPv6 /64), per-number limits, per-program daily ceilings, and the readiness gate. Refused requests cost a database read, not a write.

**Recommended edge layer:** Cloudflare → your zone → Security → WAF → **Rate limiting rules** → match `http.request.uri.path wildcard "/api/o/*"` and method `POST`, characteristics *IP*, **10 requests per 1 minute**, action *Block* for 10 minutes. This stops floods before they reach the Worker or the database, and the free plan includes one rule.

**Turnstile is not wired into the pages yet.** Do **not** set `TURNSTILE_SECRET`: the server would then require a token the pages never send, and both public forms would fail. The readiness probe reports `turnstile_secret_set_but_ui_not_wired` if it is set. Adding the widget also means allowing `https://challenges.cloudflare.com` in the CSP, which ends the "no third-party requests" promise; decide that deliberately.

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
- **Key rotation:** see section 7 for DATA_KEY. HMAC_KEY can be rotated any time (dedupe and rate windows reset).
- **Backups:** `npx wrangler d1 export walkwithus --remote --output backup.sql` — the export contains ciphertext only; still store it encrypted.
- **Logs:** Workers observability is on; the code never logs request bodies or personal data.
- **Offboarding an org:** set `orgs.active=0`, then delete its rows by `org_id`; confirm in writing.

## 6. Debugging and incident response

- **Every API response has an `x-request-id`.** Error responses also return it in the body. Ask the reporter for it, then find the line in the logs:
  ```bash
  npx wrangler tail walkwithus --format json | grep <request-id>
  ```
  Logs are structured JSON (`level`, `event`, `rid`, `route`, `s`, `ms`) and never contain bodies, phone numbers, names or IP addresses.
- **Readiness:** `GET /api/health/ready` returns `problems[]` (e.g. `db_unreachable`, `maintenance_stale_or_failing`, `audit_chain_broken`) and the last result of each maintenance step.
- **Local debugging:** set `DEBUG=1` in `.dev.vars` to add error messages and the first stack frame to `unhandled` log lines; run `npx wrangler dev --inspector-port 9229` and attach Chrome DevTools (`chrome://inspect`) or VS Code for breakpoints. Never set `DEBUG` in production.
- **Run maintenance now (local):** `npx wrangler dev --test-scheduled`, then `curl "http://localhost:8787/__scheduled?cron=17+*+*+*+*"`.

## 7. Key rotation (DATA_KEY)

1. `npx wrangler secret put DATA_KEY_PREV` ← paste the **current** key.
2. `openssl rand -base64 32 | npx wrangler secret put DATA_KEY` (store the new key in the password manager).
3. Watch `/api/health/ready` → `checks.rekey_pending`. Hourly maintenance walks both tables with a saved cursor, re-sealing up to `REKEY_BATCH` (300) rows per table per run, and reports done only after a complete sweep finds nothing left. **Do not continue while `rekey_pending` is `true`**, or while `problems` contains `rekey_unreadable_rows` (data no configured key can open: investigate before removing anything).
4. `npx wrangler secret delete DATA_KEY_PREV`. `rotation_in_progress` turns false.

The same sweep also upgrades volunteer records sealed before 1.1.7 to the row-bound encryption binding, with no rotation needed. It runs once after deploying 1.1.7 and reports done.

The rotation drill in the test suite exercises exactly this sequence.
