// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Savvy Solution Pros LLC. Walk With Us — see NOTICE.
// Shared helpers + language selection. Strings live in strings.js.
import { STR, META, CALL_LANGS } from "./strings.js";
export { STR, META, CALL_LANGS };
export function lang() {
  try { const l = localStorage.getItem("wwu.lang"); if (l && STR[l]) return l; } catch {}
  for (const n of navigator.languages || [navigator.language || "en"]) {
    const base = String(n).toLowerCase().split("-")[0];
    if (STR[base]) return base;
  }
  return "en";
}
/** Translate with English fallback for any missing key (a partial translation never shows a blank). */
export function tr(l) { return new Proxy(STR[l] || STR.en, { get: (t, k) => (k in t && t[k] !== "" ? t[k] : STR.en[k]) }); }
export function setLang(l) { try { localStorage.setItem("wwu.lang", l); } catch {} }
export const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v; else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
export async function api(path, method = "GET", body) {
  const r = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  let d = {}; try { d = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(d.error || ("HTTP " + r.status)); e.code = d.error; e.status = r.status; throw e; }
  Object.defineProperty(d, "_cache", { value: r.headers.get("x-cache"), enumerable: false });
  return d;
}
