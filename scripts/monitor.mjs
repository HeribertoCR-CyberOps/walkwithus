#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Savvy Solution Pros LLC. Walk With Us — see NOTICE.
// Synthetic monitor — measures availability from outside, the only honest way to state an uptime number.
// Usage:
//   node scripts/monitor.mjs https://walk.example.org [org-slug] [--prom /path/textfile.prom] [--log /path/probes.jsonl]
// Exit 0 = all probes pass; 1 = any failure. Reads only public endpoints; never touches personal data.
// Suggested schedule: every 60 s (systemd timer / cron) → node-exporter textfile → Grafana alert; or GitHub Actions (5 min).
import { appendFileSync, writeFileSync, readFileSync, renameSync } from "node:fs";

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) || "").replace(/\/$/, "");
const slug = args.find((a, i) => i > 0 && !a.startsWith("--") && !/^https?:/.test(a) && !/^\//.test(a) && args[i - 1] !== "--prom" && args[i - 1] !== "--log");
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
if (!base) { console.error("usage: monitor.mjs <base-url> [org-slug] [--prom file] [--log file]"); process.exit(2); }

const probes = [
  ["liveness", "/api/health", (r, b) => r.status === 200 && b.ok === true],
  ["readiness", "/api/health/ready", (r, b) => r.status === 200 && b.ok === true],
  ["app_shell", "/", (r, b, t) => r.status === 200 && /Danger now\? Call 911/.test(t) && /default-src 'none'/.test(r.headers.get("content-security-policy") || "")],
  // privacy promise: nothing injected by the edge (analytics beacon, bot JS) and no-transform still set
  ["no_injection", "/", (r, b, t) => !/<script(?![^>]*src="\/js\/)/i.test(t) && /no-transform/.test(r.headers.get("cache-control") || "")],
  ["emergency_page", "/404-check-" + Date.now(), (r, b, t) => /tel:911/.test(t)],
];
if (slug) probes.push(["schedule", `/api/o/${slug}`, (r, b) => r.status === 200 && Array.isArray(b.corners)]);

const results = [];
for (const [name, path, ok] of probes) {
  const t0 = performance.now();
  let pass = false, status = 0, detail = "";
  try {
    const r = await fetch(base + path, { signal: AbortSignal.timeout(10000), headers: { "user-agent": "walkwithus-monitor/1.1" } });
    status = r.status;
    const text = await r.text();
    let body = {}; try { body = JSON.parse(text); } catch {}
    pass = !!ok(r, body, text);
    if (!pass) detail = (body.problems || []).join(",") || `status ${status}`;
  } catch (e) { detail = e.name; }
  results.push({ name, pass, status, ms: Math.round(performance.now() - t0), detail });
}

const now = new Date().toISOString();
const allOk = results.every((r) => r.pass);
console.log(JSON.stringify({ at: now, base, ok: allOk, results }));

const logf = opt("--log");
if (logf) appendFileSync(logf, JSON.stringify({ at: now, ok: allOk, r: results.map((x) => [x.name, x.pass ? 1 : 0, x.ms]) }) + "\n");

const promf = opt("--prom");
if (promf) {
  // Rolling 30-day availability from the probe log, if one is kept.
  let avail = "";
  if (logf) {
    const cutoff = Date.now() - 30 * 86400000;
    const rows = readFileSync(logf, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((x) => x && Date.parse(x.at) >= cutoff);
    if (rows.length) avail = `# HELP walkwithus_availability_30d fraction of probe runs fully green over 30 days\n# TYPE walkwithus_availability_30d gauge\nwalkwithus_availability_30d ${(rows.filter((x) => x.ok).length / rows.length).toFixed(6)}\n`;
  }
  const lines = ["# HELP walkwithus_probe_up 1 if the probe passed", "# TYPE walkwithus_probe_up gauge",
    ...results.map((r) => `walkwithus_probe_up{probe="${r.name}"} ${r.pass ? 1 : 0}`),
    "# HELP walkwithus_probe_ms probe latency in milliseconds", "# TYPE walkwithus_probe_ms gauge",
    ...results.map((r) => `walkwithus_probe_ms{probe="${r.name}"} ${r.ms}`)];
  writeFileSync(promf + ".tmp", lines.join("\n") + "\n" + avail);
  renameSync(promf + ".tmp", promf);   // atomic for the textfile collector
}
process.exit(allOk ? 0 : 1);
