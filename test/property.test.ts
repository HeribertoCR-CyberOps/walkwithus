// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Savvy Solution Pros LLC. Walk With Us — see NOTICE.
// Property-based tests (fast-check) for the cryptographic core. Each property runs on hundreds of generated inputs,
// including empty strings, astral-plane Unicode, RTL text and long values, and shrinks any failure to a minimal case.
// Run: npm run test:property   (Node 22.18+ runs this .ts file and src/crypto.ts natively by stripping types)
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from 'fast-check';
import { seal, open, hmac, b64, unb64, b64url, unb64url, randomString, ctEqual, REF_ALPHABET, capabilityToken } from "../src/crypto.ts";

const key = () => fc.uint8Array({ minLength: 32, maxLength: 32 }).map((u) => b64(u));
const text = fc.string({ unit: "grapheme", maxLength: 200 });
const RUNS = { numRuns: Number(process.env.FC_RUNS || 300) };

test("seal/open round-trips any Unicode plaintext under any key and AAD", async () => {
  await fc.assert(fc.asyncProperty(key(), text, text, async (k, aad, pt) => {
    assert.equal(await open(k, aad, await seal(k, aad, pt)), pt);
  }), RUNS);
});

test("ciphertext never contains the plaintext and is never reused (fresh IV)", async () => {
  await fc.assert(fc.asyncProperty(key(), fc.string({ minLength: 6, maxLength: 60 }), async (k, pt) => {
    const a = await seal(k, "t", pt), b = await seal(k, "t", pt);
    assert.notEqual(a, b);
    assert.ok(!a.includes(pt) && !Buffer.from(unb64(a.slice(3))).toString("latin1").includes(pt));
  }), RUNS);
});

test("AAD binding: a ciphertext moved to another row, field or org fails to open", async () => {
  await fc.assert(fc.asyncProperty(key(), text, text, text, async (k, aad1, aad2, pt) => {
    fc.pre(aad1 !== aad2);
    const sealed = await seal(k, aad1, pt);
    await assert.rejects(open(k, aad2, sealed));
  }), RUNS);
});

test("wrong key never opens a ciphertext", async () => {
  await fc.assert(fc.asyncProperty(key(), key(), text, async (k1, k2, pt) => {
    fc.pre(k1 !== k2);
    await assert.rejects(open(k2, "aad", await seal(k1, "aad", pt)));
  }), RUNS);
});

test("any single-bit tamper anywhere in IV, ciphertext or tag is detected", async () => {
  await fc.assert(fc.asyncProperty(key(), text, fc.nat(), fc.integer({ min: 0, max: 7 }), async (k, pt, pos, bit) => {
    const raw = unb64((await seal(k, "aad", pt)).slice(3));
    raw[pos % raw.length] ^= 1 << bit;
    await assert.rejects(open(k, "aad", "v1." + b64(raw)));
  }), RUNS);
});

test("malformed or unversioned ciphertexts are rejected, never decrypted", async () => {
  await fc.assert(fc.asyncProperty(key(), fc.string({ maxLength: 120 }), async (k, junk) => {
    let opened = false;
    try { await open(k, "aad", junk); opened = true; } catch { /* expected */ }
    assert.equal(opened, false);
  }), RUNS);
});

test("HMAC is deterministic per key and separates keys and messages", async () => {
  await fc.assert(fc.asyncProperty(key(), key(), text, text, async (k1, k2, m1, m2) => {
    const h = await hmac(k1, m1);
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(await hmac(k1, m1), h);
    if (m1 !== m2) assert.notEqual(await hmac(k1, m2), h);
    if (k1 !== k2) assert.notEqual(await hmac(k2, m1), h);
  }), RUNS);
});

test("base64 and base64url round-trip arbitrary bytes", () => {
  fc.assert(fc.property(fc.uint8Array({ maxLength: 512 }), (u) => {
    assert.deepEqual(unb64(b64(u)), u);
    const s = b64url(u);
    assert.match(s, /^[A-Za-z0-9_-]*$/);
    assert.deepEqual(unb64url(s), u);
  }), RUNS);
});

test("randomString: exact length, only alphabet characters (including lengths beyond one WebCrypto call)", () => {
  assert.equal(randomString(100000, REF_ALPHABET).length, 100000);
  fc.assert(fc.property(fc.integer({ min: 1, max: 64 }), fc.constantFrom(REF_ALPHABET, "01", "abc"), (n, alpha) => {
    const s = randomString(n, alpha);
    assert.equal(s.length, n);
    for (const ch of s) assert.ok(alpha.includes(ch));
  }), RUNS);
});

test("randomString has no modulo bias (chi-square over 30-symbol alphabet)", () => {
  const N = 60000, counts = new Map();
  for (const ch of randomString(N, REF_ALPHABET)) counts.set(ch, (counts.get(ch) || 0) + 1);
  const e = N / REF_ALPHABET.length;
  const chi = [...REF_ALPHABET].reduce((s, ch) => s + ((counts.get(ch) || 0) - e) ** 2 / e, 0);
  // df = 29; P(chi² > 66.6) ≈ 0.0001 (flake rate 1 in 10,000 runs). A biased generator (e.g. naive modulo) fails this decisively.
  assert.ok(chi < 66.6, `chi-square ${chi.toFixed(1)} suggests bias`);
});

test("capabilityToken: 256-bit base64url, unique", () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const t = capabilityToken();
    assert.match(t, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(unb64url(t).length, 32);
    assert.ok(!seen.has(t)); seen.add(t);
  }
});

test("ctEqual agrees with === for all string pairs", () => {
  fc.assert(fc.property(fc.string({ maxLength: 80 }), fc.string({ maxLength: 80 }), (a, b) => {
    assert.equal(ctEqual(a, b), a === b);
    assert.equal(ctEqual(a, a), true);
  }), RUNS);
});
