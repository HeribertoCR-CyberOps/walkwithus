import { STR, lang, setLang, hhmm, el, api } from "./i18n.js";

let L = lang();
const T = () => STR[L];
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

function chrome() {
  document.documentElement.lang = L;
  document.getElementById("tagline").textContent = T().tagline;
  document.getElementById("sos911").textContent = T().danger;
  document.getElementById("sostips").textContent = T().tips;
  document.getElementById("soscrisis").textContent = T().crisis;
  document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === L)));
}

function result(box, ok, ...nodes) {
  box.className = "result " + (ok ? "ok" : "err");
  box.replaceChildren(...nodes);
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
    for (const w of ws) { const k = `${hhmm(w.start_min)}–${hhmm(w.end_min)}`; byDay.set(k, [...(byDay.get(k) || []), T().days[w.dow]]); }
    const times = [...byDay.entries()].map(([t, d]) => `${d.join(", ")} ${t}`).join(" · ");
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
  const fillTimes = () => {
    const cid = Number(cornerSel.value), dow = dowOf(date.value);
    const opts = [];
    for (const w of state.windows.filter((x) => x.corner_id === cid && x.dow === dow))
      for (let m = w.start_min; m < w.end_min; m += 15) opts.push(hhmm(m));
    time.replaceChildren(...(opts.length ? opts.map((t) => el("option", { value: t, text: t }))
      : [el("option", { value: "", text: "—" })]));
  };
  cornerSel.addEventListener("change", fillTimes); date.addEventListener("change", fillTimes); fillTimes();
  const cb = el("input", { type: "tel", id: "w-cb", autocomplete: "tel", inputmode: "tel", required: true });
  const lg = el("select", { id: "w-lang" }, el("option", { value: "en", text: "English" }), el("option", { value: "es", text: "Español" }),
    el("option", { value: "fr", text: "Français" }), el("option", { value: "ak", text: "Twi" }));
  lg.value = L;
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
      const r = await api(`/api/o/${state.org.slug}/walk`, "POST",
        { corner_id: Number(cornerSel.value), date: date.value, time: time.value, callback: cb.value, lang: lg.value, consent: true });
      const del = new Date(r.deletes_at * 1000).toLocaleString(L, { timeZone: "America/New_York" });
      result(box, true, el("p", { text: T().sent }), el("p", { class: "ref", text: r.ref }), el("p", { text: r.meeting_point }),
        el("p", { class: "muted", text: `${T().deletes} ${del}` }), el("p", { text: r.next }));
      form.reset(); date.value = today(); fillTimes();
    } catch (err) { result(box, false, `${T().err} ${err.message}`); }
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
      await api(`/api/o/${state.org.slug}/volunteer`, "POST", { name: name.value, phone: ph.value,
        corners: prefs.filter((p) => p.checked).map((p) => Number(p.value)), briefing_ack: true });
      result(box, true, T().applied); form.reset();
    } catch (err) { result(box, false, `${T().err} ${err.message}`); }
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

async function render() {
  chrome();
  const content = document.getElementById("content");
  const slug = q.get("o");
  try {
    if (!slug) {
      const { orgs } = await api("/api/orgs");
      if (orgs.length === 1) { location.replace(`?o=${encodeURIComponent(orgs[0].slug)}`); return; }
      content.replaceChildren(el("section", { class: "card" }, el("h2", { text: T().pick_org }),
        el("ul", { class: "plain" }, ...orgs.map((o) => el("li", {}, el("a", { href: `?o=${encodeURIComponent(o.slug)}`, text: o.name }),
          o.borough ? el("span", { class: "muted", text: ` — ${o.borough}` }) : null)))));
      return;
    }
    if (!state.org || state.org.slug !== slug) {
      const d = await api(`/api/o/${encodeURIComponent(slug)}`);
      state = { org: d.org, corners: d.corners, windows: d.windows };
    }
    document.getElementById("title").textContent = state.org.name;
    document.title = state.org.name;
    content.replaceChildren(cornersCard(), state.corners.length ? walkCard() : null, volunteerCard(), rightsCard(), privacyCard());
  } catch (err) {
    content.replaceChildren(el("p", { class: "result err", text: `${T().err} ${err.message}` }));
  }
}

document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => { L = b.dataset.lang; setLang(L); render(); }));
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
render();
