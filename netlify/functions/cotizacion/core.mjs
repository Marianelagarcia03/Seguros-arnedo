// Formulario «Pedí tu cotización»: validación del lado del servidor, armado del
// correo con el detalle completo y del resumen sin datos sensibles (para WhatsApp
// y para la confirmación al cliente). Sin dependencias externas.

import { createHash } from "node:crypto";

const DEFAULT_TO = "juanmanuelarnedo@gmail.com";
const DEFAULT_FROM = '"Web SegurosArnedo.com" <onboarding@resend.dev>';
const TZ = "America/Argentina/Cordoba";
const MAX_BODY = 64 * 1024;
const MAX_VIAJEROS = 10;

export const TIPOS = {
  auto: "Seguro de auto",
  hogar: "Seguro de hogar",
  ap: "Accidentes personales",
  viajero: "Asistencia al viajero",
  otro: "Otro seguro",
};
const OTROS = { moto: "Seguro de moto", vida: "Seguro de vida", retiro: "Seguro de retiro", comercio: "Integral de comercio", caucion: "Seguro de caución", agro: "Seguro agropecuario", art: "ART", otro: "Otro" };
const PAGO = { tarjeta: "Tarjeta de crédito", cbu: "Débito por CBU" };
const COBERTURAS = ["Responsabilidad civil", "Terceros", "Terceros completo", "Todo riesgo", "No lo sé"];

/* ---------- Utilidades ---------- */
const digits = (v) => String(v ?? "").replace(/\D/g, "");
const normPlate = (v) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const todayAR = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const isISODate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));
const dmy = (iso) => (isISODate(iso) ? iso.split("-").reverse().join("/") : iso);
const siNo = (v) => (v === "si" ? "Sí" : v === "no" ? "No" : "");
const clean = (v) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : typeof v === "number" ? String(v) : "");

function check(type, v) {
  const d = digits(v);
  if (!v) return "Completá este campo.";
  if (type === "dni" && !/^\d{7,8}$/.test(d)) return "Ingresá un DNI válido (7 u 8 números).";
  if (type === "dnicuit" && !(/^\d{7,8}$/.test(d) || /^\d{11}$/.test(d))) return "Ingresá un DNI (7 u 8 números) o un CUIT (11 números).";
  if (type === "phone" && d.length < 8) return "Ingresá un teléfono válido, con código de área.";
  if (type === "plate" && !/^[A-Z0-9]{5,8}$/.test(normPlate(v))) return "Ingresá una patente válida.";
  if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return "Revisá el correo electrónico.";
  if (type === "int" && !(/^\d{1,6}$/.test(v.replace(/\./g, "")) && parseInt(v.replace(/\./g, ""), 10) >= 1)) return "Ingresá un número mayor que cero.";
  return "";
}
function ageFrom(iso) {
  if (!isISODate(iso)) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const [ty, tm, td] = todayAR().split("-").map(Number);
  let a = ty - y;
  if (tm < m || (tm === m && td < d)) a--;
  return a >= 0 ? String(a) : "";
}

/* ---------- Validación ---------- */
export function validate(body) {
  const errors = {};
  const d = { tipo: clean(body.tipo) };
  const need = (key, type = null, max = 200, optional = false) => {
    const v = clean(body[key]);
    let err = !v && optional ? "" : check(type, v);
    if (!err && v.length > max) err = `Máximo ${max} caracteres.`;
    if (err) errors[key] = err;
    d[key] = type === "plate" ? normPlate(v) : v;
  };
  const pick = (key, options) => {
    d[key] = clean(body[key]);
    if (!options.includes(d[key])) errors[key] = "Elegí una opción.";
  };

  if (!TIPOS[d.tipo]) {
    errors.tipo = "Elegí qué seguro querés cotizar.";
    return { ok: false, errors, data: d };
  }

  if (d.tipo === "auto") {
    need("auto_nombre", null, 120);
    need("auto_dni", "dni", 12);
    need("auto_domicilio", null, 160);
    need("auto_localidad", null, 80);
    need("auto_marca", null, 40);
    need("auto_modelo", null, 80);
    need("auto_patente", "plate", 10);
    pick("auto_gnc", ["si", "no"]);
    pick("auto_pago", ["tarjeta", "cbu"]);
    pick("auto_tiene_seguro", ["si", "no"]);
    if (d.auto_tiene_seguro === "si") {
      need("auto_cia_actual", null, 80);
      pick("auto_cobertura_actual", COBERTURAS);
      need("auto_cuota_actual", null, 20, true);
    }
    pick("auto_siniestro", ["si", "no"]);
  } else if (d.tipo === "hogar") {
    need("hogar_nombre", null, 120);
    need("hogar_doc", "dnicuit", 14);
    need("hogar_domicilio", null, 160);
    need("hogar_localidad", null, 80);
    pick("hogar_tipo", ["casa", "departamento"]);
    need("hogar_m2", "int", 6);
    d.hogar_basica = clean(body.hogar_basica) === "si" ? "si" : "";
    if (!d.hogar_basica) need("hogar_cubrir", null, 1500);
  } else if (d.tipo === "ap") {
    need("ap_doc", "dnicuit", 14);
    need("ap_nombre", null, 120);
    need("ap_actividad", null, 200);
    need("ap_cantidad", "int", 6);
    need("ap_suma", null, 40, true);
    need("ap_dias", "int", 6);
  } else if (d.tipo === "viajero") {
    need("viaje_destino", null, 120);
    need("viaje_salida", null, 10);
    need("viaje_regreso", null, 10);
    if (!errors.viaje_salida && (!isISODate(d.viaje_salida) || d.viaje_salida < todayAR())) errors.viaje_salida = "La fecha de salida no puede ser anterior a hoy.";
    if (!errors.viaje_regreso && (!isISODate(d.viaje_regreso) || (isISODate(d.viaje_salida) && d.viaje_regreso < d.viaje_salida))) errors.viaje_regreso = "La fecha de regreso tiene que ser igual o posterior a la de salida.";
    const list = Array.isArray(body.viajeros) ? body.viajeros : [];
    if (list.length < 1 || list.length > MAX_VIAJEROS) errors.viaje_cantidad = `Indicá entre 1 y ${MAX_VIAJEROS} viajeros.`;
    d.viajeros = list.slice(0, MAX_VIAJEROS).map((v, i) => {
      const k = `viajero${i + 1}_`;
      const o = { nombre: clean(v && v.nombre), dni: clean(v && v.dni), domicilio: clean(v && v.domicilio), nacimiento: clean(v && v.nacimiento), edad: clean(v && v.edad) };
      for (const [f, t, max] of [["nombre", null, 120], ["dni", "dni", 12], ["domicilio", null, 160]]) {
        let e = check(t, o[f]);
        if (!e && o[f].length > max) e = `Máximo ${max} caracteres.`;
        if (e) errors[k + f] = e;
      }
      if (o.nacimiento && o.edad) o.edad = "";
      if (o.nacimiento) {
        if (!isISODate(o.nacimiento) || o.nacimiento > todayAR() || o.nacimiento < "1900-01-01") errors[k + "nacimiento"] = "Revisá la fecha de nacimiento.";
      } else if (o.edad) {
        if (!/^\d{1,3}$/.test(o.edad) || +o.edad > 120) errors[k + "edad"] = "Ingresá una edad válida.";
      } else {
        errors[k + "dato"] = "Indicá la fecha de nacimiento o la edad.";
      }
      return o;
    });
  } else if (d.tipo === "otro") {
    pick("otro_tipo", Object.keys(OTROS));
    need("otro_nombre", null, 120);
    need("otro_detalle", null, 2000);
  }

  need("telefono", "phone", 30);
  need("email", "email", 120, true);

  return { ok: Object.keys(errors).length === 0, errors, data: d };
}

/* ---------- Texto de la solicitud ----------
   completo = true  → correo para JMA (incluye DNI, CUIT, domicilios y fechas de nacimiento)
   completo = false → resumen para WhatsApp y para el cliente (sin esos datos) */
export function buildText(d, ref, completo) {
  const L = [`Nueva cotización · ${TIPOS[d.tipo]}`];
  if (ref) L.push(`Solicitud ${ref}`);
  const sec = (title, rows) => {
    const lines = rows.filter(([, v, sensible]) => v !== undefined && v !== "" && (completo || !sensible));
    if (!lines.length) return;
    L.push("", title);
    for (const [label, v] of lines) L.push(`${label}: ${v}`);
  };
  if (d.tipo === "auto") {
    sec("Datos personales", [["Nombre y apellido", d.auto_nombre], ["DNI", d.auto_dni, 1], ["Domicilio", d.auto_domicilio, 1], ["Localidad", d.auto_localidad]]);
    sec("Datos del vehículo", [["Marca", d.auto_marca], ["Modelo", d.auto_modelo], ["Patente", d.auto_patente], ["¿Tiene GNC?", siNo(d.auto_gnc)]]);
    const rows = [["Forma de pago preferida", PAGO[d.auto_pago]], ["¿Actualmente tiene seguro?", siNo(d.auto_tiene_seguro)]];
    if (d.auto_tiene_seguro === "si") rows.push(["Compañía actual", d.auto_cia_actual], ["Tipo de cobertura actual", d.auto_cobertura_actual], ["Cuota actual", d.auto_cuota_actual ? `$ ${d.auto_cuota_actual}` : ""]);
    rows.push(["¿Siniestro en los últimos 15 días?", siNo(d.auto_siniestro)]);
    sec("Pago y cobertura actual", rows);
  } else if (d.tipo === "hogar") {
    sec("Datos personales", [["Nombre y apellido", d.hogar_nombre], ["DNI o CUIT", d.hogar_doc, 1], ["Domicilio de la propiedad", d.hogar_domicilio, 1], ["Localidad", d.hogar_localidad]]);
    sec("Datos de la propiedad", [["Tipo de propiedad", d.hogar_tipo === "casa" ? "Casa" : "Departamento"], ["Metros cuadrados", d.hogar_m2],
      ["Qué le interesa cubrir", d.hogar_basica === "si" ? "Quiere una cobertura básica para empezar" : d.hogar_cubrir]]);
  } else if (d.tipo === "ap") {
    sec("Datos del seguro", [["DNI o CUIT del tomador", d.ap_doc, 1], ["Nombre completo o razón social", d.ap_nombre], ["Actividad", d.ap_actividad],
      ["Cantidad de personas", d.ap_cantidad], ["Suma asegurada solicitada", d.ap_suma], ["Días de cobertura", d.ap_dias]]);
  } else if (d.tipo === "viajero") {
    sec("Datos del viaje", [["Destino", d.viaje_destino], ["Fecha de salida", dmy(d.viaje_salida)], ["Fecha de regreso", dmy(d.viaje_regreso)], ["Cantidad de viajeros", String(d.viajeros.length)]]);
    d.viajeros.forEach((v, i) => {
      const rows = [["Nombre y apellido", v.nombre], ["DNI", v.dni, 1], ["Domicilio", v.domicilio, 1]];
      if (completo) rows.push(v.nacimiento ? ["Fecha de nacimiento", dmy(v.nacimiento)] : ["Edad", v.edad ? `${v.edad} años` : ""]);
      else rows.push(["Edad", (v.edad || ageFrom(v.nacimiento)) ? `${v.edad || ageFrom(v.nacimiento)} años` : ""]);
      sec(`Viajero ${i + 1}`, rows);
    });
  } else if (d.tipo === "otro") {
    sec("Consulta", [["Seguro", OTROS[d.otro_tipo]], ["Nombre y apellido", d.otro_nombre], ["Detalle", d.otro_detalle]]);
  }
  sec("Contacto", [["Teléfono / WhatsApp", d.telefono], ["Correo", d.email]]);
  if (!completo && d.tipo !== "otro" && ref) L.push("", `DNI, domicilio y demás datos completos: en el correo de la solicitud ${ref}.`);
  return L.join("\n");
}

export function nombreDe(d) {
  return d.auto_nombre || d.hogar_nombre || d.ap_nombre || d.otro_nombre || (d.viajeros && d.viajeros[0] && d.viajeros[0].nombre) || "";
}

// Mismo número para los reintentos de una misma solicitud (misma clave de envío)
export function makeRef(idem) {
  const day = todayAR().replace(/-/g, "");
  const h = createHash("sha256").update(String(idem || Math.random())).digest("hex").slice(0, 5).toUpperCase();
  return `COT-${day}-${h}`;
}

/* ---------- Envío (Resend) ---------- */
export async function sendWithResend(msg, env, fetchImpl = fetch) {
  const headers = { Authorization: `Bearer ${String(env.RESEND_API_KEY).trim()}`, "Content-Type": "application/json" };
  if (msg.idempotencyKey) headers["Idempotency-Key"] = msg.idempotencyKey;
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify({
      from: env.COTIZACION_FROM || env.DENUNCIA_FROM || DEFAULT_FROM,
      to: [msg.to],
      subject: msg.subject,
      text: msg.text,
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });
  let body = {};
  try { body = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok || !body.id) throw new Error(`Resend respondió ${res.status}: ${body.message || body.name || "sin detalle"}`);
  return body.id;
}

async function logToSheets(d, ref, full, env, fetchImpl) {
  if (!env.SHEETS_WEBHOOK_URL) return;
  const row = {
    token: env.SHEETS_TOKEN || "",
    hoja: "Cotizaciones",
    ref,
    enviada: new Intl.DateTimeFormat("es-AR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }).format(new Date()),
    tipo: TIPOS[d.tipo] + (d.tipo === "otro" ? ` (${OTROS[d.otro_tipo]})` : ""),
    nombre: nombreDe(d),
    telefono: d.telefono,
    email: d.email || "",
    localidad: d.auto_localidad || d.hogar_localidad || d.viaje_destino || "",
    detalle: full,
    estado: "Nueva",
  };
  const res = await fetchImpl(env.SHEETS_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Sheets respondió ${res.status}`);
}

/* ---------- Manejo de la solicitud ---------- */
const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

function originAllowed(origin, env) {
  if (!origin) return true;
  let host;
  try { host = new URL(origin).hostname; } catch { return false; }
  const extra = String(env.DENUNCIA_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return host === "segurosarnedo.com" || host.endsWith(".segurosarnedo.com") ||
    host === "seguros-arnedo.netlify.app" || host.endsWith("--seguros-arnedo.netlify.app") ||
    host === "localhost" || host === "127.0.0.1" || extra.includes(host);
}

/* Origen de la visita (fuente/medio/campaña/página de entrada). Solo va al correo interno. */
export function origenTexto(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return "";
  const c = (v, n) => String(v ?? "").replace(/[^\p{L}\p{N} ._\/()#:+-]/gu, "").trim().slice(0, n);
  const fuente = c(o.fuente, 60), medio = c(o.medio, 40), campania = c(o.campania, 60), entrada = c(o.entrada, 120);
  if (!fuente && !entrada) return "";
  const partes = [`Origen: ${fuente || "(desconocido)"}${medio ? " / " + medio : ""}`];
  if (campania) partes.push(`Campaña: ${campania}`);
  if (entrada) partes.push(`Página de entrada: ${entrada}`);
  return partes.join(" · ");
}

export async function handle(req, env = process.env, fetchImpl = fetch) {
  const configurado = Boolean(String(env.RESEND_API_KEY || "").trim());
  if (req.method === "GET") return json(200, { ok: true, configurado });
  if (req.method !== "POST") return json(405, { ok: false, message: "Método no permitido." });
  if (!originAllowed(req.headers.get("origin"), env)) return json(403, { ok: false, message: "Origen no permitido." });
  if (Number(req.headers.get("content-length") || 0) > MAX_BODY) return json(413, { ok: false, message: "La solicitud es demasiado larga." });

  let body;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return json(413, { ok: false, message: "La solicitud es demasiado larga." });
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, message: "No pudimos leer los datos enviados." });
  }
  if (!body || typeof body !== "object") return json(400, { ok: false, message: "No pudimos leer los datos enviados." });
  if (clean(body.sitio_web)) return json(200, { ok: true }); // trampa para bots

  const { ok, errors, data } = validate(body);
  if (!ok) return json(422, { ok: false, message: "Revisá los campos marcados en rojo.", errors });
  if (!configurado) {
    console.error("[cotizacion] Falta la variable de entorno RESEND_API_KEY");
    return json(500, { ok: false, message: "No pudimos enviar la solicitud en este momento." });
  }

  const idem = /^[A-Za-z0-9-]{8,64}$/.test(clean(body.idem)) ? clean(body.idem) : "";
  const ref = makeRef(idem || Math.random());
  const full = buildText(data, ref, true);
  const resumen = buildText(data, ref, false);
  const origen = origenTexto(body.origen);
  const sentAt = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }).format(new Date());
  const nombre = nombreDe(data);

  try {
    const id = await sendWithResend({
      to: env.COTIZACION_TO || env.DENUNCIA_TO || DEFAULT_TO,
      subject: `${TIPOS[data.tipo]} | ${nombre} | ${ref}`,
      text: `${full}\n\n${origen ? origen + "\n" : ""}Enviada desde segurosarnedo.com el ${sentAt} (hora de Argentina).`,
      replyTo: data.email || undefined,
      idempotencyKey: idem ? `cot-${idem}` : undefined,
    }, env, fetchImpl);
    console.log(`[cotizacion] ${ref} enviada (${id})`);
  } catch (err) {
    console.error(`[cotizacion] ${ref} no enviada:`, err.message);
    return json(502, { ok: false, message: "No pudimos enviar la solicitud en este momento." });
  }

  const extras = [];
  if (env.COTIZACION_COPIA_CLIENTE === "si" && data.email) {
    const texto = [
      `Hola${nombre ? ", " + nombre.split(/[ ,]/)[0] : ""}:`,
      "",
      `Recibimos tu solicitud de cotización (${ref}). Te vamos a responder con las opciones de lunes a viernes, de 9 a 18.`,
      "",
      "Este es el resumen de lo que nos enviaste:",
      "",
      buildText(data, "", false),
      "",
      "SegurosArnedo.com · Juan Manuel Arnedo, Productor Asesor de Seguros (Matrícula SSN N° 86525)",
      "WhatsApp: +54 9 351 516-1257 · segurosarnedo.com",
    ].join("\n");
    extras.push(sendWithResend({ to: data.email, subject: `Recibimos tu solicitud de cotización ${ref}`, text: texto, idempotencyKey: idem ? `cot-copia-${idem}` : undefined }, env, fetchImpl)
      .catch((e) => console.error(`[cotizacion] ${ref} copia al cliente no enviada:`, e.message)));
  }
  extras.push(logToSheets(data, ref, full, env, fetchImpl).catch((e) => console.error(`[cotizacion] ${ref} no se registró en Sheets:`, e.message)));
  await Promise.all(extras);

  return json(200, { ok: true, ref, resumen });
}
