import { el, api } from "./i18n.js";

// The capability token arrives in the URL fragment (#t=...), which browsers never send to servers.
// Keep it on this device only, then strip it from the address bar.
function token() {
  const m = /[#&]t=([A-Za-z0-9_-]{43})/.exec(location.hash);
  if (m) {
    try { localStorage.setItem("wwu.vtoken", m[1]); } catch {}
    history.replaceState(null, "", location.pathname);
    return m[1];
  }
  try { return localStorage.getItem("wwu.vtoken"); } catch { return null; }
}

const fmt = (s) => new Date(s * 1000).toLocaleString(undefined, { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit" });

async function render() {
  const c = document.getElementById("content");
  const t = token();
  if (!t) { c.replaceChildren(el("p", { class: "result err", text: "No check-in link on this device. Ask your coordinator for yours." })); return; }
  let me;
  try { me = await api("/api/v/me", "POST", { token: t }); }
  catch (e) { c.replaceChildren(el("p", { class: "result err", text: "This link isn't active (" + e.message + "). Ask your coordinator." })); return; }
  const box = el("div", { "aria-live": "polite" });
  const say = (ok, msg) => { box.className = "result " + (ok ? "ok" : "err"); box.textContent = msg; };
  const parts = [el("h2", { text: `Hi ${me.first_name}` })];
  if (me.shift) {
    parts.push(el("p", {}, "On shift at ", el("strong", { text: me.shift.label }), ` since ${fmt(me.shift.checkin_at)}.`),
      el("button", { class: "secondary", onclick: async (e) => { e.target.disabled = true;
        try { await api("/api/v/checkout", "POST", { token: t }); render(); } catch (err) { say(false, err.message); e.target.disabled = false; } },
        text: "Check out" }));
  } else {
    const sel = el("select", { id: "corner" }, ...me.corners.map((x) => el("option", { value: x.id, text: x.label })));
    parts.push(el("label", { for: "corner", text: "I'm at" }), sel,
      el("button", { onclick: async (e) => { e.target.disabled = true;
        try { const r = await api("/api/v/checkin", "POST", { token: t, corner_id: Number(sel.value) }); say(true, `Checked in at ${r.corner}.`); setTimeout(render, 800); }
        catch (err) { say(false, err.message); e.target.disabled = false; } }, text: "Check in" }));
  }
  parts.push(box);
  const walks = el("section", { class: "card" }, el("h2", { text: "Your walks" }),
    me.walks.length ? el("ul", { class: "plain" }, ...me.walks.map((w) =>
      el("li", {}, el("strong", { text: fmt(w.slot_start) }), ` — ${w.meeting_point} `, el("span", { class: "badge", text: "ref " + w.ref }))))
      : el("p", { class: "muted", text: "None assigned. Your coordinator assigns walks to two adults at a time." }));
  c.replaceChildren(el("section", { class: "card" }, ...parts), walks);
}
render();
