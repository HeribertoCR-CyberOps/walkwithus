// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Savvy Solution Pros LLC. Walk With Us — see NOTICE.
// Operator console. Reached only through Cloudflare Access (the operator's seat); program staff use c.html with Google.
import { el, api } from "./i18n.js";
import { note, ERR, act, BOROUGHS, ORG_TYPES } from "./staff.js";

const content = document.getElementById("content");
const when = (t) => (t ? new Date(t * 1000).toLocaleDateString() : "—");
const inp = (id, label, attrs = {}) => [el("label", { for: id, text: label }), el("input", { id, type: "text", ...attrs })];
const v = (id) => document.getElementById(id).value.trim();
const url = (slug, verb) => `/api/op/programs/${encodeURIComponent(slug)}/${verb}`;

function leadForm(p, box) {
  const id = "lead-" + p.slug;
  return el("details", {}, el("summary", { text: "Assign or replace the lead" }),
    el("p", { class: "muted", text: "Use when the lead has left or cannot be reached. Confirm the change with the organization first. The person signs in at /c.html with Google using this address." }),
    ...inp(id, "New lead's Google account email", { type: "email" }),
    p.status === "live" ? el("label", { class: "check" }, el("input", { type: "checkbox", id: id + "-r" }), el("span", { text: "Other admins step down to coordinator" })) : null,
    el("button", { text: "Assign lead", onclick: () => act(box, async () => {
      const replace = p.status === "live" ? document.getElementById(id + "-r").checked : true;
      if (!confirm(`Make ${v(id)} the lead (admin) of ${p.name}?${replace ? " Other admins become coordinators." : ""}`)) return;
      await api(url(p.slug, "lead"), "POST", { email: v(id), replace }); note(box, true, "Lead assigned. Audited."); setTimeout(load, 2500); }) }));
}

function row(p, box) {
  return el("tr", {},
    el("td", {}, el("strong", { text: p.name }), el("div", { class: "muted", text: `${p.slug} · ${p.borough || "—"} · ${p.org_type || "—"}` }),
      el("div", { class: p.lead ? "muted" : "result err", text: `Signed up by / lead: ${p.lead || "not recorded (set up by hand or before v1.3.1): verify who leads it"}${p.public_phone ? " · " + p.public_phone : ""}` }),
      p.other_coordinators ? el("div", { class: "muted", text: `${p.lead ? "Other staff (added by the lead, not verified)" : "Staff"}: ${p.other_coordinators}` }) : null),
    el("td", {}, el("span", { class: "badge " + (p.status === "live" ? "ok" : p.status === "pending" ? "warn" : ""), text: p.status }),
      el("div", { class: "muted", text: `applied ${when(p.applied_at)} · reviewed ${when(p.reviewed_at)}` }),
      el("div", { class: "muted", text: `${p.corners} corners · ${p.windows} hours · ${p.coordinators} staff` })),
    el("td", {}, el("div", { class: "row" },
      p.status !== "live" ? el("button", { text: "Approve (verified)", onclick: () => act(box, async () => {
        if (!confirm(`Set ${p.name} live? Confirm you verified the organization and spoke with its lead.`)) return;
        await api(url(p.slug, "approve"), "POST", {}); load(); }) }) : null,
      p.status !== "declined" ? el("button", { class: "danger", text: p.status === "live" ? "Take offline" : "Decline", onclick: () => act(box, async () => {
        if (!confirm(`${p.status === "live" ? "Take" : "Decline"} ${p.name}? Its public page closes within a minute and its volunteer links stop at once.`)) return;
        try { await api(url(p.slug, "decline"), "POST", {}); }
        catch (e) {
          if (e.code !== "walks_pending") throw e;
          if (!confirm(`${p.name} has ${e.data.walks} booked walk request${e.data.walks === 1 ? "" : "s"}. Its staff will lose access to the callback numbers. Call the lead first so those families are called. Take it offline anyway?`)) return;
          await api(url(p.slug, "decline"), "POST", { force: true });
        }
        load(); }) }) : null),
      p.status !== "declined" ? leadForm(p, box) : null));
}

function setupForm(box) {
  return el("details", {}, el("summary", { text: "Set up a program from an intake" }),
    el("p", { class: "muted", text: "Use this after you have spoken with the organization. Its lead signs in at /c.html with Google using the email below, then manages corners, hours, staff and volunteers for this program only. No Cloudflare seat is needed for them." }),
    ...inp("o-name", "Program name", { maxlength: 120 }), ...inp("o-slug", "Web address (?o=…)", { maxlength: 40 }),
    ...inp("o-lead", "Lead's Google account email", { type: "email" }),
    el("label", { for: "o-borough", text: "Borough" }), el("select", { id: "o-borough" }, ...BOROUGHS.map((b) => el("option", { value: b, text: b }))),
    el("label", { for: "o-type", text: "Organization type" }), el("select", { id: "o-type" }, ...ORG_TYPES.map(([k, t]) => el("option", { value: k, text: t }))),
    ...inp("o-phone", "Program phone shown to families (optional)", { type: "tel" }),
    el("label", { for: "o-status", text: "Start as" }), el("select", { id: "o-status" },
      el("option", { value: "pending", text: "Pending: the lead prepares it, nothing public yet" }), el("option", { value: "live", text: "Live: verified now, public page opens" })),
    el("label", { class: "check" }, el("input", { type: "checkbox", id: "o-commit" }), el("span", { text: "I confirmed the five commitments with the lead (named lead and coordinator, volunteers met in person, Rule of Two, not an emergency service, liability coverage or fiscal sponsor)." })),
    el("button", { text: "Create program", onclick: () => act(box, async () => {
      const r = await api("/api/op/programs", "POST", { name: v("o-name"), slug: v("o-slug"), lead_email: v("o-lead"), borough: v("o-borough"),
        org_type: v("o-type"), public_phone: v("o-phone"), status: v("o-status"), commitments_confirmed: document.getElementById("o-commit").checked });
      note(box, true, `Created ${r.slug} (${r.status}) for ${r.lead}. Ask them to open ${location.origin}/c.html and sign in with Google using that address.`); setTimeout(load, 4000); }) }));
}

async function load() {
  const box = el("div", { "aria-live": "polite" });
  try {
    const { programs } = await api("/api/op/programs");
    const real = programs.filter((p) => !p.demo);
    const pending = real.filter((p) => p.status === "pending").length;
    content.replaceChildren(el("section", { class: "card", "aria-labelledby": "oph" }, el("h2", { id: "oph", text: `Program review (${pending} waiting)` }), setupForm(box),
      el("p", { class: "muted", text: "Before approving: confirm the organization exists (website, EIN or sponsor letter), speak with the lead, and check the commitments with them. Every decision is in the audit log." }),
      real.length ? el("div", { class: "scroll" }, el("table", {}, el("tbody", {}, ...real.map((p) => row(p, box))))) : el("p", { class: "muted", text: "No programs." }), box),
      el("p", {}, el("a", { href: "/c.html", text: "Program staff page" })));
  } catch (e) {
    content.replaceChildren(el("p", { class: "result err", role: "alert", text: e.code === "access_required" ? "The operator console opens only through the operator's Cloudflare Access sign-in."
      : e.code === "operator_only" ? "This account is not an operator." : ERR[e.code] || "Error: " + e.message }));
  }
}
document.getElementById("refresh").addEventListener("click", load);
load();
