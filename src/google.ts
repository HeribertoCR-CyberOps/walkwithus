// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Savvy Solution Pros LLC. Walk With Us — see NOTICE.
// Google sign-in for program staff (OpenID Connect, authorization-code flow with PKCE, state and nonce).
// Only the email address is requested (scopes "openid email"). The Worker exchanges the code server-side with its client
// secret and then verifies the ID token itself: RS256 signature against Google's published keys, issuer, audience
// (our client id), expiry, issued-at, nonce, and email_verified === true. A token failing any check signs nobody in.
// Tests may supply GOOGLE_JWKS_JSON (a key set) and GOOGLE_TOKEN_URL (a loopback URL only); neither skips a check.
import { unb64url } from "./crypto";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

interface Jwk { kid: string; kty: string; n: string; e: string; }
let cache: { at: number; src: string; keys: Map<string, CryptoKey> } | null = null;
let lastForced = 0;

async function keys(override?: string, force = false): Promise<Map<string, CryptoKey>> {
  const src = override ? "override" : "google";
  if (!force && cache && cache.src === src && Date.now() - cache.at < 3_600_000) return cache.keys;
  let jwks: { keys: Jwk[] };
  if (override) jwks = JSON.parse(override);
  else {
    const r = await fetch(GOOGLE_CERTS_URL, { cf: { cacheTtl: 3600 } } as RequestInit);
    if (!r.ok) throw new Error("google certs " + r.status);
    jwks = await r.json();
  }
  const m = new Map<string, CryptoKey>();
  for (const k of jwks.keys) {
    if (k.kty !== "RSA") continue;
    m.set(k.kid, await crypto.subtle.importKey("jwk", { kty: "RSA", n: k.n, e: k.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
  }
  cache = { at: Date.now(), src, keys: m };
  return m;
}

/** Only a loopback URL may replace Google's token endpoint (tests); anything else is ignored. */
export function tokenUrl(override?: string): string {
  return override && /^http:\/\/127\.0\.0\.1:\d{2,5}\/[\w/-]*$/.test(override) ? override : GOOGLE_TOKEN_URL;
}

/** Exchange the one-time code for tokens (server to Google, client secret + PKCE verifier). Returns the ID token or null. */
export async function exchangeCode(code: string, clientId: string, clientSecret: string, redirectUri: string,
  verifier: string, override?: string): Promise<string | null> {
  const r = await fetch(tokenUrl(override), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri,
      grant_type: "authorization_code", code_verifier: verifier }).toString(),
  });
  if (!r.ok) return null;
  const d = await r.json<{ id_token?: unknown }>().catch(() => ({} as { id_token?: unknown }));
  return typeof d.id_token === "string" && d.id_token.length < 8192 ? d.id_token : null;
}

/** Verify a Google ID token. Returns the verified, lower-cased email and Google's permanent account id (sub), or null. */
export async function verifyIdToken(tok: string, clientId: string, nonce: string, override?: string): Promise<{ email: string; sub: string } | null> {
  const parts = tok.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: string; kid?: string }, payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(unb64url(h)));
    payload = JSON.parse(new TextDecoder().decode(unb64url(p)));
  } catch { return null; }
  if (header.alg !== "RS256" || !header.kid) return null;                  // no "none", no HS256 confusion
  let key = (await keys(override)).get(header.kid);
  if (!key && !override && Date.now() - lastForced > 60_000) { lastForced = Date.now(); key = (await keys(override, true)).get(header.kid); }
  if (!key) return null;
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, unb64url(s), new TextEncoder().encode(`${h}.${p}`)))) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.iss !== "string" || !ISSUERS.includes(payload.iss)) return null;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(clientId)) return null;
  if (auds.length > 1 && payload.azp !== clientId) return null;            // multi-audience token must be issued to us
  if (typeof payload.exp !== "number" || payload.exp < now - 30) return null;
  if (typeof payload.iat !== "number" || payload.iat > now + 60 || payload.iat < now - 600) return null;
  if (typeof payload.nonce !== "string" || payload.nonce.length < 20 || payload.nonce !== nonce) return null;
  if (payload.email_verified !== true) return null;                        // Google must have verified the address
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return null;
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!/^[\w-]{1,255}$/.test(sub)) return null;                          // Google's stable account id: the address is bound to it
  return { email, sub };
}
