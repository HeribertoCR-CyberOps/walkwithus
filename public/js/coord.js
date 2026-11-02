// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Savvy Solution Pros LLC. Walk With Us — see NOTICE.
import { el, api, hhmm } from "./i18n.js";

const fmt = (s) => new Date(s * 1000).toLocaleString(undefined, { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const content = document.getElementById("content");
// Same rule as the server (src/index.ts publicOrg). A crafted ?o= value such as "../.." must never become part of an API path
// (client-side request forgery with the coordinator's Access session), so anything else is treated as "no org selected".
const SLUG = /^[a-z0-9-]{3,40}$/;
const qSlug = new URLSearchParams(location.search).get("o");
let slug = qSlug && SLUG.test(qSlug) ? qSlug : null;
let D = null;

function note(box, ok, ...n) { box.className = "result " + (ok ? "ok" : "err"); box.replaceChildren(...n); }
const ERR = {
  admin_after_review: "Until the program is reviewed, only the person who signed it up can be an admin. Add this person as a coordinator now; make them an admin after review.",
  too_many_coordinators: "This program has reached its coordinator limit (5 before review, 50 after).",
  too_many_corners: "This program has reached its limit of 50 active corners.", too_many_windows: "This program has reached its limit of 300 published hour blocks.",
  rate_limited: "Too many changes in the last hour. Please wait and try again.", application_pending: "You already have a program waiting for review.",
  slug_taken: "That web address is taken. Choose another.", slug_reserved: "That web address is reserved. Choose another.",
  commitments_required: "Please confirm all five commitments.", review_queue_full: "The review queue is full right now. Please try again in a few days or write to the maintainers.",
};
async function act(box, fn) { try { await fn(); } catch (e) { note(box, false, ERR[e.code] || "Error: " + e.message); } }

// Program status: is the public walk form open, and how close is today's traffic to the daily ceilings?
function statusSection() {
  const r = D.readiness, t = D.today;
  if (!r || !t) return null;
  const items = [];
  if (D.org.status === "pending") items.push(el("p", { class: "result err", role: "status",
    text: "Waiting for review. Your program is saved but not public: there is no public page, volunteer form or walk form yet. Prepare corners, hours, closure days and coordinators now. An operator reviews the organization, typically within 2 business days, and then everything opens." }));
  if (D.org.demo) items.push(el("p", { class: "result ok", role: "status", text: "Demo program: the public forms work, but nothing families or volunteers submit is saved." }));
  else if (r.accepting_walks) items.push(el("p", { class: "result ok", role: "status",
    text: `Taking walk requests: ${r.coordinators} coordinator${r.coordinators === 1 ? "" : "s"}, ${r.approved_adults} approved adults.` }));
  else {
    const need = [];
    if (r.coordinators < 1) need.push("at least one coordinator");
    if (r.approved_adults < r.min_approved_adults) need.push(`${r.min_approved_adults - r.approved_adults} more approved adult${r.min_approved_adults - r.approved_adults === 1 ? "" : "s"}`);
    items.push(el("p", { class: "result err", role: "status",
      text: `Not taking walk requests yet. Families see "not taking requests yet" and 911. Needed: ${need.join(" and ")}.` }));
  }
  const bar = (label, n, cap, near) => el("div", { class: near ? "result err" : "muted", text: `${label} today: ${n} of ${cap}${near ? " (near the daily limit; beyond it, families are asked to call the organization)" : ""}` });
  items.push(bar("Walk requests", t.walks, t.walk_cap, t.walks_near_cap), bar("Volunteer applications", t.applications, t.apply_cap, t.applications_near_cap));
  return el("section", { class: "card", "aria-labelledby": "st" }, el("h2", { id: "st", text: "Program status" }), ...items);
}

function cornersSection() {
  return el("section", { class: "card" }, el("h2", { text: "Corners right now" }),
    el("p", { class: "muted", text: "Covered = 2 or more adults checked in (Rule of Two)." }),
    el("div", { class: "scroll" }, el("table", {}, el("thead", {}, el("tr", {}, ...["Corner", "Adults now", "Status"].map((h) => el("th", { text: h })))),
      el("tbody", {}, ...D.corners.map((c) => el("tr", {}, el("td", {}, el("strong", { text: c.label }), el("div", { class: "muted", text: c.cross_streets })),
        el("td", { text: String(c.adults_now) }),
        el("td", {}, el("span", { class: "badge " + (!c.active ? "" : c.adults_now >= 2 ? "ok" : c.adults_now === 1 ? "bad" : "warn"),
          text: !c.active ? "inactive" : c.adults_now >= 2 ? "covered" : c.adults_now === 1 ? "ONE ADULT — send a second" : "uncovered" }))))))));
}

function walksSection() {
  const approved = D.volunteers.filter((v) => v.status === "approved" && !v.unreadable);   // unreadable records are never assignable
  const name = (id) => approved.find((v) => v.id === id)?.name || `#${id}`;
  const rows = D.walks.map((w) => {
    const box = el("div", { "aria-live": "polite" });
    const s1 = el("select", { "aria-label": "Adult 1" }, el("option", { value: "", text: "Adult 1…" }), ...approved.map((v) => el("option", { value: v.id, text: v.name })));
    const s2 = el("select", { "aria-label": "Adult 2" }, el("option", { value: "", text: "Adult 2…" }), ...approved.map((v) => el("option", { value: v.id, text: v.name })));
    if (w.v1) s1.value = w.v1; if (w.v2) s2.value = w.v2;
    const base = `/api/c/${slug}/walks/${w.id}`;
    return el("tr", {},
      el("td", {}, el("strong", { text: fmt(w.slot_start) }), el("div", { text: w.meeting_point }), el("div", { class: "muted", text: `ref ${w.ref} · ${w.lang} · deletes ${fmt(w.expires_at)}` })),
      el("td", {}, el("span", { class: "badge " + (w.status === "assigned" ? "ok" : "warn"), text: w.status }),
        w.status === "assigned" ? el("div", { class: "muted", text: `${name(w.v1)} + ${name(w.v2)}` }) : null),
      el("td", {}, el("div", { class: "row" },
        el("button", { class: "secondary", text: "Show callback", onclick: () => act(box, async () => { const r = await api(base + "/reveal", "POST", {});
          note(box, true, "Call: ", el("a", { href: "tel:" + r.callback, text: r.callback }), el("small", { class: "muted", text: " (logged)" })); }) })),
        el("div", { class: "grid2" }, s1, s2),
        el("div", { class: "row" },
          el("button", { text: "Assign two", onclick: () => act(box, async () => { await api(base + "/assign", "POST", { v1: Number(s1.value), v2: Number(s2.value) }); load(); }) }),
          el("button", { class: "secondary", text: "Done", onclick: () => act(box, async () => { await api(base + "/close", "POST", { status: "done" }); load(); }) }),
          el("button", { class: "secondary", text: "Cancel", onclick: () => act(box, async () => { if (!confirm("Cancel this request?")) return; await api(base + "/close", "POST", { status: "cancelled" }); load(); }) })),
        box));
  });
  return el("section", { class: "card" }, el("h2", { text: `Walk requests (${D.walks.length})` }),
    D.walks.length ? el("div", { class: "scroll" }, el("table", {}, el("tbody", {}, ...rows))) : el("p", { class: "muted", text: "No open requests." }));
}

function volunteersSection() {
  const rows = D.volunteers.map((v) => {
    const box = el("div", { "aria-live": "polite" });
    const base = `/api/c/${slug}/volunteers/${v.id}`;
    const onShift = D.on_shift.find((s) => s.volunteer_id === v.id);
    return el("tr", {},
      el("td", {}, el("strong", { text: v.unreadable ? "Unreadable record — tell the maintainers" : v.name }), el("div", { class: "muted", text: v.phone_masked || "" }),
        onShift ? el("span", { class: "badge ok", text: "on shift" }) : null),
      el("td", {}, el("span", { class: "badge " + (v.status === "approved" ? "ok" : "warn"), text: v.status })),
      el("td", {}, el("div", { class: "row" },
        el("button", { class: "secondary", text: "Phone", onclick: () => act(box, async () => { const r = await api(base + "/reveal", "POST", {});
          note(box, true, el("a", { href: "tel:" + r.phone, text: r.phone }), el("small", { class: "muted", text: " (logged)" })); }) }),
        D.you.role !== "admin" ? el("span", { class: "muted", text: v.status === "approved" ? "" : "Approval: an admin" }) :
        el("button", { text: v.status === "approved" ? "New link" : "Approve (met in person)", onclick: () => act(box, async () => {
          if (v.status !== "approved" && !confirm(`Approve ${v.name || "this record"}? Only approve someone you have met in person and briefed.`)) return;
          const r = await api(base + "/approve", "POST", {});
          note(box, true, el("div", { text: "Check-in link (shown once — give it in person or by Signal):" }), el("div", { class: "mono", text: r.checkin_link }),
            el("button", { class: "secondary", text: "Copy", onclick: async () => { try { await navigator.clipboard.writeText(r.checkin_link); } catch {} } }));
        }) }),
        el("button", { class: "danger", text: "Suspend", onclick: () => act(box, async () => { if (!confirm(`Suspend ${v.name || "this record"}? Their link stops working immediately, and any walks assigned to them reopen so you can assign two other adults.`)) return; await api(base + "/suspend", "POST", {}); load(); }) })),
        box));
  });
  return el("section", { class: "card" }, el("h2", { text: `Volunteers (${D.volunteers.length})` }),
    el("div", { class: "scroll" }, el("table", {}, el("tbody", {}, ...rows))));
}

const REASONS = [["holiday", "School holiday"], ["recess", "School recess"], ["remote_day", "Remote school day"], ["weather", "Weather"],
  ["not_staffed", "Not enough adults"], ["other", "Program closed (other)"]];
const reasonText = (r) => (REASONS.find(([k]) => k === r) || [r, r])[1];
const dayText = (d) => { const [y, m, dd] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }); };

// Days the program does not run. Any coordinator can set one (a snow day is decided at 6 a.m.). Families see these on the
// public page and cannot request a walk on them; walks already requested for that day are counted so nobody is forgotten.
function closuresSection() {
  const box = el("div", { "aria-live": "polite" });
  const day = el("input", { type: "date", id: "cl-day", min: D.today_ny, value: D.today_ny });
  const reason = el("select", { id: "cl-reason" }, ...REASONS.map(([v, t]) => el("option", { value: v, text: t })));
  const list = D.closures.length ? el("ul", { class: "plain" }, ...D.closures.map((c) => el("li", { class: "row" },
    el("span", { text: `${dayText(c.day)} — ${reasonText(c.reason)}` }),
    el("button", { class: "secondary", text: "Remove", onclick: () => act(box, async () => { await api(`/api/c/${slug}/closures/${c.id}/remove`, "POST", {}); load(); }) }))))
    : el("p", { class: "muted", text: "No closure days set. On a closure day the public page shows no times and families cannot request a walk." });
  return el("section", { class: "card", "aria-labelledby": "clh" }, el("h2", { id: "clh", text: `Closure days (${D.closures.length})` }), list,
    el("details", {}, el("summary", { text: "Add a closure day" }),
      el("label", { for: "cl-day", text: "Date" }), day, el("label", { for: "cl-reason", text: "Reason (shown to families)" }), reason,
      el("button", { text: "Save closure", onclick: () => act(box, async () => {
        const r = await api(`/api/c/${slug}/closures`, "POST", { day: day.value, reason: reason.value });
        note(box, r.walks_to_call ? false : true, r.walks_to_call
          ? `Saved. ${r.walks_to_call} walk request${r.walks_to_call === 1 ? " is" : "s are"} already booked that day: call ${r.walks_to_call === 1 ? "that family" : "those families"} (Walk requests, above).`
          : "Saved. Families now see this day as closed.");
        setTimeout(load, 4000); }) })),
    el("details", {}, el("summary", { text: "Add the NYC Public Schools 2026-27 days off" }),
      el("p", { class: "muted", text: "Adds every day in the official 2026-27 calendar when no student attends in person (holidays, recesses, the Nov 3 remote day), from today on. Days you already set are kept. You can remove any of them." }),
      el("button", { text: "Add official days off", onclick: () => act(box, async () => {
        const r = await api(`/api/c/${slug}/closures/preset`, "POST", { preset: "nyc-public-schools-2026-27" });
        note(box, true, el("p", { text: `Added ${r.added} day${r.added === 1 ? "" : "s"} (${r.skipped_existing} already set).` }),
          el("p", { class: "muted", text: "Not added — decide for your schools:" }), el("ul", {}, ...r.not_included.map((t) => el("li", { text: t }))),
          el("a", { href: r.source, target: "_blank", rel: "noopener noreferrer", text: "Official calendar (PDF)" }));
        D = await api(`/api/c/${slug}/dashboard`); }) })),
    box);
}

function windowsList(box) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], label = (id) => D.corners.find((c) => c.id === id)?.label || `#${id}`;
  if (!D.windows.length) return el("p", { class: "muted", text: "No published hours yet." });
  return el("div", { class: "scroll" }, el("table", {}, el("tbody", {}, ...D.windows.map((w) => el("tr", {},
    el("td", { text: label(w.corner_id) }), el("td", { text: days[w.dow] }), el("td", { text: `${hhmm(w.start_min)}–${hhmm(w.end_min)}` }),
    el("td", {}, el("button", { class: "secondary", text: "Remove", onclick: () => act(box, async () => {
      if (!confirm(`Remove ${label(w.corner_id)} ${days[w.dow]} ${hhmm(w.start_min)}–${hhmm(w.end_min)} from the public schedule?`)) return;
      const r = await api(`/api/c/${slug}/windows/${w.id}/remove`, "POST", {});
      if (r.walks_to_call) { note(box, false, `Removed. ${r.walks_to_call} walk request${r.walks_to_call === 1 ? " was" : "s were"} already booked in those hours: call ${r.walks_to_call === 1 ? "that family" : "those families"}.`); setTimeout(load, 5000); }
      else load(); }) })))))));
}

function adminSection() {
  if (D.you.role !== "admin") return null;
  const box = el("div", { "aria-live": "polite" });
  const f = (id, label, attrs = {}) => [el("label", { for: id, text: label }), el("input", { id, type: "text", ...attrs })];
  const v = (id) => document.getElementById(id).value;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return el("section", { class: "card" }, el("h2", { text: "Admin" }),
    el("details", {}, el("summary", { text: "Add a corner" }), ...f("a-label", "Label (e.g. 'Crotona Ave & E 173 St')"), ...f("a-cross", "Cross streets / landmark"),
      el("div", { class: "grid2" }, el("div", {}, ...f("a-lat", "Latitude", { inputmode: "decimal" })), el("div", {}, ...f("a-lon", "Longitude", { inputmode: "decimal" }))),
      el("button", { text: "Add corner", onclick: () => act(box, async () => { await api(`/api/c/${slug}/corners`, "POST", { label: v("a-label"), cross_streets: v("a-cross"), lat: Number(v("a-lat")), lon: Number(v("a-lon")) }); load(); }) })),
    el("details", {}, el("summary", { text: `Published hours (${D.windows.length})` }), windowsList(box)),
    el("details", {}, el("summary", { text: "Add a coverage window" }),
      el("label", { for: "w-c", text: "Corner" }), el("select", { id: "w-c" }, ...D.corners.map((c) => el("option", { value: c.id, text: c.label }))),
      el("label", { for: "w-d", text: "Day" }), el("select", { id: "w-d" }, ...days.map((d, i) => el("option", { value: i, text: d }))),
      el("div", { class: "grid2" }, el("div", {}, ...f("w-s", "Start (HH:MM, 15-min)", { value: "07:30" })), el("div", {}, ...f("w-e", "End", { value: "08:45" }))),
      el("button", { text: "Add window", onclick: () => act(box, async () => { await api(`/api/c/${slug}/windows`, "POST", { corner_id: Number(v("w-c")), dow: Number(v("w-d")), start: v("w-s"), end: v("w-e") }); note(box, true, "Window added."); setTimeout(load, 1500); }) })),
    el("details", {}, el("summary", { text: "Add a coordinator" }), ...f("k-email", "Email (must be allowed by Cloudflare Access)", { type: "email" }),
      el("label", { class: "check" }, el("input", { type: "checkbox", id: "k-admin" }), el("span", { text: "Admin" })),
      el("button", { text: "Save", onclick: () => act(box, async () => { await api(`/api/c/${slug}/coordinators`, "POST", { email: v("k-email"), role: document.getElementById("k-admin").checked ? "admin" : "coordinator" }); note(box, true, "Saved."); }) })),
    el("details", {}, el("summary", { text: "Remove a coordinator" }), ...f("r-email", "Email", { type: "email" }),
      el("p", { class: "muted", text: "Another admin must remove or demote you; the last admin cannot be removed. Also remove them from the Cloudflare Access policy." }),
      el("button", { class: "danger", text: "Remove", onclick: () => act(box, async () => { if (!confirm(`Remove ${v("r-email")} as a coordinator?`)) return;
        await api(`/api/c/${slug}/coordinators/remove`, "POST", { email: v("r-email") }); note(box, true, "Removed."); }) })),
    el("div", { class: "row" }, el("button", { class: "secondary", text: "Verify audit log", onclick: () => act(box, async () => { const r = await api(`/api/c/${slug}/audit/verify`, "POST", {});
      note(box, r.ok, `Audit chain ${r.ok ? "intact" : "BROKEN — contact the maintainers"} — ${r.entries} entries for this program`); }) })), box);
}

const BOROUGHS = ["Bronx", "Brooklyn", "Manhattan", "Queens", "Staten Island"];
const ORG_TYPES = [["nonprofit", "Nonprofit (501(c)(3) or fiscally sponsored)"], ["school_parent_group", "School parent group (PTA/PA)"],
  ["faith", "Faith community"], ["tenant_association", "Tenant or block association"], ["community_board", "Community board / civic group"], ["other", "Other community organization"]];
const ACKS = [["ack_lead", "We have a named lead and at least one coordinator reachable during our published hours."],
  ["ack_meet_in_person", "We meet every volunteer in person and brief them before approving them."],
  ["ack_rule_of_two", "Walks always go to two approved adults (the software enforces this)."],
  ["ack_not_emergency", "This is not an emergency service: danger means 911, and volunteers never act as police."],
  ["ack_coverage", "We have, or will have before the first shift, liability coverage or a fiscal sponsor."]];

function joinSection(me) {
  const box = el("div", { "aria-live": "polite" });
  const inp = (id, label, attrs = {}) => [el("label", { for: id, text: label }), el("input", { id, type: "text", ...attrs })];
  const v = (id) => document.getElementById(id).value.trim();
  const toSlug = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const name = inp("j-name", "Program name (shown to families)", { maxlength: 120, required: true });
  const slugIn = inp("j-slug", "Web address: walk…/?o=", { maxlength: 40, pattern: "[a-z0-9-]{3,40}", required: true });
  name[1].addEventListener("input", () => { if (!slugIn[1].dataset.edited) slugIn[1].value = toSlug(name[1].value); });
  slugIn[1].addEventListener("input", () => { slugIn[1].dataset.edited = "1"; });
  const acks = ACKS.map(([k, t]) => el("label", { class: "check" }, el("input", { type: "checkbox", id: k }), el("span", { text: t })));
  return el("section", { class: "card", "aria-labelledby": "jh" }, el("h2", { id: "jh", text: "Start a Walk With Us program" }),
    el("p", { text: `Signed in as ${me.email}. You will be the program's lead (admin). The program stays private until an operator reviews your organization, typically within 2 business days. Nothing about you or your organization is public until then.` }),
    ...name, ...slugIn,
    el("label", { for: "j-borough", text: "Borough" }), el("select", { id: "j-borough" }, ...BOROUGHS.map((b) => el("option", { value: b, text: b }))),
    el("label", { for: "j-type", text: "Organization type" }), el("select", { id: "j-type" }, ...ORG_TYPES.map(([k, t]) => el("option", { value: k, text: t }))),
    ...inp("j-phone", "Program phone shown to families (optional; never a personal cell)", { type: "tel", inputmode: "tel" }),
    el("fieldset", { class: "card" }, el("legend", { text: "Our commitments" }), ...acks),
    el("button", { text: "Submit for review", onclick: () => act(box, async () => {
      const body = { name: v("j-name"), slug: v("j-slug"), borough: v("j-borough"), org_type: v("j-type"), public_phone: v("j-phone") };
      for (const [k] of ACKS) body[k] = document.getElementById(k).checked;
      const r = await api("/api/c/join", "POST", body);
      note(box, true, r.next); slug = r.slug; setTimeout(() => { location.search = `?o=${encodeURIComponent(r.slug)}`; }, 2500); }) }),
    box);
}

async function operatorSection() {
  const box = el("div", { "aria-live": "polite" });
  const { programs } = await api("/api/c/op/programs");
  const when = (t) => (t ? new Date(t * 1000).toLocaleDateString() : "—");
  const rows = programs.filter((p) => !p.demo).map((p) => el("tr", {},
    el("td", {}, el("strong", { text: p.name }), el("div", { class: "muted", text: `${p.slug} · ${p.borough || "—"} · ${p.org_type || "—"}` }),
      el("div", { class: "muted", text: `Signed up by: ${p.lead || "—"}${p.public_phone ? " · " + p.public_phone : ""}` }),
      p.other_coordinators ? el("div", { class: "muted", text: `Added by the lead (not verified): ${p.other_coordinators}` }) : null),
    el("td", {}, el("span", { class: "badge " + (p.status === "live" ? "ok" : p.status === "pending" ? "warn" : ""), text: p.status }),
      el("div", { class: "muted", text: `applied ${when(p.applied_at)} · reviewed ${when(p.reviewed_at)}` }),
      el("div", { class: "muted", text: `${p.corners} corners · ${p.windows} hours · ${p.coordinators} coordinators` })),
    el("td", {}, el("div", { class: "row" },
      p.status !== "live" ? el("button", { text: "Approve (verified)", onclick: () => act(box, async () => {
        if (!confirm(`Set ${p.name} live? Confirm you verified the organization and spoke with its lead.`)) return;
        await api(`/api/c/op/programs/${encodeURIComponent(p.slug)}/approve`, "POST", {}); load(); }) }) : null,
      p.status !== "declined" ? el("button", { class: "danger", text: p.status === "live" ? "Take offline" : "Decline", onclick: () => act(box, async () => {
        if (!confirm(`${p.status === "live" ? "Take" : "Decline"} ${p.name}? Its public page closes within a minute and its volunteer links stop at once.`)) return;
        const url = `/api/c/op/programs/${encodeURIComponent(p.slug)}/decline`;
        try { await api(url, "POST", {}); }
        catch (e) {
          if (e.code !== "walks_pending") throw e;
          if (!confirm(`${p.name} has ${e.data.walks} booked walk request${e.data.walks === 1 ? "" : "s"}. Its coordinators will lose access to the callback numbers. Call the lead first so those families are called. Take it offline anyway?`)) return;
          await api(url, "POST", { force: true });
        }
        load(); }) }) : null))));
  const pending = programs.filter((p) => p.status === "pending").length;
  return el("section", { class: "card", "aria-labelledby": "oph" }, el("h2", { id: "oph", text: `Operator: program review (${pending} waiting)` }),
    el("p", { class: "muted", text: "Before approving: confirm the organization exists (website, EIN or sponsor letter), speak with the lead, and check the commitments with them. Every decision is in the audit log." }),
    rows.length ? el("div", { class: "scroll" }, el("table", {}, el("tbody", {}, ...rows))) : el("p", { class: "muted", text: "No programs." }), box);
}

async function load() {
  try {
    if (!slug) {
      const me = await api("/api/c/me");
      document.getElementById("who").textContent = me.email;
      if (me.orgs.length === 1 && SLUG.test(me.orgs[0].slug) && !me.operator) slug = me.orgs[0].slug;
      else {
        const parts = [];
        if (me.operator) parts.push(await operatorSection());
        if (me.orgs.length) parts.push(el("section", { class: "card" }, el("h2", { text: "Your programs" }),
          el("ul", { class: "plain" }, ...me.orgs.map((o) => el("li", {}, el("a", { href: `?o=${encodeURIComponent(o.slug)}`, text: `${o.name} (${o.role}${o.status === "pending" ? ", waiting for review" : ""})` }))))));
        if (!me.orgs.some((o) => o.status === "pending" && o.applied)) parts.push(joinSection(me));
        content.replaceChildren(...parts); return;
      }
    }
    D = await api(`/api/c/${slug}/dashboard`);
    document.getElementById("who").textContent = `${D.you.email} · ${D.you.role} · ${D.org.name}`;
    content.replaceChildren(...[statusSection(), cornersSection(), walksSection(), closuresSection(), volunteersSection(), adminSection()].filter(Boolean));
  } catch (e) {
    content.replaceChildren(el("p", { class: "result err", text: e.message === "access_required" ? "Sign in through your organization's Cloudflare Access link." : e.message === "not_a_coordinator_for_org" ? "Your account is not a coordinator for this program." : "Error: " + e.message }));
  }
}
document.getElementById("refresh").addEventListener("click", load);
load();
// Auto-refresh every minute, but never while someone is filling in a form: a refresh would wipe what they typed.
setInterval(() => {
  const a = document.activeElement, busy = a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName);
  if (!slug || busy || content.querySelector("details[open]")) return;
  load();
}, 60000);
