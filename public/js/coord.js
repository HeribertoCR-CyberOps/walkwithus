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
async function act(box, fn) { try { await fn(); } catch (e) { note(box, false, "Error: " + e.message); } }

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
  const approved = D.volunteers.filter((v) => v.status === "approved");
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
      el("td", {}, el("strong", { text: v.name }), el("div", { class: "muted", text: v.phone_masked }),
        onShift ? el("span", { class: "badge ok", text: "on shift" }) : null),
      el("td", {}, el("span", { class: "badge " + (v.status === "approved" ? "ok" : "warn"), text: v.status })),
      el("td", {}, el("div", { class: "row" },
        el("button", { class: "secondary", text: "Phone", onclick: () => act(box, async () => { const r = await api(base + "/reveal", "POST", {});
          note(box, true, el("a", { href: "tel:" + r.phone, text: r.phone }), el("small", { class: "muted", text: " (logged)" })); }) }),
        el("button", { text: v.status === "approved" ? "New link" : "Approve (met in person)", onclick: () => act(box, async () => {
          if (v.status !== "approved" && !confirm(`Approve ${v.name}? Only approve someone you have met in person and briefed.`)) return;
          const r = await api(base + "/approve", "POST", {});
          note(box, true, el("div", { text: "Check-in link (shown once — give it in person or by Signal):" }), el("div", { class: "mono", text: r.checkin_link }),
            el("button", { class: "secondary", text: "Copy", onclick: async () => { try { await navigator.clipboard.writeText(r.checkin_link); } catch {} } }));
        }) }),
        el("button", { class: "danger", text: "Suspend", onclick: () => act(box, async () => { if (!confirm(`Suspend ${v.name}? Their link stops working immediately.`)) return; await api(base + "/suspend", "POST", {}); load(); }) })),
        box));
  });
  return el("section", { class: "card" }, el("h2", { text: `Volunteers (${D.volunteers.length})` }),
    el("div", { class: "scroll" }, el("table", {}, el("tbody", {}, ...rows))));
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
    el("details", {}, el("summary", { text: "Add a coverage window" }),
      el("label", { for: "w-c", text: "Corner" }), el("select", { id: "w-c" }, ...D.corners.map((c) => el("option", { value: c.id, text: c.label }))),
      el("label", { for: "w-d", text: "Day" }), el("select", { id: "w-d" }, ...days.map((d, i) => el("option", { value: i, text: d }))),
      el("div", { class: "grid2" }, el("div", {}, ...f("w-s", "Start (HH:MM, 15-min)", { value: "07:30" })), el("div", {}, ...f("w-e", "End", { value: "08:45" }))),
      el("button", { text: "Add window", onclick: () => act(box, async () => { await api(`/api/c/${slug}/windows`, "POST", { corner_id: Number(v("w-c")), dow: Number(v("w-d")), start: v("w-s"), end: v("w-e") }); note(box, true, "Window added."); }) })),
    el("details", {}, el("summary", { text: "Add a coordinator" }), ...f("k-email", "Email (must be allowed by Cloudflare Access)", { type: "email" }),
      el("label", { class: "check" }, el("input", { type: "checkbox", id: "k-admin" }), el("span", { text: "Admin" })),
      el("button", { text: "Save", onclick: () => act(box, async () => { await api(`/api/c/${slug}/coordinators`, "POST", { email: v("k-email"), role: document.getElementById("k-admin").checked ? "admin" : "coordinator" }); note(box, true, "Saved."); }) })),
    el("div", { class: "row" }, el("button", { class: "secondary", text: "Verify audit log", onclick: () => act(box, async () => { const r = await api(`/api/c/${slug}/audit/verify`, "POST", {});
      note(box, r.ok, `Audit chain ${r.ok ? "intact" : "BROKEN at " + r.broken_at} — ${r.entries} entries`); }) })), box);
}

async function load() {
  try {
    if (!slug) {
      const me = await api("/api/c/me");
      document.getElementById("who").textContent = me.email;
      if (me.orgs.length === 1 && SLUG.test(me.orgs[0].slug)) slug = me.orgs[0].slug;
      else { content.replaceChildren(el("section", { class: "card" }, el("h2", { text: "Your programs" }),
        el("ul", { class: "plain" }, ...me.orgs.map((o) => el("li", {}, el("a", { href: `?o=${encodeURIComponent(o.slug)}`, text: `${o.name} (${o.role})` })))))); return; }
    }
    D = await api(`/api/c/${slug}/dashboard`);
    document.getElementById("who").textContent = `${D.you.email} · ${D.you.role} · ${D.org.name}`;
    content.replaceChildren(...[cornersSection(), walksSection(), volunteersSection(), adminSection()].filter(Boolean));
  } catch (e) {
    content.replaceChildren(el("p", { class: "result err", text: e.message === "access_required" ? "Sign in through your organization's Cloudflare Access link." : e.message === "not_a_coordinator_for_org" ? "Your account is not a coordinator for this program." : "Error: " + e.message }));
  }
}
document.getElementById("refresh").addEventListener("click", load);
load(); setInterval(load, 60000);
