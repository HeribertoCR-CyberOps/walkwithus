// End-to-end tests against the real Workers runtime (wrangler dev --local) and a real local D1.
// Coordinator identity uses genuine RS256 JWTs signed by a test key; production code has no bypass.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { generateKeyPairSync, sign, randomBytes, randomUUID } from "node:crypto";
import { writeFileSync, rmSync, openSync, readFileSync } from "node:fs";

process.env.CI = "1"; process.env.WRANGLER_SEND_METRICS = "false";
const PORT = 8799, BASE = `http://127.0.0.1:${PORT}`, PERSIST = ".wrangler/test-state";
const TEAM = "test.cloudflareaccess.com", AUD = "test-aud";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const { publicKey: rogueKey, privateKey: roguePriv } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "k1";
let proc, LOGFD; const DEVLOG = ".wrangler/test-dev.log";  const devTail = () => { try { return readFileSync(DEVLOG, "utf8").slice(-3000); } catch { return ""; } };

const b64u = (b) => Buffer.from(b).toString("base64url");
function jwt(claims, { key = privateKey, kid = KID, alg = "RS256" } = {}) {
  const h = b64u(JSON.stringify({ alg, kid, typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const p = b64u(JSON.stringify({ iss: `https://${TEAM}`, aud: [AUD], iat: now, exp: now + 600, ...claims }));
  const s = b64u(sign("RSA-SHA256", Buffer.from(`${h}.${p}`), key));
  return `${h}.${p}.${s}`;
}
const ADMIN = () => jwt({ email: "admin@org.test" });
const COORD = () => jwt({ email: "coord@org.test" });

async function req(path, { method = "GET", body, token, ip, headers = {} } = {}) {
  const h = { connection: "close", ...headers };   // no keep-alive reuse: sync CLI calls let idle sockets go stale
  if (body !== undefined) h["content-type"] = "application/json";
  if (token) h["cf-access-jwt-assertion"] = token;
  h["cf-connecting-ip"] = ip || "203.0.113." + Math.floor(Math.random() * 250);
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j, headers: r.headers };
}
function sqlRaw(command) {
  for (let i = 0; ; i++) {
    try {
      const out = execFileSync("npx", ["wrangler", "d1", "execute", "walkwithus", "--local", "--persist-to", PERSIST, "--json", "--command", command],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
      return { ok: true, rows: JSON.parse(out)[0].results };
    } catch (e) {
      const msg = String(e.stderr || "") + String(e.stdout || "") + String(e.message || "");
      if (/SQLITE_BUSY|database is locked/.test(msg) && i < 8) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400 * (i + 1)); continue; }
      return { ok: false, msg };
    }
  }
}
function sql(command) {
  const r = sqlRaw(command);
  if (!r.ok) throw new Error(r.msg.slice(0, 600));
  return r.rows;
}
// Passes only if the statement was refused BY A CONSTRAINT — a lock or tooling error does not count.
function sqlFails(command) {
  const r = sqlRaw(command);
  if (r.ok) return false;
  if (/CHECK constraint failed|UNIQUE constraint failed|append-only|NOT NULL constraint failed|FOREIGN KEY/.test(r.msg)) return true;
  throw new Error("statement failed for a non-constraint reason: " + r.msg.slice(0, 400));
}
const nyDate = (plusDays) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + plusDays * 86400000));

const KEY1 = randomBytes(32).toString("base64"), KEY2 = randomBytes(32).toString("base64"), HKEY = randomBytes(32).toString("base64");
function writeVars(extra) {
  const jwk = publicKey.export({ format: "jwk" });
  writeFileSync(".dev.vars", [
    `HMAC_KEY=${HKEY}`, `ACCESS_TEAM_DOMAIN=${TEAM}`, `ACCESS_AUD=${AUD}`,
    `ACCESS_JWKS_JSON=${JSON.stringify({ keys: [{ ...jwk, kid: KID, alg: "RS256" }] })}`, ...extra,
  ].join("\n") + "\n");
}
async function startServer() {
  LOGFD = openSync(DEVLOG, "a");
  proc = spawn("npx", ["wrangler", "dev", "--local", "--port", String(PORT), "--persist-to", PERSIST, "--test-scheduled", "--ip", "127.0.0.1"],
    { stdio: ["ignore", LOGFD, LOGFD], env: { ...process.env, NO_COLOR: "1" }, detached: true });
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(BASE + "/api/health", { headers: { connection: "close" } }); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("wrangler dev did not start:\n" + devTail());
}
async function stopServer() {
  try { process.kill(-proc.pid, "SIGTERM"); } catch {}
  for (let i = 0; i < 60; i++) {
    try { await fetch(BASE + "/api/health", { headers: { connection: "close" } }); } catch { return; }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not stop");
}

before(async () => {
  try { await fetch(BASE + "/api/health"); throw new Error(`port ${PORT} already in use — stop the other dev server first`); }
  catch (e) { if (String(e.message).startsWith("port")) throw e; }
  rmSync(PERSIST, { recursive: true, force: true });
  writeFileSync(DEVLOG, "");
  writeVars([`DATA_KEY=${KEY1}`]);
  execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "walkwithus", "--local", "--persist-to", PERSIST], { stdio: "ignore", timeout: 90000 });
  sql(`INSERT INTO orgs (id, slug, name, borough) VALUES (1,'crotona-test','Crotona Test Program','Bronx'), (2,'other-org','Other Org','Queens');
       INSERT INTO corners (id, org_id, label, cross_streets, lat, lon) VALUES
         (1,1,'Crotona Ave & E 173 St','NE corner, by the park gate',40.8399,-73.8935),
         (2,1,'E 171 St & Crotona Pl','South side',40.8381,-73.8986),
         (3,2,'Other corner','x y z',40.75,-73.80);
       INSERT INTO windows (org_id, corner_id, dow, start_min, end_min) VALUES
         (1,1,0,0,1440),(1,1,1,0,1440),(1,1,2,0,1440),(1,1,3,0,1440),(1,1,4,0,1440),(1,1,5,0,1440),(1,1,6,0,1440),
         (1,2,1,450,525);
       INSERT INTO coordinators (email, org_id, role) VALUES ('admin@org.test',1,'admin'), ('coord@org.test',1,'coordinator'),
         ('other@org.test',2,'admin'), ('bulk@org.test',1,'coordinator'), ('rot@org.test',1,'admin');`);
  await startServer();
});
after(async () => {
  await stopServer().catch(() => {});
  rmSync(".dev.vars", { force: true });
});

// ---------------------------------------------------------------- public surface
test("public org page exposes schedule only — no live presence, no people", async () => {
  const r = await req("/api/o/crotona-test");
  assert.equal(r.status, 200);
  assert.equal(r.j.corners.length, 2);
  const s = JSON.stringify(r.j);
  for (const forbidden of ["adults_now", "volunteer", "phone_enc", "checkin", "callback"]) assert.ok(!s.includes(forbidden), forbidden);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
});

test("static pages carry a strict CSP and no third-party origins", async () => {
  const r = await fetch(BASE + "/");
  assert.equal(r.status, 200);
  const csp = r.headers.get("content-security-policy") || "";
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(r.headers.get("permissions-policy") || "", /geolocation=\(\)/);
  const html = await r.text();
  assert.ok(!/https?:\/\/(?!www\.openstreetmap|www\.schools|advocatesfor)/.test(html.replace(/href="tel:[^"]+"/g, "")), "no external URLs in shell");
});

test("unknown org → 404; malformed slug → 404", async () => {
  assert.equal((await req("/api/o/nope-nope")).status, 404);
  assert.equal((await req("/api/o/..%2f..")).status, 404);
});

// ---------------------------------------------------------------- walk requests: the privacy wall
test("walk request: strict schema rejects any location/child field", async () => {
  for (const extra of [{ lat: 40.8, lon: -73.9 }, { child_name: "x" }, { school: "09X001" }, { note: "free text" }]) {
    const r = await req("/api/o/crotona-test/walk", { method: "POST",
      body: { corner_id: 1, date: nyDate(1), time: "08:00", callback: "718-555-0123", consent: true, ...extra } });
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.match(r.j.error, /^unknown_field:/);
  }
});

test("walk request: validation (consent, corner of another org, outside coverage, past, 15-min grid, phone)", async () => {
  const ok = { corner_id: 1, date: nyDate(1), time: "08:00", callback: "(718) 555-0123", consent: true };
  const cases = [
    [{ ...ok, consent: false }, "consent_required"],
    [{ ...ok, corner_id: 3 }, "bad_corner"],
    [{ ...ok, corner_id: 2, time: "15:00" }, "outside_published_coverage"],
    [{ ...ok, date: nyDate(-3) }, "slot_out_of_range"],
    [{ ...ok, date: nyDate(20) }, "slot_out_of_range"],
    [{ ...ok, time: "08:07" }, "slot_must_be_15_min"],
    [{ ...ok, callback: "123" }, "bad_phone"],
    [{ ...ok, callback: "+44 20 7946 0958" }, "bad_phone"],
  ];
  for (const [b, code] of cases) {
    const r = await req("/api/o/crotona-test/walk", { method: "POST", body: b });
    assert.equal(r.status, 400, code); assert.equal(r.j.error, code);
  }
});

let walkId, walkRef;
test("walk request accepted; callback stored only as ciphertext; expiry = slot + 72h", async () => {
  const r = await req("/api/o/crotona-test/walk", { method: "POST",
    body: { corner_id: 1, date: nyDate(1), time: "08:15", callback: "718-555-0199", lang: "es", consent: true } });
  assert.equal(r.status, 201, JSON.stringify(r.j));
  assert.match(r.j.ref, /^[2-9A-HJKMNP-TV-Z]{6}$/);
  assert.equal(r.j.deletes_at - r.j.slot_start, 72 * 3600);
  walkRef = r.j.ref;
  const row = sql(`SELECT id, callback_enc, callback_hmac, slot_start FROM walk_requests WHERE ref='${walkRef}'`)[0];
  walkId = row.id;
  assert.ok(row.callback_enc.startsWith("v1."));
  assert.ok(!row.callback_enc.includes("5550199") && !row.callback_hmac.includes("5550199"));
  assert.equal(row.slot_start % 900, 0);
  // structural wall: the table has no column that could hold a child's identity or location
  const cols = sql("PRAGMA table_info(walk_requests)").map((c) => c.name);
  for (const c of cols) assert.ok(!/child|student|name|lat|lon|geo|school|note|text/.test(c), "unexpected column " + c);
});

test("rate limits: 6th request/hour from one IP → 429; 4th/day for one callback → 429", async () => {
  const ip = "198.51.100.7";
  const mk = (i) => ({ corner_id: 1, date: nyDate(2), time: "09:00", callback: `718-555-01${10 + i}`, consent: true });
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await req("/api/o/crotona-test/walk", { method: "POST", ip, body: mk(i) })).status);
  assert.deepEqual(codes, [201, 201, 201, 201, 201, 429]);
  const c2 = [];
  for (let i = 0; i < 4; i++) c2.push((await req("/api/o/crotona-test/walk", { method: "POST", body: { ...mk(0), callback: "718-555-0177" } })).status);
  assert.deepEqual(c2, [201, 201, 201, 429]);
  assert.equal(sql("SELECT COUNT(*) n FROM rate WHERE k LIKE '%198.51%'")[0].n, 0, "raw IPs never stored");
});

test("CSRF/abuse: wrong content-type → 415, cross-origin → 403, oversized → 413", async () => {
  let r = await fetch(BASE + "/api/o/crotona-test/walk", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
  assert.equal(r.status, 415);
  r = await fetch(BASE + "/api/o/crotona-test/walk", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
  assert.equal(r.status, 403);
  r = await fetch(BASE + "/api/o/crotona-test/walk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ x: "a".repeat(5000) }) });
  assert.equal(r.status, 413);
});

// ---------------------------------------------------------------- volunteers
let v1, v2, v3, tok1;
test("volunteer apply → pending, encrypted, duplicate phone gives identical response", async () => {
  const mk = (name, phone) => req("/api/o/crotona-test/volunteer", { method: "POST", body: { name, phone, corners: [1, 2], briefing_ack: true } });
  assert.equal((await mk("Ana Rivera", "917-555-0101")).status, 202);
  assert.equal((await mk("Ben Osei", "917-555-0102")).status, 202);
  assert.equal((await mk("Cara Diaz", "917-555-0103")).status, 202);
  const dup = await mk("Someone Else", "917-555-0101");
  assert.equal(dup.status, 202);
  const rows = sql("SELECT id, name_enc, phone_enc, status FROM volunteers WHERE org_id=1 ORDER BY id");
  assert.equal(rows.length, 3);
  for (const r of rows) { assert.equal(r.status, "pending"); assert.ok(!/Ana|Ben|Cara|555/.test(r.name_enc + r.phone_enc)); }
  [v1, v2, v3] = rows.map((r) => r.id);
  assert.equal((await req("/api/o/crotona-test/volunteer", { method: "POST", body: { name: "No Ack", phone: "917-555-0109", briefing_ack: false } })).j.error, "briefing_ack_required");
});

// ---------------------------------------------------------------- coordinator identity
test("Access JWT: missing/forged/wrong-aud/expired/alg-none/unknown-kid/other-org all refused", async () => {
  const P = "/api/c/crotona-test/dashboard";
  assert.equal((await req(P)).status, 401);
  assert.equal((await req(P, { token: jwt({ email: "admin@org.test" }, { key: roguePriv }) })).status, 401, "forged signature");
  assert.equal((await req(P, { token: jwt({ email: "admin@org.test", aud: ["other"] }) })).status, 401, "wrong aud");
  assert.equal((await req(P, { token: jwt({ email: "admin@org.test", iss: "https://evil.cloudflareaccess.com" }) })).status, 401, "wrong iss");
  assert.equal((await req(P, { token: jwt({ email: "admin@org.test", exp: Math.floor(Date.now() / 1000) - 3600 }) })).status, 401, "expired");
  assert.equal((await req(P, { token: jwt({ email: "admin@org.test" }, { kid: "nope" }) })).status, 401, "unknown kid");
  const none = `${b64u(JSON.stringify({ alg: "none", kid: KID }))}.${b64u(JSON.stringify({ iss: `https://${TEAM}`, aud: [AUD], email: "admin@org.test", exp: 9e9 }))}.`;
  assert.equal((await req(P, { token: none })).status, 401, "alg none");
  assert.equal((await req(P, { token: jwt({ email: "stranger@x.test" }) })).status, 403, "valid identity, not a coordinator");
  assert.equal((await req(P, { token: jwt({ email: "other@org.test" }) })).status, 403, "coordinator of a different org");
  assert.equal((await req(P, { token: COORD() })).status, 200);
});

test("dashboard decrypts names for coordinators but masks phones; callback never in dashboard", async () => {
  const r = await req("/api/c/crotona-test/dashboard", { token: COORD() });
  const names = r.j.volunteers.map((v) => v.name).sort();
  assert.deepEqual(names, ["Ana Rivera", "Ben Osei", "Cara Diaz"]);
  for (const v of r.j.volunteers) assert.match(v.phone_masked, /^•••-•••-\d{4}$/);
  assert.ok(!JSON.stringify(r.j).includes("5550199"));
  assert.ok(r.j.walks.some((w) => w.id === walkId));
});

test("approve → one-time capability link; token stored only as hash; rotation invalidates old link", async () => {
  const a = await req(`/api/c/crotona-test/volunteers/${v1}/approve`, { method: "POST", token: COORD(), body: {} });
  assert.equal(a.status, 200);
  const t = /#t=([A-Za-z0-9_-]{43})$/.exec(a.j.checkin_link)[1];
  assert.ok(!sql(`SELECT token_hash FROM volunteers WHERE id=${v1}`)[0].token_hash.includes(t));
  const b = await req(`/api/c/crotona-test/volunteers/${v1}/approve`, { method: "POST", token: COORD(), body: {} });
  tok1 = /#t=([A-Za-z0-9_-]{43})$/.exec(b.j.checkin_link)[1];
  assert.equal((await req("/api/v/me", { method: "POST", body: { token: t } })).status, 401, "old token dead");
  assert.equal((await req("/api/v/me", { method: "POST", body: { token: tok1 } })).status, 200);
  await req(`/api/c/crotona-test/volunteers/${v2}/approve`, { method: "POST", token: COORD(), body: {} });
});

test("volunteer check-in/out: one open shift, corner must belong to org, bad token 401", async () => {
  assert.equal((await req("/api/v/checkin", { method: "POST", body: { token: "x".repeat(43), corner_id: 1 } })).status, 401);
  assert.equal((await req("/api/v/checkin", { method: "POST", body: { token: tok1, corner_id: 3 } })).j.error, "bad_corner");
  assert.equal((await req("/api/v/checkin", { method: "POST", body: { token: tok1, corner_id: 1 } })).status, 200);
  assert.equal((await req("/api/v/checkin", { method: "POST", body: { token: tok1, corner_id: 2 } })).j.error, "already_checked_in");
  const d = await req("/api/c/crotona-test/dashboard", { token: COORD() });
  assert.equal(d.j.corners.find((c) => c.id === 1).adults_now, 1);
  assert.equal((await req("/api/v/checkout", { method: "POST", body: { token: tok1 } })).status, 200);
  assert.equal((await req("/api/v/checkout", { method: "POST", body: { token: tok1 } })).j.error, "not_checked_in");
});

// ---------------------------------------------------------------- Rule of Two
test("Rule of Two enforced in API and in the database itself", async () => {
  const A = (b) => req(`/api/c/crotona-test/walks/${walkId}/assign`, { method: "POST", token: COORD(), body: b });
  assert.equal((await A({ v1, v2: v1 })).j.error, "rule_of_two_needs_two_distinct_adults");
  assert.equal((await A({ v1, v2: v3 })).j.error, "both_adults_must_be_approved", "v3 still pending");
  assert.equal((await req(`/api/c/crotona-test/walks/${walkId}/close`, { method: "POST", token: COORD(), body: { status: "done" } })).j.error,
    "only_assigned_walks_can_be_done");
  assert.ok(sqlFails(`UPDATE walk_requests SET status='assigned', v1=${v1}, v2=NULL WHERE id='${walkId}'`), "DB CHECK blocks one adult");
  assert.ok(sqlFails(`UPDATE walk_requests SET status='assigned', v1=${v1}, v2=${v1} WHERE id='${walkId}'`), "DB CHECK blocks same adult twice");
  assert.equal((await A({ v1, v2 })).status, 200);
  const me = await req("/api/v/me", { method: "POST", body: { token: tok1 } });
  const w = me.j.walks.find((x) => x.ref === walkRef);
  assert.ok(w); assert.ok(!("callback" in w), "volunteers never receive the family's number");
});

test("callback reveal is logged; suspend kills the link and closes the shift", async () => {
  const r = await req(`/api/c/crotona-test/walks/${walkId}/reveal`, { method: "POST", token: COORD(), body: {} });
  assert.equal(r.j.callback, "+17185550199");
  assert.ok(sql("SELECT COUNT(*) n FROM audit WHERE action='walk_callback_revealed' AND actor='coord@org.test'")[0].n >= 1);
  await req("/api/v/checkin", { method: "POST", body: { token: tok1, corner_id: 1 } });
  assert.equal((await req(`/api/c/crotona-test/volunteers/${v1}/suspend`, { method: "POST", token: COORD(), body: {} })).status, 200);
  assert.equal((await req("/api/v/me", { method: "POST", body: { token: tok1 } })).status, 401);
  assert.equal(sql(`SELECT COUNT(*) n FROM shifts WHERE volunteer_id=${v1} AND checkout_at IS NULL`)[0].n, 0);
});

test("admin-only actions refused for a coordinator; allowed for admin", async () => {
  const body = { label: "Test Ave & 1 St", cross_streets: "corner", lat: 40.84, lon: -73.9 };
  assert.equal((await req("/api/c/crotona-test/corners", { method: "POST", token: COORD(), body })).j.error, "admin_only");
  assert.equal((await req("/api/c/crotona-test/corners", { method: "POST", token: ADMIN(), body: { ...body, lat: 51.5 } })).j.error, "outside_nyc");
  assert.equal((await req("/api/c/crotona-test/corners", { method: "POST", token: ADMIN(), body })).status, 201);
  assert.equal((await req("/api/c/crotona-test/windows", { method: "POST", token: ADMIN(), body: { corner_id: 1, dow: 1, start: "07:10", end: "08:00" } })).j.error, "bad_hhmm_15");
});

// ---------------------------------------------------------------- audit integrity
test("audit chain verifies; rows cannot be altered or deleted", async () => {
  const v = await req("/api/c/crotona-test/audit/verify", { method: "POST", token: ADMIN(), body: {} });
  assert.equal(v.status, 200); assert.equal(v.j.ok, true); assert.ok(v.j.entries >= 10);
  assert.ok(sqlFails("UPDATE audit SET actor='nobody' WHERE seq=1"), "update blocked");
  assert.ok(sqlFails("DELETE FROM audit WHERE seq=1"), "delete blocked");
  assert.ok(sqlFails("INSERT INTO audit (org_id,ts,actor,action,subject,prev,hash) SELECT org_id,ts,actor,action,subject,prev,'x' FROM audit WHERE seq=1"), "fork blocked");
  const all = JSON.stringify(sql("SELECT * FROM audit"));
  assert.ok(!/5550\d{3}|Rivera|Osei|Diaz|\+1\d{10}/.test(all), "audit holds no personal data");
});

// ---------------------------------------------------------------- retention
test("cron purge: expired requests deleted, done walks and adult-minutes aggregated, identities gone", async () => {
  sql(`UPDATE walk_requests SET status='done', expires_at = unixepoch() - 10 WHERE id='${walkId}'`);
  sql(`UPDATE walk_requests SET expires_at = unixepoch() - 10 WHERE status='open'`);
  sql(`UPDATE shifts SET checkin_at = unixepoch() - 400000, checkout_at = unixepoch() - 399000`);
  const before = sql("SELECT COUNT(*) n FROM walk_requests")[0].n;
  assert.ok(before > 0);
  let r;
  try { r = await fetch(BASE + "/__scheduled?cron=17+*+*+*+*", { headers: { connection: "close" } }); }
  catch (e) { throw new Error("dev server unreachable; last log:\n" + devTail()); }
  assert.equal(r.status, 200);
  assert.equal(sql("SELECT COUNT(*) n FROM walk_requests")[0].n, 0);
  assert.equal(sql("SELECT COUNT(*) n FROM shifts")[0].n, 0);
  const agg = sql("SELECT SUM(walks_done) w, SUM(adult_minutes) m FROM coverage_daily")[0];
  assert.equal(agg.w, 1); assert.ok(agg.m > 0);
});

// ---------------------------------------------------------------- v1.1 hardening
test("observability: every API response carries a request id and API-level CSP/HSTS", async () => {
  const r = await req("/api/o/crotona-test");
  assert.match(r.headers.get("x-request-id") || "", /^[0-9a-f-]{36}$/);
  assert.match(r.headers.get("content-security-policy") || "", /default-src 'none'/);
  assert.match(r.headers.get("strict-transport-security") || "", /max-age=63072000/);
  const e = await req("/api/o/nope-nope");
  assert.equal(e.j.request_id, e.headers.get("x-request-id"), "errors return the id so support can find the log line");
});

test("readiness probe reports maintenance and audit status without personal data", async () => {
  const r = await req("/api/health/ready");
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.ok, true);
  assert.equal(r.j.checks.db, true);
  assert.equal(r.j.checks.keys, true);
  assert.equal(r.j.checks.purge.ok, true, "cron purge ran in the previous test and recorded success");
  assert.equal(r.j.checks.audit_verify.result.ok, true);
  assert.ok(!/5550|Rivera|Osei|Diaz|@/.test(JSON.stringify(r.j)), "no personal data or emails in health");
});

test("public schedule is edge-cached and invalidated by admin changes", async () => {
  await req("/api/c/crotona-test/windows", { method: "POST", token: ADMIN(), body: { corner_id: 2, dow: 2, start: "07:30", end: "08:45" } });
  const a = await req("/api/o/crotona-test");
  assert.equal(a.headers.get("x-cache"), "miss", "invalidated by the admin change");
  const b = await req("/api/o/crotona-test");
  assert.equal(b.headers.get("x-cache"), "hit");
  assert.ok(b.j.windows.some((w) => w.corner_id === 2 && w.dow === 2));
});

test("NYC languages: Local Law 30 + West African call languages accepted; unknown codes fall back to English", async () => {
  for (const lang of ["zh", "bn", "ht", "ar", "ur", "ak", "wo"]) {
    const r = await req("/api/o/crotona-test/walk", { method: "POST",
      body: { corner_id: 1, date: nyDate(3), time: "10:00", callback: `646-555-01${lang.charCodeAt(0) % 90 + 10}`, lang, consent: true } });
    assert.equal(r.status, 201, lang + " " + JSON.stringify(r.j));
    assert.equal(sql(`SELECT lang FROM walk_requests WHERE ref='${r.j.ref}'`)[0].lang, lang);
  }
  const x = await req("/api/o/crotona-test/walk", { method: "POST",
    body: { corner_id: 1, date: nyDate(3), time: "10:15", callback: "646-555-0199", lang: "xx", consent: true } });
  assert.equal(sql(`SELECT lang FROM walk_requests WHERE ref='${x.j.ref}'`)[0].lang, "en");
});

test("bulk-exfiltration ceiling: a coordinator can decrypt at most 30 numbers per hour; the 31st is refused and audited", async () => {
  const vid = sql("SELECT id FROM volunteers WHERE org_id=1 ORDER BY id LIMIT 1")[0].id;
  const codes = [];
  for (let i = 0; i < 31; i++) codes.push((await req(`/api/c/crotona-test/volunteers/${vid}/reveal`, { method: "POST", token: jwt({ email: "bulk@org.test" }), body: {} })).status);
  assert.deepEqual(codes.slice(0, 30), Array(30).fill(200));
  assert.equal(codes[30], 429);
  assert.equal(sql("SELECT COUNT(*) n FROM audit WHERE actor='bulk@org.test' AND action='reveal_throttled'")[0].n, 1);
  assert.equal((await req(`/api/c/crotona-test/volunteers/${vid}/reveal`, { method: "POST", token: COORD(), body: {} })).status, 200, "limit is per coordinator");
});

test("key rotation drill: old ciphertext readable under DATA_KEY_PREV, cron re-seals, then the old key can be removed", async () => {
  const ROT = () => jwt({ email: "rot@org.test" });
  const vid = sql("SELECT id FROM volunteers WHERE org_id=1 ORDER BY id LIMIT 1 OFFSET 1")[0].id;
  const before = (await req(`/api/c/crotona-test/volunteers/${vid}/reveal`, { method: "POST", token: ROT(), body: {} })).j.phone;
  assert.match(before, /^\+1\d{10}$/);
  const sealedBefore = sql(`SELECT phone_enc FROM volunteers WHERE id=${vid}`)[0].phone_enc;

  await stopServer(); writeVars([`DATA_KEY=${KEY2}`, `DATA_KEY_PREV=${KEY1}`]); await startServer();
  assert.equal((await req(`/api/c/crotona-test/volunteers/${vid}/reveal`, { method: "POST", token: ROT(), body: {} })).j.phone, before, "readable during rotation");
  const ready = await req("/api/health/ready");
  assert.equal(ready.j.checks.rotation_in_progress, true);
  assert.equal((await fetch(BASE + "/__scheduled?cron=17+*+*+*+*", { headers: { connection: "close" } })).status, 200);
  const rk = JSON.parse(sql("SELECT v FROM system_status WHERE k='rekey'")[0].v);
  assert.equal(rk.ok, true); assert.ok(rk.result.resealed >= 1, JSON.stringify(rk)); assert.equal(rk.result.failed, 0);
  assert.notEqual(sql(`SELECT phone_enc FROM volunteers WHERE id=${vid}`)[0].phone_enc, sealedBefore, "row re-sealed under the new key");

  await stopServer(); writeVars([`DATA_KEY=${KEY2}`]); await startServer();
  assert.equal((await req(`/api/c/crotona-test/volunteers/${vid}/reveal`, { method: "POST", token: ROT(), body: {} })).j.phone, before, "readable with only the new key");
  const walkRow = sql("SELECT id FROM walk_requests LIMIT 1")[0];
  const w = await req(`/api/c/crotona-test/walks/${walkRow.id}/reveal`, { method: "POST", token: ROT(), body: {} });
  assert.match(w.j.callback, /^\+1\d{10}$/, "walk callbacks re-sealed too");
});
