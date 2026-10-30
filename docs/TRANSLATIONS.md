# Translations

The family page is available in English plus the ten **NYC Local Law 30 designated citywide languages**. Coordinators can also note that a callback should happen in **Twi, Wolof or Pulaar/Fula** (with an interpreter if needed), languages spoken by many West African families in the Bronx.

| Code | Language | Direction | Status | Reviewer | Date |
|---|---|---|---|---|---|
| en | English | LTR | authoritative | — | 2026-10-30 |
| es | Español | LTR | machine-drafted — **needs native review** | | |
| zh | 中文 (Simplified) | LTR | machine-drafted — **needs native review** (consider adding Traditional) | | |
| ru | Русский | LTR | machine-drafted — **needs native review** | | |
| bn | বাংলা | LTR | machine-drafted — **needs native review** | | |
| ht | Kreyòl ayisyen | LTR | machine-drafted — **needs native review** | | |
| ko | 한국어 | LTR | machine-drafted — **needs native review** | | |
| ar | العربية | **RTL** | machine-drafted — **needs native review** | | |
| ur | اردو | **RTL** | machine-drafted — **needs native review** | | |
| fr | Français | LTR | machine-drafted — **needs native review** | | |
| pl | Polski | LTR | machine-drafted — **needs native review** | | |

Until a language is marked `reviewed: true` in `public/js/strings.js`, the page shows a one-line notice in that language saying the translation is awaiting review. Any missing string falls back to English, never to a blank.

## Review process
1. A fluent speaker (ideally from the community the program serves) reads every string in context on a phone.
2. Safety-critical lines get extra care: the 911 button, the five volunteer rules, the consent sentence, the rights section.
3. The reviewer's corrections are committed, `reviewed: true` is set, and this table is updated with name/initials and date.
4. Regulation numbers (A-449, A-832) and phone numbers are never translated.

Structural checks (every language has every key; list lengths match English) run with:
```bash
node -e 'import("./public/js/strings.js").then(m=>{const en=Object.keys(m.STR.en);for(const[l,t]of Object.entries(m.STR)){const miss=en.filter(k=>!(k in t));if(miss.length)throw new Error(l+": "+miss)}console.log("ok")})'
```
