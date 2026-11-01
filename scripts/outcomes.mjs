#!/usr/bin/env node
// Walk With Us — outcome study: did reported incidents near covered corners change during school-travel hours?
//
// Method (docs/OUTCOMES.md): difference-in-differences of per-corner incident rates, treated corners vs PRE-REGISTERED
// control corners, before vs after the program started, counting only NYPD complaints whose start time falls inside the
// school-travel windows on school days. Uncertainty: corner-level bootstrap (seeded, reproducible). Checks: placebo
// pre-trend, sensitivity radii, treated/control buffer overlap, data freshness, minimum sample.
//
// Data: NYC Open Data, NYPD Complaint Data Historic (qgea-i56i) + Current Year To Date (5uac-w243). Only these fields
// are ever requested: cmplnt_num, cmplnt_fr_dt, cmplnt_fr_tm, law_cat_cd, latitude, longitude. Suspect and victim
// demographics are never requested, stored or reported.
//
// This is an association, not proof of cause. Read the limitations in docs/OUTCOMES.md before quoting a number.
//
// Usage: node scripts/outcomes.mjs --config study.json --out outcomes-report [--coverage coverage.json]
// Optional env: SOCRATA_APP_TOKEN (raises NYC Open Data rate limits; never written to the report).
// No dependencies: Node >= 20 (global fetch, node:crypto).

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const TOOL = "walkwithus-outcomes";
export const TOOL_VERSION = "1.0.0";
export const SOCRATA = "https://data.cityofnewyork.us";
export const DATASETS = [
  { id: "qgea-i56i", name: "NYPD Complaint Data Historic" },
  { id: "5uac-w243", name: "NYPD Complaint Data Current (Year To Date)" },
];
export const FIELDS = ["cmplnt_num", "cmplnt_fr_dt", "cmplnt_fr_tm", "law_cat_cd", "latitude", "longitude"];
export const FORBIDDEN_FIELD = /race|sex|age_group|vic_|susp_|prem|patrol|ofns|pd_desc|parks|hadevelopt|housing/i;
const LAW_CATS = ["FELONY", "MISDEMEANOR", "VIOLATION"];
const PAGE = 50000;
const MIN_CORNERS = 3;
const LOW_COUNT = 20;
const EARTH_M = 6371008.8;   // mean Earth radius (IUGG)

// ------------------------------------------------------------------ pure helpers (unit-tested)
export function haversine(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function isDate(s) {
  if (typeof s !== "string" || !ISO.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export const dow = (day) => new Date(day + "T00:00:00Z").getUTCDay();          // calendar date -> 0=Sun..6=Sat
export function addDays(day, n) { const d = new Date(day + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function hhmm(s) {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(s ?? ""));
  if (!m || +m[1] > 23 || +m[2] > 59 || (m[3] !== undefined && +m[3] > 59)) return null;
  return +m[1] * 60 + +m[2];
}

/** School days in [from, to]: listed weekdays, minus excluded dates (holidays, breaks). */
export function schoolDays(from, to, weekdays, exclude = []) {
  const ex = new Set(exclude), out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (weekdays.includes(dow(d)) && !ex.has(d)) out.push(d);
  return out;
}

/**
 * Parse and validate one raw Socrata row. Returns { rec } or { reject: reason }.
 * The dataset holds impossible dates (years such as 1010 and 1016) and rows without coordinates; they are counted, not used.
 */
export function cleanRow(raw, { minYear = 2006, maxDay }) {
  const day = typeof raw.cmplnt_fr_dt === "string" ? raw.cmplnt_fr_dt.slice(0, 10) : "";
  if (!isDate(day)) return { reject: "bad_date" };
  if (+day.slice(0, 4) < minYear || (maxDay && day > maxDay)) return { reject: "date_out_of_range" };
  const min = hhmm(raw.cmplnt_fr_tm);
  if (min === null) return { reject: "bad_time" };
  const lat = Number(raw.latitude), lon = Number(raw.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 40.4 || lat > 41.0 || lon < -74.3 || lon > -73.6) return { reject: "bad_location" };
  const id = String(raw.cmplnt_num ?? "").trim();
  if (!/^[0-9A-Za-z-]{1,32}$/.test(id)) return { reject: "bad_id" };
  const law = LAW_CATS.includes(raw.law_cat_cd) ? raw.law_cat_cd : "OTHER";
  return { rec: { id, day, min, law, lat, lon } };
}

/** Deterministic PRNG (mulberry32), so the same seed reproduces the same confidence interval. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
export function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** units: [{ group: "treated"|"control", pre: rate, post: rate }]. DiD = (T.post - T.pre) - (C.post - C.pre). */
export function did(units) {
  const t = units.filter(u => u.group === "treated"), c = units.filter(u => u.group === "control");
  const dT = mean(t.map(u => u.post - u.pre)), dC = mean(c.map(u => u.post - u.pre));
  return { estimate: dT - dC, treated_change: dT, control_change: dC };
}

/** Corner-level bootstrap: resample treated and control corners separately, with replacement; percentile CI. */
export function bootstrap(units, { reps = 2000, seed = 1, level = 0.95 } = {}) {
  const t = units.filter(u => u.group === "treated"), c = units.filter(u => u.group === "control");
  const r = rng(seed), est = [];
  const pick = (xs) => Array.from(xs, () => xs[Math.floor(r() * xs.length)]);
  for (let i = 0; i < reps; i++) est.push(did([...pick(t), ...pick(c)]).estimate);
  est.sort((a, b) => a - b);
  const a = (1 - level) / 2;
  return { low: quantile(est, a), high: quantile(est, 1 - a), reps, seed, level };
}

/** Incidents that count for a corner: within radius, on a school day of the period, start time inside a window. */
export function countFor(corner, recs, { radius, days, windows, laws }) {
  const daySet = new Set(days);
  let n = 0;
  for (const x of recs) {
    if (!daySet.has(x.day) || !laws.includes(x.law)) continue;
    if (!windows.some(w => x.min >= w.start && x.min < w.end)) continue;
    if (haversine(corner.lat, corner.lon, x.lat, x.lon) <= radius) n++;
  }
  return n;
}

export function validateConfig(cfg, coverage) {
  const err = (m) => { throw new Error("config: " + m); };
  if (!cfg || typeof cfg !== "object") err("not an object");
  for (const p of ["pre", "post"]) {
    if (!isDate(cfg[p]?.from) || !isDate(cfg[p]?.to) || cfg[p].from > cfg[p].to) err(`${p}.from/${p}.to must be valid dates, from <= to`);
  }
  if (cfg.pre.to >= cfg.post.from) err("pre period must end before the post period starts");
  const windows = (cfg.windows ?? []).map(w => ({ start: hhmm(w.start), end: hhmm(w.end), label: `${w.start}-${w.end}` }));
  if (!windows.length || windows.some(w => w.start === null || w.end === null || w.end <= w.start)) err("windows: [{start:'HH:MM', end:'HH:MM'}], end after start");
  const weekdays = cfg.weekdays ?? [1, 2, 3, 4, 5];
  if (!Array.isArray(weekdays) || !weekdays.length || weekdays.some(d => !Number.isInteger(d) || d < 0 || d > 6)) err("weekdays: integers 0-6");
  const exclude = cfg.exclude_dates ?? [];
  if (!Array.isArray(exclude) || exclude.some(d => !isDate(d))) err("exclude_dates: YYYY-MM-DD list");
  const radius = cfg.radius_m ?? 150;
  const radii = [...new Set([radius, ...(cfg.sensitivity_radii_m ?? [100, 250])])].sort((a, b) => a - b);
  if (radii.some(x => !Number.isFinite(x) || x < 25 || x > 1000)) err("radius_m / sensitivity_radii_m between 25 and 1000");
  const laws = cfg.law_categories ?? LAW_CATS;
  if (!Array.isArray(laws) || !laws.length || laws.some(l => !LAW_CATS.includes(l))) err(`law_categories ⊆ ${LAW_CATS.join(",")}`);
  const corner = (x, i, g) => {
    if (!x || !Number.isFinite(+x.lat) || !Number.isFinite(+x.lon)) err(`${g}[${i}]: lat/lon required`);
    return { id: String(x.id ?? `${g}-${i + 1}`), label: String(x.label ?? x.id ?? `${g} ${i + 1}`), lat: +x.lat, lon: +x.lon, group: g };
  };
  let treated;
  if (cfg.treated === "coverage") {
    if (!coverage) err('treated: "coverage" needs --coverage <export.json>');
    const m = new Map();
    for (const r of coverage.rows) if (r.adult_minutes > 0 && !m.has(r.corner_id)) m.set(r.corner_id, { id: String(r.corner_id), label: r.label, lat: r.lat, lon: r.lon });
    treated = [...m.values()].map((x, i) => corner(x, i, "treated"));
  } else treated = (cfg.treated ?? []).map((x, i) => corner(x, i, "treated"));
  const controls = (cfg.controls ?? []).map((x, i) => corner(x, i, "control"));
  const reps = cfg.bootstrap_reps ?? 2000, seed = cfg.seed ?? 20261101;
  if (!Number.isInteger(reps) || reps < 200 || reps > 100000) err("bootstrap_reps: 200-100000");
  if (!Number.isInteger(seed)) err("seed: integer");
  return { pre: cfg.pre, post: cfg.post, windows, weekdays, exclude, radius, radii, laws, treated, controls, reps, seed,
    study: String(cfg.study ?? "unnamed study"), registered: cfg.registered ?? null };
}

export function validateCoverage(cov) {
  if (!cov || cov.schema !== "walkwithus.coverage.v1" || !Array.isArray(cov.rows)) throw new Error("coverage: not a walkwithus.coverage.v1 export");
  for (const r of cov.rows) {
    if (!isDate(r.day) || !Number.isFinite(r.lat) || !Number.isFinite(r.lon) || !Number.isInteger(r.adult_minutes)) throw new Error("coverage: malformed row");
    for (const k of Object.keys(r)) if (!["day", "corner_id", "label", "lat", "lon", "adult_minutes", "walks_done", "walks_done_suppressed"].includes(k)) throw new Error(`coverage: unexpected field ${k}`);
  }
  return cov;
}

/** Spillover check: a control within 2 radii of a treated corner shares incidents with it and biases the estimate toward 0. */
export function overlaps(treated, controls, radius) {
  const out = [];
  for (const t of treated) for (const c of controls) {
    const d = haversine(t.lat, t.lon, c.lat, c.lon);
    if (d < 2 * radius) out.push({ treated: t.id, control: c.id, distance_m: Math.round(d) });
  }
  return out;
}

const per100 = (n, days) => (days ? (100 * n) / days : NaN);

/** The whole analysis on already-fetched, cleaned records. Pure: no network, no clock. */
export function analyze(cfg, recs, { dataEnd } = {}) {
  const warnings = [];
  const post = { ...cfg.post };
  if (dataEnd && post.to > dataEnd) {
    warnings.push(`Post period cut from ${cfg.post.to} to ${dataEnd}: the published data ends there. Days without data would read as zero incidents.`);
    post.to = dataEnd;
  }
  if (post.to < post.from) return { status: "INSUFFICIENT_DATA", reason: "no published data inside the post period yet", warnings };
  const preDays = schoolDays(cfg.pre.from, cfg.pre.to, cfg.weekdays, cfg.exclude);
  const postDays = schoolDays(post.from, post.to, cfg.weekdays, cfg.exclude);
  if (cfg.treated.length < MIN_CORNERS || cfg.controls.length < MIN_CORNERS) {
    return { status: "INSUFFICIENT_DATA", reason: `need at least ${MIN_CORNERS} treated and ${MIN_CORNERS} control corners (have ${cfg.treated.length} and ${cfg.controls.length})`, warnings };
  }
  if (preDays.length < 20 || postDays.length < 20) return { status: "INSUFFICIENT_DATA", reason: `need at least 20 school days in each period (pre ${preDays.length}, post ${postDays.length})`, warnings };
  const ov = overlaps(cfg.treated, cfg.controls, cfg.radius);
  if (ov.length) warnings.push(`${ov.length} treated/control pair(s) closer than 2 × ${cfg.radius} m share incidents (spillover); the estimate is biased toward zero. Pairs: ${ov.map(o => `${o.treated}~${o.control} ${o.distance_m} m`).join(", ")}`);

  const unitsAt = (radius, preD, postD) => [...cfg.treated, ...cfg.controls].map(c => {
    const nPre = countFor(c, recs, { radius, days: preD, windows: cfg.windows, laws: cfg.laws });
    const nPost = countFor(c, recs, { radius, days: postD, windows: cfg.windows, laws: cfg.laws });
    return { id: c.id, label: c.label, group: c.group, n_pre: nPre, n_post: nPost, pre: per100(nPre, preD.length), post: per100(nPost, postD.length) };
  });
  const byRadius = cfg.radii.map(radius => {
    const units = unitsAt(radius, preDays, postDays);
    return { radius_m: radius, ...did(units), ci: bootstrap(units, { reps: cfg.reps, seed: cfg.seed }), units };
  });
  const main = byRadius.find(r => r.radius_m === cfg.radius);
  const totalPre = main.units.reduce((s, u) => s + u.n_pre, 0);
  const silent = main.units.filter(u => u.n_pre === 0 && u.n_post === 0);
  if (silent.length) warnings.push(`${silent.length} corner(s) had no incidents in either period (${silent.map(u => u.id).join(", ")}): check the coordinates (a park, the water or a closed street reads as zero) and whether the corner belongs in the study.`);
  if (totalPre < LOW_COUNT) warnings.push(`Only ${totalPre} incidents in the pre period across all corners at ${cfg.radius} m: estimates are unstable.`);

  // Placebo: pretend the program started halfway through the pre period. A real pre-existing difference in trends shows here.
  const half = Math.floor(preDays.length / 2);
  const pu = unitsAt(cfg.radius, preDays.slice(0, half), preDays.slice(half));
  const placebo = { ...did(pu), ci: bootstrap(pu, { reps: cfg.reps, seed: cfg.seed }), split_day: preDays[half] };
  placebo.passes = placebo.ci.low <= 0 && placebo.ci.high >= 0;
  if (!placebo.passes) warnings.push("Placebo pre-trend check FAILED: treated and control corners were already diverging before the program. Do not read the main estimate as an effect.");

  const excludes0 = main.ci.low > 0 || main.ci.high < 0;
  const signs = new Set(byRadius.map(r => Math.sign(r.estimate)));
  if (signs.size > 1) warnings.push("The estimate changes sign across radii: the result is not robust to the buffer size.");
  return {
    status: "OK", warnings,
    periods: { pre: { ...cfg.pre, school_days: preDays.length }, post: { ...post, school_days: postDays.length } },
    main: { radius_m: main.radius_m, estimate: main.estimate, treated_change: main.treated_change, control_change: main.control_change, ci: main.ci,
      ci_excludes_zero: excludes0 },
    placebo, sensitivity: byRadius.map(r => ({ radius_m: r.radius_m, estimate: r.estimate, ci: r.ci })),
    units: main.units,
    interpretation: !placebo.passes ? "NOT_INTERPRETABLE (pre-trends differ)"
      : !excludes0 ? "NO_DETECTABLE_CHANGE (the interval includes zero)"
      : main.estimate < 0 ? "FEWER_INCIDENTS_ASSOCIATED (association, not proof of cause)" : "MORE_INCIDENTS_ASSOCIATED (association, not proof of cause)",
  };
}

export function coverageDose(cfg, coverage) {
  if (!coverage) return null;
  return cfg.treated.map(t => {
    const rows = coverage.rows.filter(r => String(r.corner_id) === t.id && r.day >= cfg.post.from && r.day <= cfg.post.to);
    return { id: t.id, label: t.label, covered_days: rows.filter(r => r.adult_minutes > 0).length,
      adult_minutes: rows.reduce((s, r) => s + r.adult_minutes, 0),
      walks_done_reported: rows.reduce((s, r) => s + (r.walks_done ?? 0), 0), cells_suppressed: rows.filter(r => r.walks_done_suppressed).length };
  });
}

// ------------------------------------------------------------------ data access
export function soqlWhere(c, radius, from, to) {
  const n = (x) => { if (!Number.isFinite(x)) throw new Error("bad number"); return String(x); };
  if (!isDate(from) || !isDate(to)) throw new Error("bad date");
  return `within_circle(lat_lon, ${n(c.lat)}, ${n(c.lon)}, ${n(Math.ceil(radius))}) AND cmplnt_fr_dt between '${from}T00:00:00' and '${to}T23:59:59'`;
}

async function getJSON(url, fetchImpl, headers) {
  for (let i = 0; ; i++) {
    let r;
    try { r = await fetchImpl(url, { headers }); } catch (e) { if (i < 4) { await sleep(500 * 2 ** i); continue; } throw e; }
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && i < 4) { await sleep((Number(r.headers?.get?.("retry-after")) || 0) * 1000 || 500 * 2 ** i); continue; }
    throw new Error(`HTTP ${r.status} for ${new URL(url).pathname}`);
  }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Fetch every complaint near every corner (largest radius) across both datasets; dedupe by complaint number. */
export async function fetchAll(cfg, { fetchImpl = fetch, token = process.env.SOCRATA_APP_TOKEN, now = new Date() } = {}) {
  const headers = { accept: "application/json", ...(token ? { "x-app-token": token } : {}) };
  const select = FIELDS.join(",");
  if (FORBIDDEN_FIELD.test(select)) throw new Error("refusing to request a demographic or extraneous field");
  const today = now.toISOString().slice(0, 10);
  const rmax = cfg.radii[cfg.radii.length - 1];
  const meta = [], perCorner = {}, rejects = {};
  for (const d of DATASETS) {
    const v = await getJSON(`${SOCRATA}/api/views/${d.id}.json`, fetchImpl, headers);
    const end = await getJSON(`${SOCRATA}/resource/${d.id}.json?` + new URLSearchParams({ $select: "max(cmplnt_fr_dt) AS end", $where: `cmplnt_fr_dt <= '${today}T23:59:59'` }), fetchImpl, headers);
    meta.push({ id: d.id, name: d.name, rows_updated_at: v.rowsUpdatedAt ? new Date(v.rowsUpdatedAt * 1000).toISOString() : null,
      data_end: typeof end?.[0]?.end === "string" ? end[0].end.slice(0, 10) : null });
  }
  const dataEnd = meta.map(m => m.data_end).filter(Boolean).sort().pop() ?? null;
  const seen = new Map();
  for (const c of [...cfg.treated, ...cfg.controls]) {
    const rows = [];
    for (const d of DATASETS) {
      for (let offset = 0; ; offset += PAGE) {
        const qs = new URLSearchParams({ $select: select, $where: soqlWhere(c, rmax, cfg.pre.from, cfg.post.to), $order: "cmplnt_num", $limit: String(PAGE), $offset: String(offset) });
        const page = await getJSON(`${SOCRATA}/resource/${d.id}.json?${qs}`, fetchImpl, headers);
        rows.push(...page);
        if (page.length < PAGE) break;
      }
    }
    const recs = [], ids = new Set();
    for (const raw of rows) {
      const k = Object.keys(raw).find(k => !FIELDS.includes(k));
      if (k) throw new Error(`unexpected field in response: ${k}`);
      const { rec, reject } = cleanRow(raw, { maxDay: today });
      if (reject) { rejects[reject] = (rejects[reject] ?? 0) + 1; continue; }
      if (!ids.has(rec.id)) { ids.add(rec.id); recs.push(rec); }
      seen.set(rec.id, rec);
    }
    recs.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    perCorner[c.id] = { rows: recs.length, sha256: sha256(recs.map(r => [r.id, r.day, r.min, r.law, r.lat, r.lon].join("|")).join("\n")) };
  }
  const all = [...seen.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { recs: all, meta, dataEnd, perCorner, rejects, queried_at: now.toISOString(),
    all_sha256: sha256(all.map(r => [r.id, r.day, r.min, r.law, r.lat, r.lon].join("|")).join("\n")) };
}
export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// ------------------------------------------------------------------ report
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "n/a");
export function renderMarkdown(rep) {
  const L = [];
  L.push(`# Outcome report — ${rep.parameters.study}`, "");
  L.push(`Generated ${rep.generated_at} by ${TOOL} ${TOOL_VERSION}. **Status: ${rep.result.status}.**`, "");
  L.push("> This measures an association between Walk With Us coverage and *reported* incidents. It cannot prove the program caused a change. Reported complaints are not all crime, and reporting itself can change when adults are present.", "");
  if (rep.result.warnings?.length) { L.push("## Warnings", ""); for (const w of rep.result.warnings) L.push(`- ${w}`); L.push(""); }
  if (rep.result.status !== "OK") { L.push(`No estimate: ${rep.result.reason}.`, ""); }
  else {
    const m = rep.result.main;
    L.push("## Result", "",
      `Incidents per 100 school days within ${m.radius_m} m, during ${rep.parameters.windows.join(", ")}:`, "",
      "| | Change, treated corners | Change, control corners | Difference-in-differences | 95% CI |", "|---|---|---|---|---|",
      `| ${m.radius_m} m | ${f2(m.treated_change)} | ${f2(m.control_change)} | **${f2(m.estimate)}** | ${f2(m.ci.low)} to ${f2(m.ci.high)} |`, "",
      `Reading: **${rep.result.interpretation}**.`, "",
      "## Checks", "",
      `- Placebo (fake start ${rep.result.placebo.split_day}): ${f2(rep.result.placebo.estimate)} (CI ${f2(rep.result.placebo.ci.low)} to ${f2(rep.result.placebo.ci.high)}) — ${rep.result.placebo.passes ? "passes (no pre-existing divergence detected)" : "**fails**"}.`,
      `- Sensitivity: ${rep.result.sensitivity.map(s => `${s.radius_m} m → ${f2(s.estimate)} [${f2(s.ci.low)}, ${f2(s.ci.high)}]`).join("; ")}.`,
      `- Periods: pre ${rep.result.periods.pre.from}..${rep.result.periods.pre.to} (${rep.result.periods.pre.school_days} school days), post ${rep.result.periods.post.from}..${rep.result.periods.post.to} (${rep.result.periods.post.school_days}).`, "",
      "## Corners", "", "| Corner | Group | Incidents pre | Incidents post | Rate pre | Rate post |", "|---|---|---|---|---|---|");
    for (const u of rep.result.units) L.push(`| ${u.label.replace(/\|/g, "/")} | ${u.group} | ${u.n_pre} | ${u.n_post} | ${f2(u.pre)} | ${f2(u.post)} |`);
    L.push("");
  }
  if (rep.coverage_dose) {
    L.push("## Program coverage in the post period (from the app's anonymous export)", "", "| Corner | Days covered | Adult-minutes | Walks (cells < 3 hidden) |", "|---|---|---|---|");
    for (const d of rep.coverage_dose) L.push(`| ${d.label.replace(/\|/g, "/")} | ${d.covered_days} | ${d.adult_minutes} | ${d.walks_done_reported}${d.cells_suppressed ? ` (+${d.cells_suppressed} hidden cells)` : ""} |`);
    L.push("");
  }
  L.push("## Data provenance", "");
  for (const m of rep.data.datasets) L.push(`- ${m.name} (\`${m.id}\`): rows updated ${m.rows_updated_at ?? "unknown"}, latest complaint date ${m.data_end ?? "unknown"}.`);
  L.push(`- Queried ${rep.data.queried_at}. Fields: ${FIELDS.join(", ")}. Records used: ${rep.data.records}. Rejected: ${JSON.stringify(rep.data.rejected)}.`,
    `- SHA-256 of all records used: \`${rep.data.all_sha256}\` (per-corner hashes in report.json). Re-running later can differ: the city revises past records.`, "");
  return L.join("\n");
}

export async function run({ config, coverage, now = new Date(), fetchImpl = fetch, token } = {}) {
  const cov = coverage ? validateCoverage(coverage) : null;
  const cfg = validateConfig(config, cov);
  const data = await fetchAll(cfg, { fetchImpl, token, now });
  const result = analyze(cfg, data.recs, { dataEnd: data.dataEnd });
  return {
    tool: TOOL, tool_version: TOOL_VERSION, generated_at: now.toISOString(),
    parameters: { study: cfg.study, registered: cfg.registered, pre: cfg.pre, post: cfg.post, windows: cfg.windows.map(w => w.label),
      weekdays: cfg.weekdays, exclude_dates: cfg.exclude.length, radius_m: cfg.radius, radii_m: cfg.radii, law_categories: cfg.laws,
      bootstrap_reps: cfg.reps, seed: cfg.seed, treated: cfg.treated.map(({ id, label, lat, lon }) => ({ id, label, lat, lon })),
      controls: cfg.controls.map(({ id, label, lat, lon }) => ({ id, label, lat, lon })) },
    data: { datasets: data.meta, data_end: data.dataEnd, queried_at: data.queried_at, records: data.recs.length, rejected: data.rejects,
      per_corner: data.perCorner, all_sha256: data.all_sha256 },
    coverage_dose: coverageDose(cfg, cov),
    result,
  };
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!/^--(config|out|coverage)$/.test(a) || argv[i + 1] === undefined) throw new Error(`usage: node scripts/outcomes.mjs --config study.json --out DIR [--coverage coverage.json]`);
    o[a.slice(2)] = argv[++i];
  }
  if (!o.config || !o.out) throw new Error("usage: node scripts/outcomes.mjs --config study.json --out DIR [--coverage coverage.json]");
  return o;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const a = args(process.argv.slice(2));
    const rep = await run({ config: JSON.parse(readFileSync(a.config, "utf8")), coverage: a.coverage ? JSON.parse(readFileSync(a.coverage, "utf8")) : null });
    mkdirSync(a.out, { recursive: true });
    writeFileSync(`${a.out}/report.json`, JSON.stringify(rep, null, 2) + "\n");
    writeFileSync(`${a.out}/report.md`, renderMarkdown(rep));
    console.log(`${rep.result.status}${rep.result.interpretation ? " — " + rep.result.interpretation : ""}. Wrote ${a.out}/report.md and report.json`);
    process.exit(rep.result.status === "OK" ? 0 : 2);
  } catch (e) { console.error(String(e.message || e)); process.exit(1); }
}
