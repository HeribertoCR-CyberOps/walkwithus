import { META, CALL_LANGS, lang, setLang, tr, hhmm, el, api } from "./i18n.js";

let L = lang();
const T = () => tr(L);
const errText = (err) => (err.code && T().errors[err.code]) || (err.message === "Failed to fetch" ? T().offline : `${T().err} ${err.message}`);
const q = new URLSearchParams(location.search);
let state = { org: null, corners: [], windows: [] };

function today(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d); // YYYY-MM-DD
}
function dowOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// Unicode first-strong isolates keep phone numbers, times and codes left-to-right inside Arabic/Urdu text.
const iso = (s) => "\u2068" + s + "\u2069";
const NUM = /[0-9][0-9A-Z:–\-]*[0-9A-Z]/g;
// Same isolation, but each number becomes a no-wrap span so "1-800-577-TIPS" never breaks across lines. Callers wrap the
// result in one inline span: the buttons are flex containers, which would otherwise drop the space before the number.
const numNodes = (s) => { const out = []; let i = 0;
  for (const m of s.matchAll(NUM)) { out.push(s.slice(i, m.index), el("span", { class: "nowrap", text: "\u2066" + m[0] + "\u2069" })); i = m.index + m[0].length; }
  out.push(s.slice(i)); return out.filter((x) => x !== ""); };
const fmtList = (items) => { try { return new Intl.ListFormat(L, { style: "narrow", type: "unit" }).format(items); } catch { return items.join(", "); } };

function chrome() {
  document.documentElement.lang = L;
  document.documentElement.dir = META[L].dir;
  const sel = document.getElementById("langsel");
  if (sel && !sel.options.length) {
    for (const [code, m] of Object.entries(META)) sel.append(el("option", { value: code, text: m.name }));
    sel.addEventListener("change", () => { L = sel.value; setLang(L); render(); });
  }
  if (sel) { sel.value = L; sel.setAttribute("aria-label", T().lang_label); }
  const d = document.getElementById("draftnote");
  if (d) { d.textContent = META[L].reviewed ? "" : T().draft; d.hidden = META[L].reviewed; }
  const off = document.getElementById("offline");
  if (off) { off.textContent = T().offline; off.hidden = navigator.onLine; }
  document.getElementById("tagline").textContent = T().tagline;
  document.getElementById("sos911").replaceChildren(el("span", {}, ...numNodes(T().danger)));
  document.getElementById("sostips").replaceChildren(el("span", {}, ...numNodes(T().tips)));
  document.getElementById("soscrisis").replaceChildren(el("span", {}, ...numNodes(T().crisis)));
}

function result(box, ok, ...nodes) {
  box.className = "result " + (ok ? "ok" : "err");
  box.replaceChildren(...nodes.filter((n) => n != null && n !== false));
  box.focus?.();
}

function cornersCard() {
  const card = el("section", { class: "card", "aria-labelledby": "ch" }, el("h2", { id: "ch", text: T().corners_h }),
    el("p", { class: "muted", text: T().corners_p }));
  if (!state.corners.length) { card.append(el("p", { text: T().no_corners })); return card; }
  const list = el("ul", { class: "plain" });
  for (const c of state.corners) {
    const ws = state.windows.filter((w) => w.corner_id === c.id);
    const byDay = new Map();
    for (const w of ws) { const k = "\u2066" + `${hhmm(w.start_min)}–${hhmm(w.end_min)}` + "\u2069"; byDay.set(k, [...(byDay.get(k) || []), T().days[w.dow]]); }
    const times = [...byDay.entries()].map(([t, d]) => `${fmtList(d)} ${t}`).join(" · ");
    const map = `https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=18/${c.lat}/${c.lon}`;
    list.append(el("li", { class: "corner" }, el("strong", { text: c.label }), el("div", { class: "muted", text: c.cross_streets }),
      el("div", { text: times || "—" }), el("a", { href: map, target: "_blank", rel: "noopener noreferrer", text: T().open_map })));
  }
  card.append(list);
  return card;
}

function walkCard() {
  const box = el("div", { tabindex: "-1", "aria-live": "polite" });
  const cornerSel = el("select", { id: "w-corner", required: true }, ...state.corners.map((c) => el("option", { value: c.id, text: c.label })));
  const date = el("input", { type: "date", id: "w-date", min: today(), max: today(14), value: today(), required: true });
  const time = el("select", { id: "w-time", required: true });
  // Open 15-minute slots for a corner on a date; today only offers slots that have not passed yet (NY time).
  const slotsFor = (cid, dateStr) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date()).map((x) => [x.type, x.value]));
    const nowMin = dateStr === today() ? +p.hour * 60 + +p.minute : -1, dow = dowOf(dateStr), opts = [];
    for (const w of state.windows.filter((x) => x.corner_id === cid && x.dow === dow))
      for (let m = w.start_min; m < w.end_min; m += 15) if (m >= nowMin) opts.push(hhmm(m));
    return opts;
  };
  // If the chosen day has nothing left (e.g. after school hours), move to the next day that does, within the 14-day window.
  const nextOpenDate = (cid) => { for (let d = 0; d <= 14; d++) if (slotsFor(cid, today(d)).length) return today(d); return null; };
  const fillTimes = (advance) => {
    const cid = Number(cornerSel.value);
    if (advance && !slotsFor(cid, date.value).length) { const n = nextOpenDate(cid); if (n) date.value = n; }
    const opts = slotsFor(cid, date.value);
    time.replaceChildren(...(opts.length ? opts.map((t) => el("option", { value: t, text: t }))
      : [el("option", { value: "", text: T().no_times })]));
  };
  cornerSel.addEventListener("change", () => fillTimes(true)); date.addEventListener("change", () => fillTimes(false)); fillTimes(true);
  const cb = el("input", { type: "tel", id: "w-cb", autocomplete: "tel", inputmode: "tel", required: true });
  const lg = el("select", { id: "w-lang" }, ...CALL_LANGS.map(([v, n]) => el("option", { value: v, text: n })));
  lg.value = CALL_LANGS.some(([v]) => v === L) ? L : "en";
  const consent = el("input", { type: "checkbox", id: "w-consent", required: true });
  const btn = el("button", { type: "submit", text: T().send });
  const form = el("form", { novalidate: true },
    el("label", { for: "w-corner", text: T().corner }), cornerSel,
    el("div", { class: "grid2" }, el("div", {}, el("label", { for: "w-date", text: T().date }), date),
      el("div", {}, el("label", { for: "w-time", text: T().time }), time)),
    el("label", { for: "w-cb", text: T().callback }), cb,
    el("label", { for: "w-lang", text: T().language }), lg,
    el("label", { class: "check" }, consent, el("span", { text: T().consent })), btn, box);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.checkValidity() || !time.value) { result(box, false, T().required); return; }
    btn.disabled = true;
    try {
      const r = await api(`/api/o/${encodeURIComponent(state.org.slug)}/walk`, "POST",
        { corner_id: Number(cornerSel.value), date: date.value, time: time.value, callback: cb.value, lang: lg.value, consent: true });
      const del = new Date(r.deletes_at * 1000).toLocaleString(L, { timeZone: "America/New_York" });
      result(box, true, el("p", { text: T().sent }), el("p", { class: "ref", dir: "ltr", text: r.ref }), el("p", { text: r.meeting_point }),
        el("p", { class: "muted", text: `${T().deletes} ${del}` }), el("p", { text: T().next }));
      form.reset(); date.value = today(); fillTimes(true);
    } catch (err) {
      // Server or network failure (not a validation error): give the family a human fallback right away.
      const down = !err.status || err.status >= 500 || err.status === 429;
      const ph = state.org && state.org.public_phone;
      result(box, false, errText(err), down && ph ? el("p", {}, el("a", { href: "tel:" + ph.replace(/[^\d+]/g, ""), text: ph })) : null,
        down ? el("p", {}, el("a", { href: "tel:911", text: T().danger })) : null);
    }
    btn.disabled = false;
  });
  return el("section", { class: "card", "aria-labelledby": "wh" }, el("h2", { id: "wh", text: T().walk_h }),
    el("p", { class: "muted", text: T().walk_p }), form);
}

function volunteerCard() {
  const box = el("div", { tabindex: "-1", "aria-live": "polite" });
  const name = el("input", { type: "text", id: "v-name", autocomplete: "name", required: true, maxlength: "80" });
  const ph = el("input", { type: "tel", id: "v-phone", autocomplete: "tel", inputmode: "tel", required: true });
  const prefs = state.corners.map((c) => el("input", { type: "checkbox", value: c.id }));
  const ack = el("input", { type: "checkbox", id: "v-ack", required: true });
  const btn = el("button", { type: "submit", text: T().apply });
  const form = el("form", { novalidate: true },
    el("label", { for: "v-name", text: T().name }), name, el("label", { for: "v-phone", text: T().phone }), ph,
    el("fieldset", { class: "card" }, el("legend", { text: T().prefer }),
      ...state.corners.map((c, i) => el("label", { class: "check" }, prefs[i], el("span", { text: c.label })))),
    el("h3", { text: T().rules_h }), el("ol", {}, ...T().rules.map((r) => el("li", { text: r }))),
    el("label", { class: "check" }, ack, el("span", { text: T().rules_ack })), btn, box);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) { result(box, false, T().required); return; }
    btn.disabled = true;
    try {
      await api(`/api/o/${encodeURIComponent(state.org.slug)}/volunteer`, "POST", { name: name.value, phone: ph.value,
        corners: prefs.filter((p) => p.checked).map((p) => Number(p.value)), briefing_ack: true });
      result(box, true, T().applied); form.reset();
    } catch (err) { result(box, false, errText(err)); }
    btn.disabled = false;
  });
  return el("section", { class: "card", "aria-labelledby": "vh" }, el("h2", { id: "vh", text: T().vol_h }),
    el("p", { class: "muted", text: T().vol_p }), form);
}

function rightsCard() {
  const links = ["https://www.schools.nyc.gov/school-life/policies-for-all/chancellors-regulations",
    "https://www.schools.nyc.gov/school-life/policies-for-all/chancellors-regulations", "https://advocatesforchildren.org/"];
  return el("section", { class: "card" }, el("h2", { text: T().rights_h }),
    el("ul", { class: "plain" }, ...T().rights.map(([h, p], i) => el("li", {}, el("strong", { text: h }), el("p", { text: p }),
      el("a", { href: links[i], target: "_blank", rel: "noopener noreferrer", text: new URL(links[i]).hostname })))));
}

function privacyCard() {
  return el("section", { class: "card" }, el("h2", { text: T().privacy_h }),
    el("ul", {}, ...T().privacy.map((p) => el("li", { text: p }))));
}

function home(real, demo) {
  const mail = "heriberto@savvysolutionpros.com";
  return el("div", { class: "stack" },
    el("section", { class: "card", "aria-labelledby": "hh" }, el("h2", { id: "hh", text: T().home_h }), el("p", { text: T().home_p }),
      real.length
        ? el("div", {}, el("h3", { text: T().pick_org }), el("ul", { class: "plain" }, ...real.map((o) => el("li", {},
            el("a", { href: `?o=${encodeURIComponent(o.slug)}`, text: o.name }), o.borough ? el("span", { class: "muted", text: ` — ${o.borough}` }) : null))))
        : el("p", { class: "result err", role: "status", text: T().home_none }),
      demo ? el("p", {}, el("a", { href: "?o=demo", text: T().home_demo })) : null),
    el("section", { class: "card", "aria-labelledby": "ho" }, el("h2", { id: "ho", text: T().home_org_h }), el("p", { text: T().home_org_p }),
      el("p", {}, el("a", { href: `mailto:${mail}?subject=Walk%20With%20Us`, dir: "ltr", text: mail }))));
}

async function render() {
  chrome();
  const content = document.getElementById("content");
  const raw = q.get("o");
  const slug = raw && /^[a-z0-9-]{3,40}$/.test(raw) ? raw : null; // same rule as the server; never put raw input in a URL path
  try {
    if (!slug) {
      const { orgs } = await api("/api/orgs");
      // The demo is never a destination on its own: a family landing here must not mistake made-up corners for a real program.
      const real = orgs.filter((o) => o.slug !== "demo"), demo = orgs.some((o) => o.slug === "demo");
      if (real.length === 1) { location.replace(`?o=${encodeURIComponent(real[0].slug)}`); return; }
      content.replaceChildren(home(real, demo), rightsCard(), privacyCard());
      return;
    }
    if (!state.org || state.org.slug !== slug) {
      const d = await api(`/api/o/${encodeURIComponent(slug)}`);
      state = { org: d.org, corners: d.corners, windows: d.windows, stale: d._cache === "stale" };
    }
    document.getElementById("title").textContent = state.org.name;
    document.title = state.org.name;
    content.replaceChildren(...[state.stale ? el("p", { class: "result err", text: T().stale }) : null,
      cornersCard(), state.corners.length ? walkCard() : null, volunteerCard(), rightsCard(), privacyCard()].filter(Boolean));
  } catch (err) {
    content.replaceChildren(el("p", { class: "result err", text: errText(err) }));
  }
}

addEventListener("online", chrome); addEventListener("offline", chrome);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
render();
