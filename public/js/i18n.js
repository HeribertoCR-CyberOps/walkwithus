// UI strings. EN is authoritative; ES drafted — must be reviewed by a native speaker before launch (see docs/LAUNCH.md).
export const STR = {
  en: {
    tagline: "Adults on corners so kids get to school and home safely. Free. Run by your community.",
    danger: "Danger now? Call 911",
    tips: "Anonymous tip: 1-800-577-TIPS",
    crisis: "Crisis line: 988",
    corners_h: "Where adults stand, and when",
    corners_p: "These are the published times trained adult volunteers cover. Volunteers wear the org's vest or badge.",
    no_corners: "No corners published yet.",
    open_map: "Open in map",
    walk_h: "Ask two adults to walk with you",
    walk_p: "Pick a corner and a time inside the hours above. A coordinator calls you back to confirm two adults. We never ask for a child's name and never track anyone's location.",
    corner: "Meeting corner", date: "Date", time: "Time", callback: "Callback phone (parent or student)",
    language: "Language for the call", consent: "I understand: this number is stored encrypted, seen only by the coordinator, and deleted automatically after the walk.",
    send: "Send request", sent: "Request received. Your reference code:", deletes: "This request deletes itself on",
    vol_h: "Volunteer as an adult on a corner",
    vol_p: "Volunteers are met in person and approved by the organization before their first shift.",
    name: "Your name", phone: "Your phone", prefer: "Corners you could cover",
    rules_h: "The rules every volunteer agrees to",
    rules: ["Always at least two adults. Never alone with a student.", "Observe and report. Never chase, confront or detain anyone.",
      "Danger: call 911 first, then the coordinator.", "Never photograph students or post about them.", "Never share where a student lives or walks."],
    rules_ack: "I agree to these rules.", apply: "Apply",
    applied: "Thank you. A coordinator will contact you to meet in person.",
    rights_h: "Know your rights (NYC public schools)",
    rights: [
      ["Safety transfer", "If your child is unsafe at school, you can request a safety transfer (Chancellor's Regulation A-449). Ask the principal in writing; keep a copy."],
      ["Bullying complaint", "Report bullying or harassment under Chancellor's Regulation A-832. The school must investigate and follow up with you."],
      ["Free help", "Advocates for Children of New York helps families with school safety and transfers."]],
    privacy_h: "What we store — and what we never store",
    privacy: ["Never: a child's name, school records, photos, or anyone's live location.",
      "Walk requests: meeting corner, time slot, and an encrypted callback number — deleted automatically.",
      "Volunteers: name and phone, encrypted, seen only by coordinators.", "Every coordinator action is recorded in a tamper-evident log."],
    pick_org: "Choose your neighborhood program", err: "Something went wrong:", required: "Please complete the highlighted fields.",
    days: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  },
  es: {
    tagline: "Adultos en las esquinas para que los niños lleguen seguros a la escuela y a casa. Gratis. Dirigido por su comunidad.",
    danger: "¿Peligro ahora? Llame al 911",
    tips: "Denuncia anónima: 1-800-577-TIPS",
    crisis: "Línea de crisis: 988",
    corners_h: "Dónde y cuándo hay adultos",
    corners_p: "Estos son los horarios publicados en que voluntarios adultos capacitados cubren cada esquina. Llevan el chaleco o la identificación de la organización.",
    no_corners: "Aún no hay esquinas publicadas.",
    open_map: "Abrir en el mapa",
    walk_h: "Pida que dos adultos caminen con usted",
    walk_p: "Elija una esquina y una hora dentro del horario publicado. Un coordinador le devolverá la llamada para confirmar a dos adultos. Nunca pedimos el nombre de un niño ni rastreamos la ubicación de nadie.",
    corner: "Esquina de encuentro", date: "Fecha", time: "Hora", callback: "Teléfono para devolver la llamada (padre o estudiante)",
    language: "Idioma de la llamada", consent: "Entiendo: este número se guarda cifrado, solo lo ve el coordinador y se borra automáticamente después de la caminata.",
    send: "Enviar solicitud", sent: "Solicitud recibida. Su código de referencia:", deletes: "Esta solicitud se borra sola el",
    vol_h: "Sea voluntario adulto en una esquina",
    vol_p: "La organización se reúne en persona con cada voluntario y lo aprueba antes de su primer turno.",
    name: "Su nombre", phone: "Su teléfono", prefer: "Esquinas que podría cubrir",
    rules_h: "Las reglas que acepta cada voluntario",
    rules: ["Siempre al menos dos adultos. Nunca a solas con un estudiante.", "Observar e informar. Nunca perseguir, confrontar ni detener a nadie.",
      "Peligro: primero llame al 911, luego al coordinador.", "Nunca fotografíe a estudiantes ni publique sobre ellos.", "Nunca comparta dónde vive o camina un estudiante."],
    rules_ack: "Acepto estas reglas.", apply: "Enviar",
    applied: "Gracias. Un coordinador se comunicará con usted para reunirse en persona.",
    rights_h: "Conozca sus derechos (escuelas públicas de NYC)",
    rights: [
      ["Traslado por seguridad", "Si su hijo no está seguro en la escuela, puede solicitar un traslado por seguridad (Reglamento del Canciller A-449). Pídalo por escrito al director y guarde una copia."],
      ["Denuncia de acoso", "Denuncie el acoso escolar según el Reglamento del Canciller A-832. La escuela debe investigar y darle seguimiento."],
      ["Ayuda gratuita", "Advocates for Children of New York ayuda a las familias con la seguridad escolar y los traslados."]],
    privacy_h: "Lo que guardamos y lo que nunca guardamos",
    privacy: ["Nunca: el nombre de un niño, expedientes escolares, fotos ni la ubicación en vivo de nadie.",
      "Solicitudes: esquina, horario y un número cifrado, que se borran automáticamente.",
      "Voluntarios: nombre y teléfono cifrados, que solo ven los coordinadores.", "Cada acción de un coordinador queda en un registro a prueba de alteraciones."],
    pick_org: "Elija el programa de su vecindario", err: "Algo salió mal:", required: "Complete los campos marcados.",
    days: ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"],
  },
};
export function lang() {
  try { const l = localStorage.getItem("wwu.lang"); if (l && STR[l]) return l; } catch {}
  return (navigator.language || "en").toLowerCase().startsWith("es") ? "es" : "en";
}
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
  if (!r.ok) throw new Error(d.error || ("HTTP " + r.status));
  return d;
}
