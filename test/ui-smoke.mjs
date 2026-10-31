// Browser smoke test: renders the family page in every language (light + dark, phone viewport) and the volunteer and
// coordinator pages, against the real Worker. Fails on any JS error, any literal "null"/"undefined" in the page, a
// missing 911 link, a wrong text direction, or reversed phone numbers in RTL languages.
// Run: npm run test:ui   (Playwright is a pinned devDependency; first time: `npx playwright install --with-deps chromium`)
import { spawn, execFileSync } from "node:child_process";
import { randomBytes, generateKeyPairSync, sign } from "node:crypto";
import { writeFileSync, openSync, rmSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

process.env.CI = "1"; process.env.WRANGLER_SEND_METRICS = "false";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = createRequire("/opt/node22/lib/node_modules/")("playwright")); }

const P = ".wrangler/ui-smoke", PORT = 8803, B = `http://127.0.0.1:${PORT}`;
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
rmSync(P, { recursive: true, force: true }); mkdirSync(".wrangler", { recursive: true });
writeFileSync(".dev.vars", [`DATA_KEY=${randomBytes(32).toString("base64")}`, `HMAC_KEY=${randomBytes(32).toString("base64")}`,
  "ACCESS_TEAM_DOMAIN=t.cloudflareaccess.com", "ACCESS_AUD=a", `ACCESS_JWKS_JSON=${JSON.stringify({ keys: [{ ...jwk, kid: "k", alg: "RS256" }] })}`].join("\n") + "\n");
execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "walkwithus", "--local", "--persist-to", P], { stdio: "ignore" });
const win = [0, 1, 2, 3, 4, 5, 6].flatMap((d) => [`(1,1,${d},450,525)`, `(1,1,${d},870,945)`, `(1,2,${d},0,1440)`]).join(",");
execFileSync("npx", ["wrangler", "d1", "execute", "walkwithus", "--local", "--persist-to", P, "--command",
  `INSERT INTO orgs (id,slug,name,borough,public_phone,demo) VALUES (1,'demo','Demo Program','Bronx','(718) 555-0100',1);
   INSERT INTO corners (id,org_id,label,cross_streets,lat,lon) VALUES (1,1,'Corner A','Example Ave & 1st St',40.84,-73.89),(2,1,'Corner B','Example Ave & 2nd St',40.841,-73.891);
   INSERT INTO windows (org_id,corner_id,dow,start_min,end_min) VALUES ${win};
   INSERT INTO coordinators (email,org_id,role) VALUES ('lead@demo.test',1,'admin'), ('coord@demo.test',1,'coordinator');`], { stdio: "ignore" });
const LOGFD = openSync(".wrangler/ui-smoke.log", "w");
const proc = spawn("npx", ["wrangler", "dev", "--local", "--port", String(PORT), "--persist-to", P, "--ip", "127.0.0.1"],
  { stdio: ["ignore", LOGFD, LOGFD], detached: true });
const stop = () => { try { process.kill(-proc.pid, "SIGTERM"); } catch {} rmSync(".dev.vars", { force: true }); };
process.on("exit", stop);
for (let i = 0; i < 90; i++) { try { if ((await fetch(B + "/api/health")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }

const b64u = (x) => Buffer.from(x).toString("base64url");
const tok = (email) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k" })), p = b64u(JSON.stringify({ iss: "https://t.cloudflareaccess.com", aud: ["a"], email, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${h}.${p}.${b64u(sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey))}`; };

const { META } = await import(new URL("../public/js/strings.js", import.meta.url));
const browser = await chromium.launch();
const failures = [];
async function check(label, ctxOpts, url, assertions) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...ctxOpts.ctx });
  if (ctxOpts.lang) await ctx.addInitScript((x) => { try { localStorage.setItem("wwu.lang", x); } catch {} }, ctxOpts.lang);
  const pg = await ctx.newPage(); const errs = [];
  pg.on("pageerror", (e) => errs.push(e.message)); pg.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  try {
    await pg.goto(url); await pg.waitForSelector(ctxOpts.ready, { timeout: 15000 });
    const text = await pg.evaluate(() => document.body.innerText);
    assert.deepEqual(errs, [], "JS errors");
    assert.ok(!/\bnull\b|\bundefined\b|\[object Object\]/.test(text), "literal null/undefined in page");
    await assertions(pg, text);
    console.log("ok  ", label);
  } catch (e) { failures.push(label); console.log("FAIL", label, "—", e.message.split("\n")[0]); await pg.screenshot({ path: `.wrangler/ui-fail-${label.replace(/\W+/g, "_")}.png` }).catch(() => {}); }
  await ctx.close();
}

for (const [code, m] of Object.entries(META)) for (const scheme of ["light", "dark"]) {
  await check(`family ${code} ${scheme}`, { lang: code, ctx: { colorScheme: scheme }, ready: "#wh" }, B + "/?o=demo", async (pg, text) => {
    assert.equal(await pg.evaluate(() => document.documentElement.dir), m.dir);
    assert.equal(await pg.evaluate(() => document.documentElement.lang), code);
    assert.ok(await pg.$('a[href="tel:911"]'), "911 link");
    assert.ok(await pg.$('a[href="tel:18005778477"]'), "tips link");
    assert.ok(/1-800-577-TIPS/.test(text), "tips number in logical order");
    // Each emergency button must read as one phrase with its spaces intact ("Call 911", not "Call911").
    for (const id of ["sos911", "sostips", "soscrisis"]) {
      const t = await pg.$eval("#" + id, (n) => n.innerText);
      const before = (/(.)\u2066/.exec(t) || [])[1];  // character just before the isolated number
      assert.ok(!/\n/.test(t) && before !== undefined && /[\s\uFF1A]/.test(before), `${id} lost the space before its number: ${JSON.stringify(t)}`);
    }
    assert.equal((await pg.$$(".corner")).length, 2);
    assert.ok((await pg.$$("#w-lang option")).length >= 14, "call languages");
    if (!m.reviewed) assert.ok(await pg.isVisible("#draftnote"), "machine-translation notice shown");
  });
}
await check("volunteer page", { ready: "h1" }, B + "/v.html", async (pg, text) => { assert.ok(/coordinator/i.test(text)); assert.ok(await pg.$('a[href="tel:911"]')); });
for (const who of ["lead@demo.test", "coord@demo.test"]) {
  await check(`coordinator ${who}`, { ctx: { viewport: { width: 1100, height: 900 }, extraHTTPHeaders: { "cf-access-jwt-assertion": tok(who) } }, ready: "text=Program status" },
    B + "/c.html?o=demo", async (pg, text) => { assert.equal(/Admin/.test(text), who.startsWith("lead"), "admin section only for admins"); });
}
// Demo program: the walk form submits, shows the "nothing was saved" note, and stores nothing.
await check("demo walk request shows 'nothing saved'", { ctx: {}, ready: "#wh" }, B + "/?o=demo", async (pg) => {
  await pg.fill("#w-cb", "(718) 555-0123"); await pg.check("#w-consent"); await pg.click("form button[type=submit]");
  await pg.waitForSelector("form .result.ok .demo-note", { timeout: 10000 });
});
// Home page: with only the demo program, "/" must stay on an honest landing page (no redirect into the demo).
for (const [code, dir] of [["en", "ltr"], ["es", "ltr"], ["ar", "rtl"]]) {
  await check(`home landing ${code}`, { lang: code, ctx: {}, ready: "#hh" }, B + "/", async (pg, text) => {
    assert.equal(new URL(pg.url()).search, "", "redirected away from /");
    assert.equal(await pg.evaluate(() => document.documentElement.dir), dir);
    assert.ok(await pg.$('a[href="?o=demo"]'), "demo link");
    assert.ok(await pg.$('a[href^="mailto:"]'), "organizations contact");
    assert.ok(await pg.$('a[href="tel:911"]'), "911 link");
    assert.ok(await pg.isVisible('#content [role="status"]'), "no-program-yet notice");
  });
}
// Now add a real program that has no approved adults yet (inserted while the server runs, after the home-page checks).
execFileSync("npx", ["wrangler", "d1", "execute", "walkwithus", "--local", "--persist-to", P, "--command",
  `INSERT INTO orgs (id,slug,name,borough) VALUES (2,'notready','Not Ready Program','Queens');
   INSERT INTO corners (id,org_id,label,cross_streets,lat,lon) VALUES (3,2,'Corner N','Example Rd & 3rd St',40.75,-73.85);
   INSERT INTO windows (org_id,corner_id,dow,start_min,end_min) VALUES ${[0, 1, 2, 3, 4, 5, 6].map((d) => `(2,3,${d},0,1440)`).join(",")};`], { stdio: "ignore" });
// A real program without two approved adults: the walk form is replaced by an honest notice; the volunteer form stays.
await check("not-ready program hides the walk form", { ctx: {}, ready: "#wh" }, B + "/?o=notready", async (pg) => {
  assert.equal(await pg.$("#w-cb"), null, "walk form must not render");
  assert.ok(await pg.isVisible('section [role="status"]'));
  assert.ok(await pg.$("#v-name"), "volunteer form still available");
});
// With exactly one real program, "/" opens it directly (the demo never counts as a program).
await check("home opens the single real program", { ctx: {}, ready: "#v-name" }, B + "/", async (pg) => {
  assert.equal(new URL(pg.url()).search, "?o=notready");
});
// A crafted ?o= value must never turn into an API request outside /api/o/<valid-slug> or /api/c/<valid-slug>.
for (const [label, url] of [["family page rejects crafted org slug", "/?o=..%2F..%2Fhealth"], ["coordinator page rejects crafted org slug", "/c.html?o=demo%2Fvolunteers%2F1%2Fsuspend"]]) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "cf-access-jwt-assertion": tok("lead@demo.test") } });
  const pg = await ctx.newPage(); const hits = [];
  pg.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) hits.push(u.pathname); });
  try {
    await pg.goto(B + url); await pg.waitForLoadState("networkidle");
    const bad = hits.filter((h) => !/^\/api\/(orgs|o\/(demo|notready)|c\/me|c\/demo\/dashboard)$/.test(h));
    assert.ok(hits.length > 0, "page made no API calls");
    assert.deepEqual(bad, [], "unexpected API paths: " + bad.join(", "));
    console.log("ok  ", label);
  } catch (e) { failures.push(label); console.log("FAIL", label, "—", e.message.split("\n")[0]); }
  await ctx.close();
}
// After the last slot of the day (20:00 NY), the walk form must move to the next day with open times instead of showing an empty list.
await (async () => {
  const label = "walk form skips a day with no times left";
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage();
  try {
    await pg.clock.setFixedTime(new Date("2026-10-30T20:00:00-04:00"));
    await pg.goto(B + "/?o=demo"); await pg.waitForSelector("#wh");
    const r = await pg.evaluate(() => ({ date: document.getElementById("w-date").value,
      first: [...document.querySelectorAll("#w-time option")].map((o) => o.value)[0] }));
    assert.deepEqual(r, { date: "2026-10-31", first: "07:30" });
    // The emergency tip number must render on one line.
    const lines = await pg.$eval("#sostips .nowrap", (n) => n.getClientRects().length);
    assert.equal(lines, 1, "tip number wrapped");
    console.log("ok  ", label);
  } catch (e) { failures.push(label); console.log("FAIL", label, "—", e.message.split("\n")[0]); }
  await ctx.close();
})();
// Offline: after one visit, the shell, the 911 link and the last schedule still render with no network.
await (async () => {
  const label = "offline after first visit";
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage();
  try {
    await pg.goto(B + "/?o=demo"); await pg.waitForSelector("#wh");
    const ready = await pg.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => "ready"), new Promise((r) => setTimeout(() => r("timeout"), 15000))]));
    assert.equal(ready, "ready", "service worker installs");
    await pg.reload(); await pg.waitForSelector("#wh");
    await ctx.setOffline(true); await pg.reload(); await pg.waitForSelector("#wh", { timeout: 10000 });
    const s = await pg.evaluate(() => ({ has911: !!document.querySelector('a[href="tel:911"]'), banner: !document.getElementById("offline").hidden, corners: document.querySelectorAll(".corner").length }));
    assert.deepEqual(s, { has911: true, banner: true, corners: 2 });
    console.log("ok  ", label);
  } catch (e) { failures.push(label); console.log("FAIL", label, "—", e.message.split("\n")[0]); }
  await ctx.close();
})();
await browser.close();
stop();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL UI CHECKS PASSED");
process.exit(failures.length ? 1 : 0);
