// Walk With Us — Worker entry. Coordinates ADULTS on public corners. Never tracks children.
// Routes:
//   public      GET  /api/orgs                      list active orgs
//               GET  /api/o/:slug                   org, corners, published schedule (no live data)
//               POST /api/o/:slug/volunteer         adult volunteer application (pending until approved in person)
//               POST /api/o/:slug/walk              "walk with me" request: public corner + 15-min slot + callback
//   volunteer   POST /api/v/me | /api/v/checkin | /api/v/checkout     (256-bit capability token in body)
//   coordinator /api/c/...                          Cloudflare Access JWT + coordinators table
import { verifyAccess, type Identity } from "./access";
import { seal, open, hmac, sha256, randomString, capabilityToken, REF_ALPHABET, ID_ALPHABET } from "./crypto";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  DATA_KEY: string;
  DATA_KEY_PREV?: string;      // previous key during rotation: decrypt-only; cron re-seals rows under DATA_KEY
  HMAC_KEY: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITEKEY?: string;
  APP_NAME: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ACCESS_JWKS_JSON?: string;   // tests only: key set used instead of fetching certs; verification still enforced
  DEBUG?: string;              // "1" = include error message + first stack frame in logs. Local/dev only — never in production.
  RETENTION_HOURS: string;
}

const VERSION = "1.1.3";
const LANGS = ["en", "es", "zh", "ru", "bn", "ht", "ko", "ar", "ur", "fr", "pl", "ak", "wo", "ff"] as const;

// ------------------------------------------------------------------ observability (structured, never personal data)
function log(level: "info" | "warn" | "error", event: string, fields: Record<string, string | number | boolean | null> = {}): void {
  const line = JSON.stringify({ level, event, v: VERSION, ...fields });
  if (level === "error") console.error(line); else if (level === "warn") console.warn(line); else console.log(line);
}
/** Route template for logs: ids and slugs collapsed so logs carry shape, not identifiers. */
function routeOf(path: string): string {
  return path.replace(/\/o\/[a-z0-9-]+/, "/o/:org").replace(/\/c\/(?!me$)[a-z0-9-]+/, "/c/:org")
    .replace(/\/[0-9a-z]{26}(?=\/|$)/, "/:walk").replace(/\/\d+(?=\/|$)/, "/:id");
}

/** Retry transient D1 failures (network blips, object resets) for idempotent reads only. */
async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      const m = String(e);
      if (i + 1 >= attempts || !/Network connection lost|reset|overloaded|temporarily|SQLITE_BUSY|internal error/i.test(m)) throw e;
      await new Promise((r) => setTimeout(r, 50 * 2 ** i));
    }
  }
}

// ------------------------------------------------------------------ http helpers
class HttpError extends Error { constructor(public status: number, public code: string) { super(code); } }
const SEC_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
};
function json(obj: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...SEC_HEADERS, ...extra } });
}
function bad(code: string): never { throw new HttpError(400, code); }

async function body<T extends Record<string, unknown>>(req: Request, allowed: readonly string[]): Promise<T> {
  if (!(req.headers.get("content-type") || "").startsWith("application/json")) throw new HttpError(415, "json_required");
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) throw new HttpError(403, "cross_origin");
  const text = await req.text();
  if (text.length > 4096) throw new HttpError(413, "too_large");
  let obj: unknown;
  try { obj = JSON.parse(text); } catch { bad("bad_json"); }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) bad("bad_json");
  for (const k of Object.keys(obj as object)) if (!allowed.includes(k)) bad("unknown_field:" + k.slice(0, 32));
  return obj as T;
}
const str = (v: unknown, min: number, max: number, code: string): string => {
  if (typeof v !== "string") bad(code);
  const s = v.normalize("NFKC").trim();
  if (s.length < min || s.length > max || /[\u0000-\u001f\u007f<>]/.test(s)) bad(code);
  return s;
};
const int = (v: unknown, code: string): number => {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) bad(code);
  return v;
};
/** US phone → E.164 digits. Rejects anything else. */
function phone(v: unknown): string {
  const d = str(v, 7, 24, "bad_phone").replace(/[^\d]/g, "");
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(n)) bad("bad_phone");
  return "+1" + n;
}

// ------------------------------------------------------------------ time (America/New_York)
const TZ = "America/New_York";
function nyParts(epochSec: number): { y: number; m: number; d: number; dow: number; min: number } {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date(epochSec * 1000)).map((x) => [x.type, x.value]));
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { y: +p.year!, m: +p.month!, d: +p.day!, dow: dows.indexOf(p.weekday!), min: +p.hour! * 60 + +p.minute! };
}
/** Local NY date + HH:MM → epoch seconds (DST-correct by fixed-point iteration). */
function nyToEpoch(date: string, time: string): number {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date), tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) bad("bad_time");
  const want = Date.UTC(+dm[1]!, +dm[2]! - 1, +dm[3]!, +tm[1]!, +tm[2]!) / 1000;
  let t = want + 5 * 3600;
  for (let i = 0; i < 3; i++) {
    const p = nyParts(t);
    const got = Date.UTC(p.y, p.m - 1, p.d, Math.floor(p.min / 60), p.min % 60) / 1000;
    t += want - got;
  }
  return t;
}

// ------------------------------------------------------------------ rate limiting (keyed-hash keys, no raw IPs)
async function limit(env: Env, scope: string, subject: string, max: number, windowSec: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const ws = now - (now % windowSec);
  const day = new Date(now * 1000).toISOString().slice(0, 10);
  const k = await hmac(env.HMAC_KEY, `rate|${day}|${scope}|${subject}`);
  const row = await env.DB.prepare(
    `INSERT INTO rate (k, window_start, n) VALUES (?1, ?2, 1)
     ON CONFLICT(k) DO UPDATE SET n = CASE WHEN window_start = ?2 THEN n + 1 ELSE 1 END, window_start = ?2
     RETURNING n`).bind(k, ws).first<{ n: number }>();
  if ((row?.n ?? 0) > max) throw new HttpError(429, "rate_limited");
}
const clientIp = (req: Request) => req.headers.get("cf-connecting-ip") || "local";

async function turnstile(env: Env, token: unknown, req: Request): Promise<void> {
  if (!env.TURNSTILE_SECRET) return;
  if (typeof token !== "string" || token.length > 2048) bad("bot_check_required");
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: clientIp(req) }) });
  const d = await r.json<{ success: boolean }>();
  if (!d.success) bad("bot_check_failed");
}

// ------------------------------------------------------------------ audit (append-only, hash-chained, fork-proof)
async function audit(env: Env, orgId: number, actor: string, action: string, subject: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const last = await env.DB.prepare("SELECT hash FROM audit ORDER BY seq DESC LIMIT 1").first<{ hash: string }>();
    const prev = last?.hash ?? "0".repeat(64);
    const ts = Math.floor(Date.now() / 1000);
    const hash = await sha256([prev, orgId, ts, actor, action, subject].join("|"));
    try {
      await env.DB.prepare("INSERT INTO audit (org_id, ts, actor, action, subject, prev, hash) VALUES (?,?,?,?,?,?,?)")
        .bind(orgId, ts, actor, action, subject, prev, hash).run();
      return;
    } catch (e) { if (!String(e).includes("UNIQUE")) throw e; }   // a concurrent writer took `prev`; re-read and retry
  }
  throw new HttpError(503, "audit_busy");
}
async function auditVerify(env: Env): Promise<{ ok: boolean; entries: number; broken_at?: number }> {
  const { results } = await env.DB.prepare("SELECT * FROM audit ORDER BY seq").all<Record<string, string | number>>();
  let prev = "0".repeat(64);
  for (const r of results) {
    const h = await sha256([r.prev, r.org_id, r.ts, r.actor, r.action, r.subject].join("|"));
    if (r.prev !== prev || r.hash !== h) return { ok: false, entries: results.length, broken_at: Number(r.seq) };
    prev = String(r.hash);
  }
  return { ok: true, entries: results.length };
}

// ------------------------------------------------------------------ decryption with key rotation
async function openAny(env: Env, aad: string, sealed: string): Promise<string> {
  try { return await open(env.DATA_KEY, aad, sealed); }
  catch (e) { if (!env.DATA_KEY_PREV) throw e; return await open(env.DATA_KEY_PREV, aad, sealed); }
}

// ------------------------------------------------------------------ lookups
interface Org { id: number; slug: string; name: string; public_phone: string | null; borough: string | null; }
async function orgBySlug(env: Env, slug: string): Promise<Org> {
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) throw new HttpError(404, "no_org");
  const o = await retry(() => env.DB.prepare("SELECT id, slug, name, public_phone, borough FROM orgs WHERE slug=? AND active=1")
    .bind(slug).first<Org>());
  if (!o) throw new HttpError(404, "no_org");
  return o;
}
async function corner(env: Env, orgId: number, id: number) {
  const c = await env.DB.prepare("SELECT id, label FROM corners WHERE id=? AND org_id=? AND active=1").bind(id, orgId)
    .first<{ id: number; label: string }>();
  if (!c) bad("bad_corner");
  return c;
}

// ------------------------------------------------------------------ public handlers
// Public schedule is public data: served from the edge cache for 60 s (cuts D1 reads) and, if D1 is unavailable,
// served stale for up to 24 h (stale-if-error) so families can still see when adults are on duty.
const cacheKey = (slug: string) => new Request(`https://cache.walkwithus.internal/org/${slug}`);
const FRESH_S = 60, STALE_S = 86400;
async function invalidateOrg(slug: string): Promise<void> {
  try { await caches.default.delete(cacheKey(slug)); } catch { /* cache unavailable (e.g. workers.dev): nothing to invalidate */ }
}
async function publicOrg(env: Env, slug: string): Promise<Response> {
  const key = cacheKey(slug);
  let cached: Response | undefined;
  try { cached = await caches.default.match(key); } catch { cached = undefined; }
  const age = cached ? Math.floor(Date.now() / 1000) - Number(cached.headers.get("x-fetched-at") || 0) : Infinity;
  if (cached && age < FRESH_S) return json(await cached.json(), 200, { "x-cache": "hit" });
  try {
    const o = await orgBySlug(env, slug);
    const corners = (await retry(() => env.DB.prepare(
      "SELECT id, label, cross_streets, lat, lon FROM corners WHERE org_id=? AND active=1 ORDER BY label").bind(o.id).all())).results;
    const windows = (await retry(() => env.DB.prepare(
      "SELECT corner_id, dow, start_min, end_min FROM windows WHERE org_id=? ORDER BY dow, start_min").bind(o.id).all())).results;
    const body = { org: { slug: o.slug, name: o.name, public_phone: o.public_phone, borough: o.borough },
      corners, windows, turnstile_sitekey: env.TURNSTILE_SITEKEY || null, retention_hours: Number(env.RETENTION_HOURS) };
    try {
      await caches.default.put(key, new Response(JSON.stringify(body), { headers: {
        "content-type": "application/json", "cache-control": `public, max-age=${STALE_S}`, "x-fetched-at": String(Math.floor(Date.now() / 1000)) } }));
    } catch { /* best effort */ }
    return json(body, 200, { "x-cache": "miss" });
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) throw e;
    if (cached && age < STALE_S) {
      log("warn", "serve_stale_schedule", { age_s: age });
      return json(await cached.json(), 200, { "x-cache": "stale", "x-stale-age": String(age) });
    }
    throw e;
  }
}

async function volunteerApply(req: Request, env: Env, slug: string): Promise<Response> {
  const o = await orgBySlug(env, slug);
  await limit(env, "vol-ip", clientIp(req), 5, 3600);
  const b = await body<Record<string, unknown>>(req, ["name", "phone", "corners", "briefing_ack", "turnstile"]);
  await turnstile(env, b.turnstile, req);
  const name = str(b.name, 2, 80, "bad_name");
  const ph = phone(b.phone);
  if (b.briefing_ack !== true) bad("briefing_ack_required");
  const prefs = Array.isArray(b.corners) ? b.corners.slice(0, 10).map((x) => int(x, "bad_corner")) : [];
  for (const id of prefs) await corner(env, o.id, id);
  const phHash = await hmac(env.HMAC_KEY, "phone|" + ph);
  const aad = (f: string) => `volunteers|${f}|${o.id}`;
  const res = await env.DB.prepare(
    `INSERT INTO volunteers (org_id, name_enc, phone_enc, phone_hmac, corners_pref, briefing_ack)
     VALUES (?,?,?,?,?,1) ON CONFLICT(org_id, phone_hmac) DO NOTHING`)
    .bind(o.id, await seal(env.DATA_KEY, aad("name"), name), await seal(env.DATA_KEY, aad("phone"), ph), phHash,
      JSON.stringify(prefs)).run();
  // Same response whether new or duplicate: the endpoint does not reveal who has already applied.
  if (res.meta.changes) await audit(env, o.id, "public", "volunteer_applied", "vol");
  return json({ ok: true, next: "A coordinator will contact you to meet in person before you are approved." }, 202);
}

async function walkRequest(req: Request, env: Env, slug: string): Promise<Response> {
  const o = await orgBySlug(env, slug);
  await limit(env, "walk-ip", clientIp(req), 5, 3600);
  const b = await body<Record<string, unknown>>(req, ["corner_id", "date", "time", "callback", "lang", "consent", "turnstile"]);
  await turnstile(env, b.turnstile, req);
  if (b.consent !== true) bad("consent_required");
  const c = await corner(env, o.id, int(b.corner_id, "bad_corner"));
  const slot = nyToEpoch(str(b.date, 10, 10, "bad_time"), str(b.time, 5, 5, "bad_time"));
  if (slot % 900 !== 0) bad("slot_must_be_15_min");
  const now = Math.floor(Date.now() / 1000);
  if (slot < now - 300 || slot > now + 14 * 86400) bad("slot_out_of_range");
  const p = nyParts(slot);
  const w = await env.DB.prepare(
    "SELECT 1 FROM windows WHERE org_id=? AND corner_id=? AND dow=? AND start_min<=? AND end_min>?")
    .bind(o.id, c.id, p.dow, p.min, p.min).first();
  if (!w) bad("outside_published_coverage");
  const cb = phone(b.callback);
  const cbHash = await hmac(env.HMAC_KEY, "callback|" + cb);
  await limit(env, "walk-callback", cbHash, 3, 86400);
  const lang = typeof b.lang === "string" && (LANGS as readonly string[]).includes(b.lang) ? b.lang : "en";
  const id = randomString(26, ID_ALPHABET), ref = randomString(6, REF_ALPHABET);
  const expires = slot + Number(env.RETENTION_HOURS || 72) * 3600;
  await env.DB.prepare(
    `INSERT INTO walk_requests (id, ref, org_id, corner_id, slot_start, callback_enc, callback_hmac, lang, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(id, ref, o.id, c.id, slot, await seal(env.DATA_KEY, `walk|callback|${o.id}|${id}`, cb), cbHash, lang, expires).run();
  await audit(env, o.id, "public", "walk_requested", id);
  return json({ ok: true, ref, meeting_point: c.label, slot_start: slot, deletes_at: expires,
    next: "A coordinator will call you to confirm two adults. For danger now, call 911." }, 201);
}

// ------------------------------------------------------------------ volunteer handlers (capability token)
async function volunteerByToken(env: Env, token: unknown) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(401, "bad_token");
  const h = await sha256("cap|" + token);
  const v = await env.DB.prepare("SELECT id, org_id, name_enc FROM volunteers WHERE token_hash=? AND status='approved'")
    .bind(h).first<{ id: number; org_id: number; name_enc: string }>();
  if (!v) throw new HttpError(401, "bad_token");
  await limit(env, "vol-token", h, 60, 3600);
  return v;
}

async function volunteerApi(req: Request, env: Env, action: string): Promise<Response> {
  const b = await body<Record<string, unknown>>(req, ["token", "corner_id"]);
  const v = await volunteerByToken(env, b.token);
  const now = Math.floor(Date.now() / 1000);
  if (action === "me") {
    const shift = await env.DB.prepare(
      "SELECT s.corner_id, c.label, s.checkin_at FROM shifts s JOIN corners c ON c.id=s.corner_id WHERE s.volunteer_id=? AND s.checkout_at IS NULL")
      .bind(v.id).first();
    const walks = (await env.DB.prepare(
      `SELECT w.ref, w.slot_start, c.label AS meeting_point FROM walk_requests w JOIN corners c ON c.id=w.corner_id
       WHERE (w.v1=?1 OR w.v2=?1) AND w.status='assigned' AND w.slot_start > ?2 - 3600 ORDER BY w.slot_start`)
      .bind(v.id, now).all()).results;
    const corners = (await env.DB.prepare("SELECT id, label FROM corners WHERE org_id=? AND active=1 ORDER BY label")
      .bind(v.org_id).all()).results;
    const name = await openAny(env, `volunteers|name|${v.org_id}`, v.name_enc);
    return json({ first_name: name.split(/\s+/)[0], shift, walks, corners });
  }
  if (action === "checkin") {
    const c = await corner(env, v.org_id, int(b.corner_id, "bad_corner"));
    try {
      await env.DB.prepare("INSERT INTO shifts (org_id, volunteer_id, corner_id, checkin_at) VALUES (?,?,?,?)")
        .bind(v.org_id, v.id, c.id, now).run();
    } catch (e) { if (String(e).includes("UNIQUE")) bad("already_checked_in"); throw e; }
    await audit(env, v.org_id, `vol:${v.id}`, "checkin", `corner:${c.id}`);
    return json({ ok: true, corner: c.label });
  }
  if (action === "checkout") {
    const r = await env.DB.prepare("UPDATE shifts SET checkout_at=? WHERE volunteer_id=? AND checkout_at IS NULL")
      .bind(now, v.id).run();
    if (!r.meta.changes) bad("not_checked_in");
    await audit(env, v.org_id, `vol:${v.id}`, "checkout", "shift");
    return json({ ok: true });
  }
  throw new HttpError(404, "not_found");
}

// ------------------------------------------------------------------ coordinator handlers (Access + coordinators)
/** A coordinator can decrypt at most 30 contact numbers per hour. Normal work needs a handful; a bulk export cannot hide. */
const REVEALS_PER_HOUR = 30;
async function revealGuard(env: Env, orgId: number, actor: string): Promise<void> {
  try { await limit(env, "reveal", actor, REVEALS_PER_HOUR, 3600); }
  catch (e) {
    if (e instanceof HttpError && e.status === 429) { await audit(env, orgId, actor, "reveal_throttled", "limit"); log("warn", "reveal_throttled", { org: orgId }); }
    throw e;
  }
}
async function coordinator(req: Request, env: Env, slug: string): Promise<{ id: Identity; org: Org; role: string }> {
  const id = await verifyAccess(req, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD, env.ACCESS_JWKS_JSON);
  if (!id) throw new HttpError(401, "access_required");
  const org = await orgBySlug(env, slug);
  const row = await env.DB.prepare("SELECT role FROM coordinators WHERE email=? AND org_id=?").bind(id.email, org.id)
    .first<{ role: string }>();
  if (!row) throw new HttpError(403, "not_a_coordinator_for_org");
  return { id, org, role: row.role };
}

async function coordApi(req: Request, env: Env, slug: string, rest: string[]): Promise<Response> {
  const { id, org, role } = await coordinator(req, env, slug);
  const actor = id.email;
  const now = Math.floor(Date.now() / 1000);
  const [res, rid, verb] = rest;

  if (req.method === "GET" && res === "dashboard") {
    const corners = (await env.DB.prepare(
      `SELECT c.id, c.label, c.cross_streets, c.active,
              (SELECT COUNT(*) FROM shifts s WHERE s.corner_id=c.id AND s.checkout_at IS NULL) AS adults_now
       FROM corners c WHERE c.org_id=? ORDER BY c.label`).bind(org.id).all()).results;
    const walks = (await env.DB.prepare(
      `SELECT w.id, w.ref, w.corner_id, c.label AS meeting_point, w.slot_start, w.lang, w.status, w.v1, w.v2, w.expires_at
       FROM walk_requests w JOIN corners c ON c.id=w.corner_id
       WHERE w.org_id=? AND w.status IN ('open','assigned') ORDER BY w.slot_start`).bind(org.id).all()).results;
    const vrows = (await env.DB.prepare(
      "SELECT id, name_enc, phone_enc, status, corners_pref, created_at FROM volunteers WHERE org_id=? AND status<>'suspended' ORDER BY status, created_at")
      .bind(org.id).all<{ id: number; name_enc: string; phone_enc: string; status: string; corners_pref: string; created_at: number }>()).results;
    const volunteers = [];
    for (const v of vrows) {
      const ph = await openAny(env, `volunteers|phone|${org.id}`, v.phone_enc);
      volunteers.push({ id: v.id, name: await openAny(env, `volunteers|name|${org.id}`, v.name_enc),
        phone_masked: "•••-•••-" + ph.slice(-4), status: v.status, corners_pref: JSON.parse(v.corners_pref), created_at: v.created_at });
    }
    const onShift = (await env.DB.prepare(
      "SELECT volunteer_id, corner_id, checkin_at FROM shifts WHERE org_id=? AND checkout_at IS NULL").bind(org.id).all()).results;
    return json({ org: { slug: org.slug, name: org.name }, you: { email: actor, role }, corners, walks, volunteers, on_shift: onShift,
      rule_of_two: "a corner counts as covered only with >= 2 adults; a walk is assigned only to 2 distinct approved adults" });
  }

  if (req.method !== "POST") throw new HttpError(405, "method");

  if (res === "volunteers" && rid && (verb === "approve" || verb === "suspend" || verb === "reveal")) {
    await body(req, []);
    const vid = int(Number(rid), "bad_id");
    const v = await env.DB.prepare("SELECT id, status, phone_enc FROM volunteers WHERE id=? AND org_id=?").bind(vid, org.id)
      .first<{ id: number; status: string; phone_enc: string }>();
    if (!v) throw new HttpError(404, "no_volunteer");
    if (verb === "approve") {
      const tok = capabilityToken();
      await env.DB.prepare("UPDATE volunteers SET status='approved', token_hash=?, approved_by=?, approved_at=? WHERE id=?")
        .bind(await sha256("cap|" + tok), actor, now, vid).run();
      await audit(env, org.id, actor, v.status === "approved" ? "volunteer_token_rotated" : "volunteer_approved", `vol:${vid}`);
      // The token travels in the URL fragment: browsers never send fragments to servers, so it never appears in logs.
      return json({ ok: true, checkin_link: `${new URL(req.url).origin}/v.html#t=${tok}`,
        note: "Shown once. Give it to the volunteer in person or by Signal. Approving again rotates it." });
    }
    if (verb === "suspend") {
      await env.DB.batch([
        env.DB.prepare("UPDATE volunteers SET status='suspended', token_hash=NULL WHERE id=?").bind(vid),
        env.DB.prepare("UPDATE shifts SET checkout_at=? WHERE volunteer_id=? AND checkout_at IS NULL").bind(now, vid),
      ]);
      await audit(env, org.id, actor, "volunteer_suspended", `vol:${vid}`);
      return json({ ok: true });
    }
    await revealGuard(env, org.id, actor);
    await audit(env, org.id, actor, "volunteer_phone_revealed", `vol:${vid}`);
    return json({ phone: await openAny(env, `volunteers|phone|${org.id}`, v.phone_enc) });
  }

  if (res === "walks" && rid && /^[0-9a-z]{26}$/.test(rid)) {
    const w = await env.DB.prepare("SELECT id, status, callback_enc FROM walk_requests WHERE id=? AND org_id=?").bind(rid, org.id)
      .first<{ id: string; status: string; callback_enc: string }>();
    if (!w) throw new HttpError(404, "no_walk");
    if (verb === "reveal") {
      await body(req, []);
      await revealGuard(env, org.id, actor);
      await audit(env, org.id, actor, "walk_callback_revealed", w.id);
      return json({ callback: await openAny(env, `walk|callback|${org.id}|${w.id}`, w.callback_enc) });
    }
    if (verb === "assign") {
      const b = await body<Record<string, unknown>>(req, ["v1", "v2"]);
      const v1 = int(b.v1, "bad_v1"), v2 = int(b.v2, "bad_v2");
      if (v1 === v2) bad("rule_of_two_needs_two_distinct_adults");
      const ok = await env.DB.prepare("SELECT COUNT(*) AS n FROM volunteers WHERE org_id=? AND status='approved' AND id IN (?,?)")
        .bind(org.id, v1, v2).first<{ n: number }>();
      if (ok?.n !== 2) bad("both_adults_must_be_approved");
      if (!["open", "assigned"].includes(w.status)) bad("walk_closed");
      await env.DB.prepare("UPDATE walk_requests SET status='assigned', v1=?, v2=? WHERE id=?").bind(v1, v2, w.id).run();
      await audit(env, org.id, actor, "walk_assigned", `${w.id}|vol:${v1}|vol:${v2}`);
      return json({ ok: true });
    }
    if (verb === "close") {
      const b = await body<Record<string, unknown>>(req, ["status"]);
      if (b.status !== "done" && b.status !== "cancelled") bad("bad_status");
      if (b.status === "done" && w.status !== "assigned") bad("only_assigned_walks_can_be_done");
      await env.DB.prepare("UPDATE walk_requests SET status=? WHERE id=?").bind(b.status, w.id).run();
      await audit(env, org.id, actor, "walk_" + b.status, w.id);
      return json({ ok: true });
    }
  }

  if (role !== "admin") throw new HttpError(403, "admin_only");

  if (res === "corners" && !rid) {
    const b = await body<Record<string, unknown>>(req, ["label", "cross_streets", "lat", "lon"]);
    const lat = Number(b.lat), lon = Number(b.lon);
    if (!(lat >= 40.4 && lat <= 41.0 && lon >= -74.3 && lon <= -73.6)) bad("outside_nyc");
    const r = await env.DB.prepare("INSERT INTO corners (org_id, label, cross_streets, lat, lon) VALUES (?,?,?,?,?) RETURNING id")
      .bind(org.id, str(b.label, 3, 120, "bad_label"), str(b.cross_streets, 3, 160, "bad_cross_streets"),
        Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5).first<{ id: number }>();
    await audit(env, org.id, actor, "corner_created", `corner:${r?.id}`);
    await invalidateOrg(org.slug);
    return json({ ok: true, id: r?.id }, 201);
  }
  if (res === "corners" && rid && verb === "deactivate") {
    await body(req, []);
    await env.DB.prepare("UPDATE corners SET active=0 WHERE id=? AND org_id=?").bind(int(Number(rid), "bad_id"), org.id).run();
    await audit(env, org.id, actor, "corner_deactivated", `corner:${rid}`);
    await invalidateOrg(org.slug);
    return json({ ok: true });
  }
  if (res === "windows" && !rid) {
    const b = await body<Record<string, unknown>>(req, ["corner_id", "dow", "start", "end"]);
    const c = await corner(env, org.id, int(b.corner_id, "bad_corner"));
    const dow = Number(b.dow);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) bad("bad_dow");
    const hm = (s: unknown) => { const m = /^(\d{2}):(\d{2})$/.exec(String(s)); if (!m || +m[1]! > 23 || +m[2]! > 59 || +m[2]! % 15) bad("bad_hhmm_15"); return +m[1]! * 60 + +m[2]!; };
    const s = hm(b.start), e = hm(b.end);
    if (e <= s) bad("end_before_start");
    await env.DB.prepare("INSERT INTO windows (org_id, corner_id, dow, start_min, end_min) VALUES (?,?,?,?,?)").bind(org.id, c.id, dow, s, e).run();
    await audit(env, org.id, actor, "window_created", `corner:${c.id}|${dow}|${s}-${e}`);
    await invalidateOrg(org.slug);
    return json({ ok: true }, 201);
  }
  if (res === "coordinators" && !rid) {
    const b = await body<Record<string, unknown>>(req, ["email", "role"]);
    const email = str(b.email, 6, 254, "bad_email").toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) bad("bad_email");
    const r = b.role === "admin" ? "admin" : "coordinator";
    await env.DB.prepare("INSERT INTO coordinators (email, org_id, role) VALUES (?,?,?) ON CONFLICT DO UPDATE SET role=excluded.role")
      .bind(email, org.id, r).run();
    await audit(env, org.id, actor, "coordinator_set", `${r}`);
    return json({ ok: true });
  }
  if (res === "audit" && rid === "verify") return json(await auditVerify(env));
  throw new HttpError(404, "not_found");
}

// ------------------------------------------------------------------ retention (cron)
export async function purge(env: Env, nowSec = Math.floor(Date.now() / 1000)): Promise<Record<string, number>> {
  const retention = Number(env.RETENTION_HOURS || 72) * 3600;
  const day = (t: string) => `date(${t}, 'unixepoch')`;
  const r = await env.DB.batch([
    // close shifts left open > 4h (forgotten check-outs)
    env.DB.prepare("UPDATE shifts SET checkout_at = checkin_at + 14400 WHERE checkout_at IS NULL AND checkin_at < ?").bind(nowSec - 14400),
    // aggregate before delete (no identities survive)
    env.DB.prepare(`INSERT INTO coverage_daily (org_id, day, corner_id, adult_minutes)
       SELECT org_id, ${day("checkin_at")}, corner_id, SUM((checkout_at - checkin_at) / 60) FROM shifts
       WHERE checkout_at IS NOT NULL AND checkout_at < ? GROUP BY 1,2,3
       ON CONFLICT DO UPDATE SET adult_minutes = adult_minutes + excluded.adult_minutes`).bind(nowSec - retention),
    env.DB.prepare("DELETE FROM shifts WHERE checkout_at IS NOT NULL AND checkout_at < ?").bind(nowSec - retention),
    env.DB.prepare(`INSERT INTO coverage_daily (org_id, day, corner_id, walks_done)
       SELECT org_id, ${day("slot_start")}, corner_id, COUNT(*) FROM walk_requests WHERE status='done' AND expires_at < ? GROUP BY 1,2,3
       ON CONFLICT DO UPDATE SET walks_done = walks_done + excluded.walks_done`).bind(nowSec),
    env.DB.prepare("DELETE FROM walk_requests WHERE expires_at < ?").bind(nowSec),
    env.DB.prepare("DELETE FROM rate WHERE window_start < ?").bind(nowSec - 2 * 86400),
    env.DB.prepare("DELETE FROM volunteers WHERE status='pending' AND created_at < ?").bind(nowSec - 30 * 86400),
  ]);
  return { shifts_closed: r[0]!.meta.changes, shifts_purged: r[2]!.meta.changes, walks_purged: r[4]!.meta.changes,
    rate_purged: r[5]!.meta.changes, stale_applications_purged: r[6]!.meta.changes };
}

// ------------------------------------------------------------------ self-healing maintenance (cron)
async function setStatus(env: Env, k: string, v: unknown): Promise<void> {
  await env.DB.prepare("INSERT INTO system_status (k, v, at) VALUES (?,?,unixepoch()) ON CONFLICT(k) DO UPDATE SET v=excluded.v, at=excluded.at")
    .bind(k, JSON.stringify(v)).run();
}

/** Key rotation, healed in the background: any row still sealed under DATA_KEY_PREV is re-sealed under DATA_KEY. */
export async function rekey(env: Env, batch = 300): Promise<{ resealed: number; failed: number; pending: boolean }> {
  if (!env.DATA_KEY_PREV) return { resealed: 0, failed: 0, pending: false };
  let resealed = 0, failed = 0;
  const reseal = async (aad: string, sealed: string): Promise<string | null> => {
    try { await open(env.DATA_KEY, aad, sealed); return null; } catch { /* not under the current key */ }
    try { return await seal(env.DATA_KEY, aad, await open(env.DATA_KEY_PREV!, aad, sealed)); } catch { failed++; return null; }
  };
  const vols = (await env.DB.prepare("SELECT id, org_id, name_enc, phone_enc FROM volunteers LIMIT ?").bind(batch)
    .all<{ id: number; org_id: number; name_enc: string; phone_enc: string }>()).results;
  for (const v of vols) {
    const n = await reseal(`volunteers|name|${v.org_id}`, v.name_enc), ph = await reseal(`volunteers|phone|${v.org_id}`, v.phone_enc);
    if (n || ph) {
      await env.DB.prepare("UPDATE volunteers SET name_enc=?, phone_enc=? WHERE id=?").bind(n ?? v.name_enc, ph ?? v.phone_enc, v.id).run();
      resealed++;
    }
  }
  const walks = (await env.DB.prepare("SELECT id, org_id, callback_enc FROM walk_requests LIMIT ?").bind(batch)
    .all<{ id: string; org_id: number; callback_enc: string }>()).results;
  for (const w of walks) {
    const c = await reseal(`walk|callback|${w.org_id}|${w.id}`, w.callback_enc);
    if (c) { await env.DB.prepare("UPDATE walk_requests SET callback_enc=? WHERE id=?").bind(c, w.id).run(); resealed++; }
  }
  return { resealed, failed, pending: vols.length === batch || walks.length === batch };
}

/** Runs hourly. Each step is isolated: one failing step never blocks the others, and every outcome is recorded. */
export async function maintain(env: Env): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    const t0 = Date.now();
    try { out[name] = await fn(); await setStatus(env, name, { ok: true, result: out[name], ms: Date.now() - t0 }); }
    catch (e) {
      out[name] = { error: (e as Error).name };
      log("error", "maintenance_step_failed", { step: name, err: (e as Error).name });
      try { await setStatus(env, name, { ok: false, error: (e as Error).name, ms: Date.now() - t0 }); } catch { /* DB down: logged above */ }
    }
  };
  await step("purge", () => purge(env));
  await step("audit_verify", () => auditVerify(env));
  await step("rekey", () => rekey(env));
  log("info", "maintenance", { summary: JSON.stringify(out).slice(0, 500) });
  return out;
}

/** Readiness: DB reachable, keys well-formed, maintenance recent and green, audit chain intact. No personal data. */
async function health(env: Env): Promise<Response> {
  const checks: Record<string, unknown> = {};
  const keyOk = (k?: string) => { try { return !!k && atob(k).length >= 32; } catch { return false; } };
  checks.keys = keyOk(env.DATA_KEY) && keyOk(env.HMAC_KEY) && (!env.DATA_KEY_PREV || keyOk(env.DATA_KEY_PREV));
  checks.rotation_in_progress = !!env.DATA_KEY_PREV;
  checks.access_configured = !env.ACCESS_AUD.startsWith("REPLACE") && !env.ACCESS_TEAM_DOMAIN.startsWith("REPLACE");
  let dbOk = false;
  try {
    await retry(() => env.DB.prepare("SELECT 1").first());
    dbOk = true;
    const rows = (await env.DB.prepare("SELECT k, v, at FROM system_status").all<{ k: string; v: string; at: number }>()).results;
    const now = Math.floor(Date.now() / 1000);
    for (const r of rows) checks[r.k] = { ...JSON.parse(r.v), age_s: now - r.at };
  } catch { /* reported below */ }
  checks.db = dbOk;
  const pg = checks.purge as { ok?: boolean; age_s?: number } | undefined;
  const audit = checks.audit_verify as { ok?: boolean; result?: { ok?: boolean } } | undefined;
  const problems: string[] = [];
  if (!dbOk) problems.push("db_unreachable");
  if (!checks.keys) problems.push("keys_invalid");
  if (pg && (!pg.ok || (pg.age_s ?? 0) > 3 * 3600)) problems.push("maintenance_stale_or_failing");
  if (audit && audit.result && audit.result.ok === false) problems.push("audit_chain_broken");
  return json({ ok: problems.length === 0, version: VERSION, problems, checks }, problems.length ? 503 : 200);
}

// ------------------------------------------------------------------ router
async function route(req: Request, env: Env, p: string[]): Promise<Response> {
  if (!env.DATA_KEY || !env.HMAC_KEY) throw new HttpError(503, "not_configured");
  if (req.method === "GET" && p[1] === "health" && p.length === 2) return json({ ok: true, version: VERSION });
  if (req.method === "GET" && p[1] === "health" && p[2] === "ready") {
    await limit(env, "health", clientIp(req), 120, 3600);
    return await health(env);
  }
  if (req.method === "GET" && p[1] === "orgs" && p.length === 2) {
    const { results } = await retry(() => env.DB.prepare("SELECT slug, name, borough FROM orgs WHERE active=1 ORDER BY name").all());
    return json({ orgs: results });
  }
  if (p[1] === "o" && p[2]) {
    if (req.method === "GET" && p.length === 3) return await publicOrg(env, p[2]);
    if (req.method === "POST" && p[3] === "volunteer" && p.length === 4) return await volunteerApply(req, env, p[2]);
    if (req.method === "POST" && p[3] === "walk" && p.length === 4) return await walkRequest(req, env, p[2]);
  }
  if (p[1] === "v" && req.method === "POST" && p[2] && p.length === 3) return await volunteerApi(req, env, p[2]);
  if (p[1] === "c" && p[2] === "me" && req.method === "GET") {
    const id = await verifyAccess(req, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD, env.ACCESS_JWKS_JSON);
    if (!id) throw new HttpError(401, "access_required");
    const { results } = await env.DB.prepare(
      "SELECT o.slug, o.name, c.role FROM coordinators c JOIN orgs o ON o.id=c.org_id WHERE c.email=?").bind(id.email).all();
    return json({ email: id.email, orgs: results });
  }
  if (p[1] === "c" && p[2]) return await coordApi(req, env, p[2], p.slice(3));
  throw new HttpError(404, "not_found");
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname.split("/").filter(Boolean);
    if (p[0] !== "api") return env.ASSETS.fetch(req);
    const rid = crypto.randomUUID();
    const t0 = Date.now();
    let res: Response;
    try { res = await route(req, env, p); }
    catch (e) {
      if (e instanceof HttpError) res = json({ error: e.code, request_id: rid }, e.status);
      else {
        const dbg: Record<string, string> = env.DEBUG === "1" ? { msg: String((e as Error).message).slice(0, 200), at: String((e as Error).stack || "").split("\n")[1]?.trim().slice(0, 160) ?? "" } : {};
        log("error", "unhandled", { rid, route: routeOf(url.pathname), err: (e as Error).name, ...dbg });   // never bodies or personal data
        res = json({ error: "internal", request_id: rid }, 500);
      }
    }
    const out = new Response(res.body, res);
    out.headers.set("x-request-id", rid);
    if (res.status >= 500 || url.pathname.startsWith("/api/c/")) {
      log(res.status >= 500 ? "error" : "info", "request", { rid, m: req.method, route: routeOf(url.pathname), s: res.status, ms: Date.now() - t0 });
    }
    return out;
  },
  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(maintain(env));
  },
} satisfies ExportedHandler<Env>;
