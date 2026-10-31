#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Savvy Solution Pros LLC. Walk With Us — see NOTICE.
// Incident loop for the external monitor: diagnose → triage → recommend → resolve.
//   1. Diagnose: run every probe in scripts/monitor.mjs.
//   2. Triage: a failure must repeat after 30 s before it counts (filters network blips, the most common false alarm).
//   3. Recommend: each failing probe maps to the specific checks and fixes in docs/DEPLOY.md.
//   4. Resolve: open (or update) one GitHub issue labelled "incident"; close it automatically on recovery.
// Runs in GitHub Actions with the workflow's GITHUB_TOKEN (issues: write only). Reads public endpoints only; no personal data.
// Usage: node scripts/incident.mjs <base-url> [org-slug]     (needs `gh` and GITHUB_REPOSITORY; dry-run when DRY_RUN=1)
import { execFileSync } from "node:child_process";

const [base, slug] = process.argv.slice(2);
if (!base) { console.error("usage: incident.mjs <base-url> [org-slug]"); process.exit(2); }
const DRY = process.env.DRY_RUN === "1";
const TITLE = "Production health check failing";
const LABEL = "incident";

const probe = () => {
  try { return JSON.parse(execFileSync("node", ["scripts/monitor.mjs", base, ...(slug ? [slug] : [])], { encoding: "utf8" })); }
  catch (e) { try { return JSON.parse(String(e.stdout)); } catch { return { ok: false, results: [{ name: "monitor", pass: false, detail: "monitor crashed" }] }; } }
};

// Probe → what it means and what to do first. Keep in step with docs/DEPLOY.md §6.
const RUNBOOK = {
  cloudflare: "Cloudflare itself refused the probe (detail starts with cloudflare_). Usually the zone's bot protection challenging the monitor's data-center address, not an outage: check Security → Events for the ray id, then add a WAF skip/allow rule for the monitor (user agent walkwithus-monitor) or lower Browser Integrity Check / security level for /api/health*. Confirm real visitors are unaffected by loading the site from a phone.",
  liveness: "The Worker is not answering. Check https://www.cloudflarestatus.com, then `npx wrangler deployments list -c wrangler.ssp.jsonc`; if the latest deploy is the cause, `npx wrangler rollback -c wrangler.ssp.jsonc`.",
  readiness: "The Worker answers but reports problems (see `problems` in /api/health/ready). `db_unreachable`: D1 incident or quota (Workers Free fails queries past daily limits; Paid fixes it). `maintenance_stale_or_failing`: the hourly cron is not running or failing; check Workers → Logs for `maintenance_step_failed`. `audit_chain_broken`: stop and investigate; do not edit the audit table. `keys_invalid`: DATA_KEY/HMAC_KEY secret missing or malformed.",
  app_shell: "The home page or its security header changed. Confirm the last deploy and that `public/_headers` still sets the CSP `default-src 'none'`.",
  no_injection: "Something is inserting scripts into pages (privacy promise broken). Check Cloudflare zone settings: Web Analytics automatic setup, Bot Fight Mode / JavaScript detections, Rocket Loader, Zaraz; and that `public/_headers` still sets `Cache-Control: … no-transform`.",
  emergency_page: "The 404 page lost its 911 link. Check `public/404.html` and the assets `not_found_handling` setting.",
  schedule: "The public schedule API failed. Families can still see the cached schedule for up to 24 h; check readiness first, then the org's slug and `active` flag.",
  monitor: "The monitor itself crashed; check the workflow logs.",
};

function gh(args, input) {
  if (DRY) { console.log("[dry-run] gh", args.join(" ")); return "[]"; }
  return execFileSync("gh", args, { encoding: "utf8", input });
}

let run = probe();
if (!run.ok) {
  await new Promise((r) => setTimeout(r, 30000));
  const again = probe();
  // Only probes that failed twice count; a probe that recovered on retry was a blip.
  const failedTwice = new Set(again.results.filter((r) => !r.pass).map((r) => r.name));
  run = { ...again, ok: again.ok, confirmed: run.results.filter((r) => !r.pass && failedTwice.has(r.name)) };
}

const open = JSON.parse(gh(["issue", "list", "--label", LABEL, "--state", "open", "--json", "number,title", "--limit", "5"]) || "[]")
  .find((i) => i.title === TITLE);
const stamp = new Date().toISOString();

if (run.ok || !run.confirmed?.length) {
  if (open) {
    gh(["issue", "comment", String(open.number), "--body", `Recovered at ${stamp}: all probes pass against ${base}. Closing automatically.`]);
    gh(["issue", "close", String(open.number), "--reason", "completed"]);
    console.log(`resolved #${open.number}`);
  } else console.log("healthy");
  process.exit(0);
}

const lines = run.confirmed.map((r) => `- **${r.name}** failed twice (status ${r.status || "none"}${r.detail && r.detail !== `status ${r.status}` ? `, ${r.detail}` : ""}).\n  Next step: ${(/cloudflare_/.test(r.detail || "") ? RUNBOOK.cloudflare : RUNBOOK[r.name]) || "see docs/DEPLOY.md §6."}`);
const body = `**${base}** failed health probes at ${stamp} (confirmed by a retry 30 s later).\n\n${lines.join("\n")}\n\n` +
  `Full runbook: docs/DEPLOY.md §6 (debugging) and docs/SLO.md. This issue closes itself when every probe passes again.`;
if (!open) {
  try { gh(["label", "create", LABEL, "--color", "B3261E", "--description", "Automatic production health incident"]); } catch { /* exists */ }
  gh(["issue", "create", "--title", TITLE, "--label", LABEL, "--body", body + `\n\n<sub>failing probes: ${run.confirmed.map((r) => r.name).sort().join(",")}</sub>`]);
  console.log("opened incident");
} else {
  // Same failure still ongoing: add at most one comment per hour, or immediately if the set of failing probes changed.
  const sig = run.confirmed.map((r) => r.name).sort().join(",");
  const comments = JSON.parse(gh(["issue", "view", String(open.number), "--json", "comments"]) || "{}").comments || [];
  const last = comments[comments.length - 1];
  const lastSig = last && /failing probes: ([a-z_,]+)/.exec(last.body)?.[1];
  const recent = last && Date.now() - Date.parse(last.createdAt) < 3600_000;
  if (!(recent && lastSig === sig)) {
    gh(["issue", "comment", String(open.number), "--body", body + `\n\n<sub>failing probes: ${sig}</sub>`]);
    console.log(`updated #${open.number}`);
  } else console.log(`still failing, #${open.number} updated within the hour`);
}
process.exit(1);   // keep the workflow run red while the incident is open
