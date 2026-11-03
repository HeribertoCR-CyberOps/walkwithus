// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Savvy Solution Pros LLC. Walk With Us — see NOTICE.
// Server-side sessions for program staff signed in with Google.
//  - The cookie holds a random 256-bit id; the database holds only its SHA-256 (a database copy signs nobody in).
//  - Cookie: __Host- prefix (this exact host, Path=/, Secure), HttpOnly (scripts cannot read it), SameSite=Lax.
//  - Ends on sign-out, after IDLE_S without use, after ABS_S at most, and when the person loses their last program role.
//  - The sign-in flow's state, nonce and PKCE verifier travel in a separate short-lived cookie, sealed (AES-GCM) so the
//    browser can neither read nor alter them, and bound to this purpose by its AAD.
import { seal, open, sha256, capabilityToken, b64url, ctEqual } from "./crypto";

export const SESSION_COOKIE = "__Host-wwu_s";
export const FLOW_COOKIE = "__Host-wwu_oa";
export const IDLE_S = 12 * 3600, ABS_S = 7 * 86400, FLOW_S = 600, TOUCH_S = 300, MAX_SESSIONS_PER_EMAIL = 10;

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
export function setCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}
export const clearCookie = (name: string) => setCookie(name, "", 0);

// ---------------------------------------------------------------- sign-in flow (state + nonce + PKCE)
export interface Flow { state: string; nonce: string; verifier: string; t: number; }
export async function newFlow(dataKey: string): Promise<{ flow: Flow; cookie: string; challenge: string }> {
  const flow: Flow = { state: capabilityToken(), nonce: capabilityToken(), verifier: capabilityToken() + capabilityToken(), t: Math.floor(Date.now() / 1000) };
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(flow.verifier)));
  const sealed = await seal(dataKey, "oauth-flow|v1", JSON.stringify(flow));
  return { flow, cookie: setCookie(FLOW_COOKIE, encodeURIComponent(sealed), FLOW_S), challenge };
}
/** The flow cookie must open under our key, be fresh, and carry exactly the state Google returned. */
export async function takeFlow(req: Request, dataKey: string, state: string): Promise<Flow | null> {
  const raw = readCookie(req, FLOW_COOKIE);
  if (!raw || raw.length > 2048) return null;
  let f: Flow;
  try { f = JSON.parse(await open(dataKey, "oauth-flow|v1", decodeURIComponent(raw))); } catch { return null; }
  const now = Math.floor(Date.now() / 1000);
  if (typeof f.t !== "number" || f.t > now + 60 || now - f.t > FLOW_S) return null;
  if (typeof f.state !== "string" || !ctEqual(f.state, state)) return null;
  return f;
}

// ---------------------------------------------------------------- sessions
export async function createSession(db: D1Database, email: string): Promise<string> {
  const id = capabilityToken(), now = Math.floor(Date.now() / 1000);
  await db.batch([
    db.prepare("INSERT INTO sessions (id_hash, email, created_at, last_seen, expires_at) VALUES (?,?,?,?,?)")
      .bind(await sha256(id), email, now, now, now + ABS_S),
    // At most MAX_SESSIONS_PER_EMAIL devices: the oldest sessions end first.
    db.prepare(`DELETE FROM sessions WHERE email=?1 AND id_hash NOT IN
      (SELECT id_hash FROM sessions WHERE email=?1 ORDER BY created_at DESC, id_hash LIMIT ?2)`).bind(email, MAX_SESSIONS_PER_EMAIL),
  ]);
  return id;
}
/** The signed-in email for this request's session cookie, or null. Refreshes last_seen at most every TOUCH_S. */
export async function sessionEmail(db: D1Database, req: Request): Promise<string | null> {
  const id = readCookie(req, SESSION_COOKIE);
  if (!id || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
  const h = await sha256(id), now = Math.floor(Date.now() / 1000);
  const row = await db.prepare("SELECT email, last_seen, expires_at FROM sessions WHERE id_hash=?").bind(h)
    .first<{ email: string; last_seen: number; expires_at: number }>();
  if (!row) return null;
  if (row.expires_at <= now || row.last_seen <= now - IDLE_S) {
    await db.prepare("DELETE FROM sessions WHERE id_hash=?").bind(h).run();
    return null;
  }
  if (now - row.last_seen >= TOUCH_S) await db.prepare("UPDATE sessions SET last_seen=? WHERE id_hash=?").bind(now, h).run();
  return row.email;
}
export async function endSession(db: D1Database, req: Request): Promise<void> {
  const id = readCookie(req, SESSION_COOKIE);
  if (id && /^[A-Za-z0-9_-]{43}$/.test(id)) await db.prepare("DELETE FROM sessions WHERE id_hash=?").bind(await sha256(id)).run();
}
/** End every session of a person who no longer holds any program role. */
export async function endSessionsIfNoRole(db: D1Database, email: string): Promise<number> {
  const r = await db.prepare("DELETE FROM sessions WHERE email=?1 AND NOT EXISTS (SELECT 1 FROM coordinators WHERE email=?1)").bind(email).run();
  return r.meta.changes ?? 0;
}
