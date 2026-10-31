// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Savvy Solution Pros LLC. Walk With Us — see NOTICE.
// Cloudflare Access JWT verification (RS256) — identity for coordinators. No cookie trust, no session store.
// Keys come from https://<team>/cdn-cgi/access/certs (cached 1h). ACCESS_JWKS_JSON may supply keys for local tests;
// it never bypasses verification — a token must still be signed by a key in that set and carry iss/aud/exp.
import { unb64url } from "./crypto";

export interface Identity { email: string; sub: string; }

interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string; }
let cache: { at: number; team: string; keys: Map<string, CryptoKey> } | null = null;
let lastForced = 0;   // when Access rotates its signing key, refetch at most once a minute on an unknown kid

async function keysFor(team: string, override?: string, force = false): Promise<Map<string, CryptoKey>> {
  if (!force && cache && cache.team === team && Date.now() - cache.at < 3_600_000) return cache.keys;
  let jwks: { keys: Jwk[] };
  if (override) jwks = JSON.parse(override);
  else {
    const r = await fetch(`https://${team}/cdn-cgi/access/certs`, { cf: { cacheTtl: 3600 } } as RequestInit);
    if (!r.ok) throw new Error("certs " + r.status);
    jwks = await r.json();
  }
  const keys = new Map<string, CryptoKey>();
  for (const k of jwks.keys) {
    if (k.kty !== "RSA") continue;
    keys.set(k.kid, await crypto.subtle.importKey("jwk", { kty: "RSA", n: k.n, e: k.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
  }
  cache = { at: Date.now(), team, keys };
  return keys;
}

export async function verifyAccess(req: Request, team: string, aud: string, override?: string): Promise<Identity | null> {
  const tok = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!tok || !team || !aud || team.startsWith("REPLACE") || aud.startsWith("REPLACE")) return null;
  const parts = tok.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: string; kid?: string }, payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(unb64url(h)));
    payload = JSON.parse(new TextDecoder().decode(unb64url(p)));
  } catch { return null; }
  if (header.alg !== "RS256" || !header.kid) return null;              // no alg confusion, no "none"
  let key = (await keysFor(team, override)).get(header.kid);
  if (!key && !override && Date.now() - lastForced > 60_000) {
    lastForced = Date.now();
    key = (await keysFor(team, override, true)).get(header.kid);   // signature still verified below; this only refreshes keys
  }
  if (!key) return null;
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, unb64url(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== `https://${team}`) return null;
  if (!auds.includes(aud)) return null;
  if (typeof payload.exp !== "number" || payload.exp < now - 30) return null;
  if (typeof payload.nbf === "number" && payload.nbf > now + 30) return null;
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (!email) return null;
  return { email, sub: String(payload.sub ?? "") };
}
