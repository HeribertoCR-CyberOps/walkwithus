// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Savvy Solution Pros LLC. Walk With Us — see NOTICE.
// Cryptographic primitives — WebCrypto only, no dependencies.
// AES-256-GCM with a fresh 96-bit IV per value and Additional Authenticated Data (AAD) chosen by the caller. The Worker binds
// every ciphertext to its table, field, org and row (walk id, or the volunteer's per-org phone HMAC), so a ciphertext
// copied into another row, field or org fails to decrypt.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]!);
  return btoa(s);
}
export function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64url(s: string): Uint8Array {
  const p = s.replace(/-/g, "+").replace(/_/g, "/");
  return unb64(p + "=".repeat((4 - (p.length % 4)) % 4));
}
export function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const keyCache = new Map<string, CryptoKey>();

async function aesKey(raw: string): Promise<CryptoKey> {
  const hit = keyCache.get("aes:" + raw);
  if (hit) return hit;
  const bytes = unb64(raw);
  if (bytes.length !== 32) throw new Error("DATA_KEY must be 32 bytes (base64)");
  const k = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  keyCache.set("aes:" + raw, k);
  return k;
}
async function hmacKey(raw: string): Promise<CryptoKey> {
  const hit = keyCache.get("hmac:" + raw);
  if (hit) return hit;
  const bytes = unb64(raw);
  if (bytes.length < 32) throw new Error("HMAC_KEY must be >= 32 bytes (base64)");
  const k = await crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  keyCache.set("hmac:" + raw, k);
  return k;
}

export async function seal(dataKey: string, aad: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(aad) }, await aesKey(dataKey), enc.encode(plaintext));
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), 12);
  return "v1." + b64(out);
}

export async function open(dataKey: string, aad: string, sealed: string): Promise<string> {
  if (!sealed.startsWith("v1.")) throw new Error("unknown ciphertext version");
  const raw = unb64(sealed.slice(3));
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: raw.slice(0, 12), additionalData: enc.encode(aad) }, await aesKey(dataKey), raw.slice(12));
  return dec.decode(pt);
}

export async function hmac(hmacKeyB64: string, msg: string): Promise<string> {
  return hex(await crypto.subtle.sign("HMAC", await hmacKey(hmacKeyB64), enc.encode(msg)));
}

export async function sha256(msg: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(msg)));
}

/** Uniform random string over an alphabet using rejection sampling (no modulo bias). */
export function randomString(len: number, alphabet: string): string {
  const n = alphabet.length;
  const limit = 256 - (256 % n);
  let out = "";
  while (out.length < len) {
    // WebCrypto caps one call at 65,536 bytes; draw in chunks so any length works.
    const buf = crypto.getRandomValues(new Uint8Array(Math.min(65536, (len - out.length) * 2)));
    for (const b of buf) {
      if (b < limit) out += alphabet[b % n];
      if (out.length === len) break;
    }
  }
  return out;
}

// Crockford base32 without ambiguous characters — readable over the phone.
export const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** 256-bit capability token, base64url. */
export function capabilityToken(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Constant-time comparison of two equal-length hex strings. */
export function ctEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
