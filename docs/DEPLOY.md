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

## 3. Sign-in: one Cloudflare seat for the operator, Google for program staff (v1.5)

**Who signs in how**
- **The operator** (whoever reviews programs) signs in through Cloudflare Access. That is the only Access seat Walk With Us needs.
- **Program staff** (each organization's lead, admins and coordinators) sign in with their own Google account (Gmail or Google Workspace). They use no Access seat. Their lead adds their address in the app.
- **Volunteers** never sign in. They use the personal check-in link their coordinator gives them.

**3a. Cloudflare Access: the operator console only.** Zero Trust → Access → Applications → **Self-hosted**:
- Name `walkwithus-operator`.
- Destinations: `<host>/op.html`, `<host>/op` and `<host>/api/op/*`.
- **Do not** put `/c.html` or `/api/c/*` behind Access: program staff reach them with Google.
- Policy: Allow → the operator's email(s) only. Login method One-time PIN or a verified identity provider; MFA if you can.
- Copy the **AUD tag**. Set `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` (`<team>.cloudflareaccess.com`) in `wrangler.jsonc` vars, and `OPERATOR_EMAILS` (comma-separated).
- Operator rights are granted **only** through a verified Access token. A Google session for the same address is treated as program staff.
- Narrow the policy to the operator email(s) only. An "Everyone" policy would keep issuing valid tokens and using seats for no reason.
- Set `workers_dev: false` (and keep `preview_urls: false`). On a `*.workers.dev` address nothing sits in front of `/api/op/*`. The Worker still verifies every Access token there, but there is no reason to expose a second address.
- Only use identity providers that verify the email they assert. Never one where users choose their own email claim.
- **Upgrading from 1.4**, in this order:
  1. Add the three destinations above to your existing Access application.
  2. Deploy 1.5 with the Google settings below. If staff currently sign in through Access, also set `ACCESS_FOR_STAFF=1`, so they keep working until they have used Google once.
  3. Remove the old `/c.html`, `/c` and `/api/c/*` destinations, and narrow the policy to the operator.
  4. Remove `ACCESS_FOR_STAFF` and redeploy.
- Without `ACCESS_FOR_STAFF=1`, the public staff pages ignore Access tokens entirely. Once Access no longer stands in front of them, it cannot revoke or re-check those tokens there.

**3b. Google sign-in for program staff.** Google Cloud console:
1. Create a project, for example "Walk With Us".
2. **Google Auth Platform → Branding:** app name, a support email, and authorized domain `<your root domain>`. Add the privacy policy link `https://<host>/privacy`.
3. **Audience:** user type **External**, publishing status **In production**. In *Testing* only listed test users can sign in.
4. **Data access:** add the scopes `openid` and `.../auth/userinfo.email` only. These are non-sensitive scopes.
5. **Clients → Create client → Web application**, with the authorized redirect URI exactly `https://<host>/api/auth/google/callback`.
6. Put the client ID in `wrangler.jsonc` vars as `GOOGLE_CLIENT_ID`. Then run `npx wrangler secret put GOOGLE_CLIENT_SECRET` and paste the secret; it never goes in a file or in Git.
7. Deploy. `/api/health/ready` then shows `checks.google_signin: true`, and `/c.html` shows **Sign in with Google**.

Without the two Google settings, the staff page says sign-in is not available yet. Nothing else breaks.

**3c. How programs are created: `JOIN_MODE`.**
- **`invite`** (default): you set each program up from an intake in the operator console, naming its lead's Google address. Signing in with Google gives a stranger nothing: no program, and no sign-up form.
- **`open`**: anyone signed in with Google may submit a program for review. It stays private until you approve it, with 10 sign-ups per network per day and `JOIN_PENDING_CAP` (default 25) waiting at once. Use this only if you are ready to clear fake sign-ups.

**Account binding:** each email address is bound to the first Google account that signs in with it. A different Google account presenting the same address is refused. This covers a former owner of a work address, or someone who re-registered a lapsed domain. The person sees "linked to a different Google account". After you have confirmed who they are, **Assign or replace the lead** in the console releases the binding for that address.

The Worker verifies every Access JWT (RS256, issuer, audience, expiry, key id) and every Google ID token (signature, issuer, audience, expiry, nonce, verified email) itself.

## 4. Add an organization

**Self-serve (v1.3):** the lead opens `/c.html`, signs in through Access, fills in **Start a Walk With Us program** (name, web address, borough, organization type, optional program phone, five commitments) and submits. The program is created as *pending*: the lead can add corners, hours, closure days and coordinators, but nothing is public. An operator opens `/c.html`, sees **Operator: program review**, verifies the organization (website, EIN or fiscal-sponsor letter, a call with the lead) and presses **Approve**. The public page, volunteer form and walk form open at once; the walk form still waits for two approved adults. **Decline / Take offline** closes the program and stops its volunteer links immediately; it can be reversed.

**From an intake (operator, v1.4):** after speaking with an organization, the operator opens `/c.html` → **Operator: program review** → **Set up a program from an intake**, enters the program details and the lead's email, confirms the five commitments with the lead, and creates it as *pending* or *live*. The lead signs in with that email and manages that program only: its corners, hours, closures, coordinators and volunteers.

**By hand (operator):**

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
