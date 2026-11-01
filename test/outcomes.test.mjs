// Unit tests for scripts/outcomes.mjs. No network: every Socrata call goes to a fake fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as O from "../scripts/outcomes.mjs";

// Six corners ~1.1 km apart (0.01° latitude), so 250 m buffers never overlap.
const C = (i) => ({ id: `c${i}`, label: `Corner ${i}`, lat: 40.80 + i * 0.01, lon: -73.90 });
const base = {
  study: "synthetic", pre: { from: "2025-01-06", to: "2025-04-25" }, post: { from: "2025-05-05", to: "2025-08-22" },
  windows: [{ start: "07:00", end: "09:00" }, { start: "14:00", end: "16:00" }],
  treated: [C(1), C(2), C(3)], controls: [C(4), C(5), C(6)], radius_m: 150, sensitivity_radii_m: [100, 250], bootstrap_reps: 500, seed: 7,
};
/** n incidents on each listed day at the corner, 08:00, ~40 m away. */
function make(corner, days, perDay = 1, { min = 480, law = "MISDEMEANOR" } = {}) {
  const out = [];
  for (const d of days) for (let k = 0; k < perDay; k++) out.push({ id: `${corner.id}-${d}-${k}-${min}`, day: d, min, law, lat: corner.lat + 0.00036, lon: corner.lon });
  return out;
}
const cfg = (o = {}) => O.validateConfig({ ...base, ...o });

test("haversine: zero, one degree of latitude, symmetric", () => {
  assert.equal(O.haversine(40.8, -73.9, 40.8, -73.9), 0);
  assert.ok(Math.abs(O.haversine(40, -73.9, 41, -73.9) - 111195) < 5, "1° latitude ≈ 111.195 km");
  assert.equal(O.haversine(40.81, -73.91, 40.8, -73.9), O.haversine(40.8, -73.9, 40.81, -73.91));
  assert.ok(Math.abs(O.haversine(40.8, -73.9, 40.80036, -73.9) - 40) < 0.5);
});

test("dates, times, school days", () => {
  assert.ok(O.isDate("2024-02-29")); assert.ok(!O.isDate("2025-02-29")); assert.ok(!O.isDate("2025-2-1")); assert.ok(!O.isDate(null));
  assert.equal(O.dow("2026-11-02"), 1, "2 Nov 2026 is a Monday");
  assert.equal(O.hhmm("07:45:00"), 465); assert.equal(O.hhmm("24:00"), null); assert.equal(O.hhmm("7:45"), null);
  const d = O.schoolDays("2026-11-02", "2026-11-15", [1, 2, 3, 4, 5], ["2026-11-03"]);
  assert.equal(d.length, 9); assert.ok(!d.includes("2026-11-03") && !d.includes("2026-11-07"));
});

test("cleanRow keeps valid rows and rejects the dataset's known bad rows", () => {
  const ok = { cmplnt_num: "301969578", cmplnt_fr_dt: "2025-03-02T00:00:00.000", cmplnt_fr_tm: "19:00:00", law_cat_cd: "MISDEMEANOR", latitude: "40.845514", longitude: "-73.86476" };
  assert.deepEqual(O.cleanRow(ok, { maxDay: "2026-11-01" }).rec, { id: "301969578", day: "2025-03-02", min: 1140, law: "MISDEMEANOR", lat: 40.845514, lon: -73.86476 });
  const bad = (p) => O.cleanRow({ ...ok, ...p }, { maxDay: "2026-11-01" }).reject;
  assert.equal(bad({ cmplnt_fr_dt: "1016-05-10T00:00:00.000" }), "date_out_of_range", "year 1016 exists in the data");
  assert.equal(bad({ cmplnt_fr_dt: "2027-01-01T00:00:00.000" }), "date_out_of_range", "future");
  assert.equal(bad({ cmplnt_fr_dt: undefined }), "bad_date");
  assert.equal(bad({ cmplnt_fr_tm: "(null)" }), "bad_time");
  assert.equal(bad({ latitude: undefined }), "bad_location");
  assert.equal(bad({ latitude: "0", longitude: "0" }), "bad_location", "outside New York City");
  assert.equal(bad({ cmplnt_num: "1; drop" }), "bad_id");
  assert.equal(O.cleanRow({ ...ok, law_cat_cd: "X" }, {}).rec.law, "OTHER");
});

test("config validation rejects unsafe or incoherent studies", () => {
  assert.throws(() => cfg({ pre: { from: "2025-05-01", to: "2025-06-01" } }), /pre period must end/);
  assert.throws(() => cfg({ windows: [{ start: "09:00", end: "08:00" }] }), /windows/);
  assert.throws(() => cfg({ radius_m: 5000 }), /radius/);
  assert.throws(() => cfg({ law_categories: ["RACE"] }), /law_categories/);
  assert.throws(() => cfg({ treated: [{ id: "x" }] }), /lat\/lon/);
  assert.deepEqual(cfg().radii, [100, 150, 250]);
});

test("difference-in-differences recovers a known synthetic effect exactly", () => {
  const c = cfg();
  const pre = O.schoolDays(c.pre.from, c.pre.to, c.weekdays, []), post = O.schoolDays(c.post.from, c.post.to, c.weekdays, []);
  let recs = [];
  for (const t of c.treated) recs.push(...make(t, pre, 1), ...make(t, post.filter((_, i) => i % 2 === 0), 1));   // 100 -> 50 per 100 days
  c.controls.forEach((k, i) => recs.push(...make(k, pre, 1 + i), ...make(k, post, 1 + i)));                     // flat, different levels
  recs.push(...make(c.treated[0], post, 3, { min: 720 }));                    // noon: outside the windows, must not count
  recs.push(...make(c.treated[0], post, 3, { law: "OTHER" }));                // not a selected law category
  const r = O.analyze(c, recs);
  assert.equal(r.status, "OK", JSON.stringify(r));
  const half = post.filter((_, i) => i % 2 === 0).length / post.length * 100;
  assert.ok(Math.abs(r.main.estimate - (half - 100)) < 1e-9, `estimate ${r.main.estimate}`);
  assert.ok(Math.abs(r.main.control_change) < 1e-9);
  assert.equal(r.main.ci_excludes_zero, true);
  assert.equal(r.placebo.passes, true);
  assert.match(r.interpretation, /^FEWER_INCIDENTS_ASSOCIATED/);
  assert.equal(r.sensitivity.length, 3);
});

test("bootstrap is reproducible from its seed and brackets the estimate", () => {
  const units = [1, 2, 3, 4].map(i => ({ group: "treated", pre: 10 + i, post: 5 + i * 2 })).concat([1, 2, 3, 4].map(i => ({ group: "control", pre: 10 + i, post: 9 + i })));
  const a = O.bootstrap(units, { reps: 1000, seed: 42 }), b = O.bootstrap(units, { reps: 1000, seed: 42 }), c = O.bootstrap(units, { reps: 1000, seed: 43 });
  assert.deepEqual(a, b); assert.notDeepEqual([a.low, a.high], [c.low, c.high]);
  const e = O.did(units).estimate;
  assert.ok(a.low <= e && e <= a.high);
});

test("guards: too few corners, too few days, no data yet", () => {
  assert.equal(O.analyze(cfg({ treated: [C(1), C(2)] }), []).status, "INSUFFICIENT_DATA");
  assert.match(O.analyze(cfg({ pre: { from: "2025-04-01", to: "2025-04-10" } }), []).reason, /20 school days/);
  const r = O.analyze(cfg(), [], { dataEnd: "2025-04-30" });
  assert.equal(r.status, "INSUFFICIENT_DATA"); assert.match(r.warnings[0], /cut/);
});

test("post period is truncated to the published data end, with a warning", () => {
  const c = cfg();
  const r = O.analyze(c, [], { dataEnd: "2025-07-31" });
  assert.equal(r.periods.post.to, "2025-07-31");
  assert.ok(r.warnings.some(w => /cut from 2025-08-22 to 2025-07-31/.test(w)));
  assert.ok(r.warnings.some(w => /Only 0 incidents/.test(w)), "low-count warning");
  assert.ok(r.warnings.some(w => /6 corner\(s\) had no incidents/.test(w)), "zero-incident corners flagged (bad coordinates, parks)");
});

test("placebo fails when treated corners were already diverging", () => {
  const c = cfg();
  const pre = O.schoolDays(c.pre.from, c.pre.to, c.weekdays, []), post = O.schoolDays(c.post.from, c.post.to, c.weekdays, []);
  const recs = [];
  c.treated.forEach((t, i) => recs.push(...make(t, pre.slice(0, pre.length / 2 | 0), 1), ...make(t, pre.slice(pre.length / 2 | 0), 3 + i), ...make(t, post, 3 + i)));
  c.controls.forEach((k, i) => recs.push(...make(k, pre, 1 + i), ...make(k, post, 1 + i)));
  const r = O.analyze(c, recs);
  assert.equal(r.placebo.passes, false);
  assert.match(r.interpretation, /NOT_INTERPRETABLE/);
});

test("spillover: controls inside 2 radii of a treated corner are flagged", () => {
  const near = { ...C(4), lat: C(1).lat + 0.0018 };   // ~200 m from c1
  const r = O.analyze(cfg({ controls: [near, C(5), C(6)] }), []);
  assert.ok(r.warnings.some(w => /spillover/.test(w)));
});

test("coverage export: schema enforced, unexpected (personal) fields refused, dose computed", () => {
  const cov = { schema: "walkwithus.coverage.v1", rows: [
    { day: "2025-05-05", corner_id: 1, label: "A", lat: 40.81, lon: -73.9, adult_minutes: 120, walks_done: 4 },
    { day: "2025-05-06", corner_id: 1, label: "A", lat: 40.81, lon: -73.9, adult_minutes: 60, walks_done: null, walks_done_suppressed: true },
    { day: "2025-05-06", corner_id: 2, label: "B", lat: 40.82, lon: -73.9, adult_minutes: 0, walks_done: 0 },
    { day: "2025-05-07", corner_id: 3, label: "C", lat: 40.83, lon: -73.9, adult_minutes: 30, walks_done: 0 }] };
  assert.throws(() => O.validateCoverage({ ...cov, schema: "x" }), /coverage/);
  assert.throws(() => O.validateCoverage({ ...cov, rows: [{ ...cov.rows[0], phone: "x" }] }), /unexpected field phone/);
  const c = O.validateConfig({ ...base, treated: "coverage" }, O.validateCoverage(cov));
  assert.deepEqual(c.treated.map(t => t.id), ["1", "3"], "corners with adult time become treated; 0-minute corner does not");
  const dose = O.coverageDose(c, cov);
  assert.deepEqual(dose[0], { id: "1", label: "A", covered_days: 2, adult_minutes: 180, walks_done_reported: 4, cells_suppressed: 1 });
});

test("SoQL builder refuses non-numeric coordinates and malformed dates", () => {
  assert.match(O.soqlWhere({ lat: 40.81, lon: -73.9 }, 150, "2025-01-01", "2025-02-01"), /^within_circle\(lat_lon, 40\.81, -73\.9, 150\) AND cmplnt_fr_dt between '2025-01-01T00:00:00' and '2025-02-01T23:59:59'$/);
  assert.throws(() => O.soqlWhere({ lat: "40) OR 1=1 --", lon: -73.9 }, 150, "2025-01-01", "2025-02-01"));
  assert.throws(() => O.soqlWhere(C(1), 150, "2025-01-01' OR '1", "2025-02-01"));
});

// ---------------------------------------------------------------- fake NYC Open Data
function fakeSocrata({ rows = {}, extraField = false, fail429 = 0 } = {}) {
  const calls = [];
  let throttled = 0;
  const res = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => body });
  const impl = async (url, opts) => {
    const u = new URL(url); calls.push({ url: u, headers: opts?.headers });
    if (throttled < fail429) { throttled++; return res({}, 429); }
    const id = /\/(?:views|resource)\/([a-z0-9]{4}-[a-z0-9]{4})/.exec(u.pathname)[1];
    if (u.pathname.startsWith("/api/views/")) return res({ rowsUpdatedAt: 1785110400 });
    const sel = u.searchParams.get("$select");
    if (sel.startsWith("max(")) return res([{ end: id === "5uac-w243" ? "2025-08-31T00:00:00.000" : "2024-12-31T00:00:00.000" }]);
    const offset = Number(u.searchParams.get("$offset"));
    const all = (rows[id] ?? []).map(r => extraField ? { ...r, susp_race: "x" } : r);
    return res(all.slice(offset, offset + 50000));
  };
  return { impl, calls };
}
const raw = (id, day, tm = "08:00:00", lat = 40.81036, lon = -73.9) => ({ cmplnt_num: id, cmplnt_fr_dt: day + "T00:00:00.000", cmplnt_fr_tm: tm, law_cat_cd: "FELONY", latitude: String(lat), longitude: String(lon) });

test("fetch: minimal fields only, both datasets, dedupe, rejects counted, hashes stable, token only in a header", async () => {
  const f = fakeSocrata({ rows: { "qgea-i56i": [raw("1", "2025-02-03"), raw("2", "1016-01-01")], "5uac-w243": [raw("1", "2025-02-03"), raw("3", "2025-06-02")] } });
  const c = cfg();
  const d = await O.fetchAll(c, { fetchImpl: f.impl, token: "t0k", now: new Date("2026-11-01T12:00:00Z") });
  const dataCalls = f.calls.filter(x => x.url.pathname.startsWith("/resource/") && !x.url.searchParams.get("$select").startsWith("max("));
  assert.equal(dataCalls.length, 6 * 2, "one page per corner per dataset");
  for (const x of dataCalls) {
    assert.equal(x.url.searchParams.get("$select"), O.FIELDS.join(","));
    assert.ok(!O.FORBIDDEN_FIELD.test(x.url.search), "no demographic field is ever requested");
    assert.match(x.url.searchParams.get("$where"), /within_circle\(lat_lon, [\d.]+, -73\.9, 250\)/, "largest sensitivity radius");
    assert.ok(!x.url.search.includes("t0k"), "app token never in a URL");
    assert.equal(x.headers["x-app-token"], "t0k");
  }
  assert.deepEqual(d.recs.map(r => r.id), ["1", "3"], "complaint 1 appears in both datasets once; the year-1016 row is rejected");
  assert.equal(d.rejects.date_out_of_range, 6, "each corner query returns it again, so it is rejected once per corner");
  assert.equal(d.perCorner.c1.rows, 2, "per-corner set is deduplicated too (its hash is what a re-run is checked against)");
  assert.equal(d.dataEnd, "2025-08-31");
  assert.equal(d.meta[0].rows_updated_at, "2026-07-27T00:00:00.000Z");
  const again = await O.fetchAll(c, { fetchImpl: fakeSocrata({ rows: { "qgea-i56i": [raw("2", "1016-01-01"), raw("1", "2025-02-03")], "5uac-w243": [raw("3", "2025-06-02"), raw("1", "2025-02-03")] } }).impl, now: new Date("2026-11-01T12:00:00Z") });
  assert.equal(again.all_sha256, d.all_sha256, "hash does not depend on response order");
  assert.equal(again.perCorner.c1.sha256, d.perCorner.c1.sha256);
});

test("fetch: refuses a response carrying fields it did not ask for; retries throttling", async () => {
  await assert.rejects(O.fetchAll(cfg(), { fetchImpl: fakeSocrata({ rows: { "qgea-i56i": [raw("1", "2025-02-03")] }, extraField: true }).impl }), /unexpected field in response: susp_race/);
  const f = fakeSocrata({ fail429: 1 });
  const d = await O.fetchAll(cfg(), { fetchImpl: f.impl, now: new Date("2026-11-01T12:00:00Z") });
  assert.equal(d.recs.length, 0); assert.equal(f.calls[0].url.pathname, f.calls[1].url.pathname, "same request retried after 429");
});

test("pagination: a full page triggers the next offset", async () => {
  const many = Array.from({ length: 50001 }, (_, i) => raw(String(100000 + i), "2025-02-03"));
  const f = fakeSocrata({ rows: { "qgea-i56i": many } });
  const d = await O.fetchAll(cfg({ treated: [C(1), C(2), C(3)] }), { fetchImpl: f.impl, now: new Date("2026-11-01T12:00:00Z") });
  assert.equal(d.recs.length, 50001);
  assert.ok(f.calls.some(x => x.url.searchParams.get("$offset") === "50000"));
});

test("run + report: end to end on fake data, provenance and caveat in the markdown", async () => {
  const c = cfg();
  const pre = O.schoolDays(c.pre.from, c.pre.to, c.weekdays, []), post = O.schoolDays(c.post.from, c.post.to, c.weekdays, []);
  const rows = [];
  let n = 1;
  for (const k of [...c.treated, ...c.controls]) {
    const isT = k.id <= "c3";
    for (const d of pre) rows.push(raw(String(n++), d, "08:00:00", k.lat + 0.00036, k.lon));
    for (const [i, d] of post.entries()) if (!isT || i % 2 === 0) rows.push(raw(String(n++), d, "08:00:00", k.lat + 0.00036, k.lon));
  }
  const rep = await O.run({ config: base, fetchImpl: fakeSocrata({ rows: { "5uac-w243": rows } }).impl, now: new Date("2026-11-01T12:00:00Z") });
  assert.equal(rep.result.status, "OK");
  assert.equal(rep.data.records, rows.length);
  const md = O.renderMarkdown(rep);
  assert.match(md, /Status: OK/); assert.match(md, /association/); assert.match(md, /5uac-w243/); assert.ok(md.includes(rep.data.all_sha256));
  assert.ok(!/race|sex|age/i.test(JSON.stringify(rep.parameters)), "report parameters carry no demographic field");
});
