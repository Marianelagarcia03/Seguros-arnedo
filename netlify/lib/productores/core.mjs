// Organización de Productores: solicitudes de productores nuevos, productores
// activos y pedidos de información.
//
// Cada solicitud se guarda en el almacenamiento privado del panel (Netlify Blobs,
// el mismo de /admin/formularios), con los datos personales cifrados (DATA_KEY),
// y se avisa por correo al organizador con el detalle y los adjuntos.
//
// Claves en el almacenamiento:
//   prod/aseguradoras            { lista: [{ id, nombre, activa }], actualizada }
//   prod/sol/<id>                solicitud completa (datos personales en `enc`)
//   prod/idx/<id>                entrada liviana para listados
//   prod/files/<id>/<fileId>     adjunto (bytes) + metadatos
//   rl/prod/<huella>             contador de envíos por conexión

import { createHash } from "node:crypto";
import { getStore } from "../formularios/store.mjs";
import { randomId, ipKey, rateLimit, encrypt, dataKey } from "../formularios/seguridad.mjs";
import { sniffFile } from "../formularios/esquema.mjs";

const DEFAULT_TO = "juanmanuelarnedo@gmail.com";
const DEFAULT_FROM = '"Web SegurosArnedo.com" <onboarding@resend.dev>';
const TZ = "America/Argentina/Cordoba";
export const MAX_BODY = 4.6 * 1024 * 1024; // margen bajo el límite de Netlify
export const MAX_FILES = 3;
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

export const TIPOS = {
  nuevo: "Productor nuevo",
  activo: "Productor activo · sumar aseguradoras",
  info: "Pedido de información",
};

// Compañías con las que trabaja Seguros Arnedo (las mismas de la web).
// Se pueden activar, desactivar, renombrar o sumar desde el panel (etapa 2)
// sin tocar el código: esta lista solo se usa la primera vez.
export const ASEGURADORAS_INICIALES = [
  { id: "zurich", nombre: "Zurich", activa: true },
  { id: "lasegunda", nombre: "La Segunda", activa: true },
  { id: "federacion", nombre: "Federación Patronal", activa: true },
  { id: "sancristobal", nombre: "San Cristóbal", activa: true },
  { id: "sancor", nombre: "Sancor Seguros", activa: true },
  { id: "galicia", nombre: "Galicia Seguros", activa: true },
  { id: "mercantil", nombre: "La Mercantil Andina", activa: true },
  { id: "premiar", nombre: "Premiar Seguros", activa: true },
];

export const PROVINCIAS = [
  "Buenos Aires", "Ciudad Autónoma de Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes",
  "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones", "Neuquén", "Río Negro",
  "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán",
];

const PERFILES = { nuevo: "Productor recién matriculado", activo: "Productor en actividad", estudiante: "Estoy estudiando para matricularme", otro: "Otro" };
const CODIGO = { si: "Sí", no: "No", algunas: "En algunas" };

// Estados de cada gestión (se usan en el panel, etapa 2).
export const ESTADOS = {
  recibida: "Solicitud recibida",
  revision: "En revisión",
  documentacion: "Documentación pendiente",
  gestion: "En gestión con P&T Brokers / aseguradora",
  aprobada: "Aprobada / Código habilitado",
  rechazada: "Rechazada",
};

/* ---------- Utilidades ---------- */
const digits = (v) => String(v ?? "").replace(/\D/g, "");
const clean = (v) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim() : "");
const todayAR = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const isISODate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));
const dmy = (iso) => (isISODate(iso) ? iso.split("-").reverse().join("/") : iso);
const siNo = (v) => (v === "si" ? "Sí" : v === "no" ? "No" : "");
const ahoraAR = () => new Intl.DateTimeFormat("es-AR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }).format(new Date());

// CUIT/CUIL: 11 números con dígito verificador.
export function cuitValido(v) {
  const d = digits(v);
  if (!/^(20|23|24|25|26|27|30|33|34)\d{9}$/.test(d)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + p * Number(d[i]), 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) dv = 9;
  return dv === Number(d[10]);
}

const fmtCuit = (v) => { const d = digits(v); return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : v; };

// Enlace de WhatsApp a partir de un teléfono argentino escrito de cualquier forma.
export function waLink(tel) {
  let d = digits(tel);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("9")) d = d.slice(1);
  if (d.startsWith("0")) d = d.slice(1);
  // 0351 15 1234567 → 351 1234567
  const m = /^(\d{2,4})15(\d{6,8})$/.exec(d);
  if (m && (m[1] + m[2]).length === 10) d = m[1] + m[2];
  return d.length >= 8 ? `https://wa.me/549${d}` : "";
}

function check(type, v) {
  const d = digits(v);
  if (!v) return "Completá este campo.";
  if (type === "dni" && !/^\d{7,8}$/.test(d)) return "Ingresá un DNI válido (7 u 8 números).";
  if (type === "cuit" && !cuitValido(v)) return "Revisá el CUIT/CUIL (11 números).";
  if (type === "phone" && (d.length < 8 || d.length > 15)) return "Ingresá un teléfono válido, con código de área.";
  if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return "Revisá el correo electrónico.";
  if (type === "matricula" && !/^\d{1,7}$/.test(d)) return "Ingresá el número de matrícula (solo números).";
  return "";
}

/* ---------- Aseguradoras ---------- */
export async function leerAseguradoras(store) {
  const guardada = await store.getJSON("prod/aseguradoras");
  if (guardada && Array.isArray(guardada.lista) && guardada.lista.length) return guardada.lista;
  return ASEGURADORAS_INICIALES.map((a) => ({ ...a }));
}

export const aseguradorasPublicas = (lista) => lista.filter((a) => a.activa).map(({ id, nombre }) => ({ id, nombre }));

// Entrada liviana para el listado. Los datos de contacto van cifrados.
export function indexDe(sol, datos, env) {
  return {
    id: sol.id, ref: sol.ref, tipo: sol.tipo, createdAt: sol.createdAt, updatedAt: sol.updatedAt || sol.createdAt,
    estado: sol.estado, nombre: sol.resumen.nombre, localidad: sol.resumen.localidad, provincia: sol.resumen.provincia,
    companias: (sol.gestiones || []).map((g) => g.id),
    gestiones: (sol.gestiones || []).map((g) => ({ id: g.id, estado: g.estado })),
    enc: datos ? encrypt(JSON.stringify({ dni: datos.dni || "", cuit: datos.cuit || "", matricula: datos.matricula || "", telefono: datos.telefono || "", email: datos.email || "" }), env) : "",
  };
}

/* ---------- Validación ---------- */
export function validate(body, aseguradoras) {
  const errors = {};
  const d = { tipo: clean(body.tipo) };
  const need = (key, type = null, max = 200, optional = false) => {
    const v = clean(body[key]);
    let err = !v && optional ? "" : check(type, v);
    if (!err && v.length > max) err = `Máximo ${max} caracteres.`;
    if (err) errors[key] = err;
    d[key] = type === "dni" || type === "cuit" || type === "matricula" ? digits(v) : v;
  };
  const pick = (key, options) => {
    d[key] = clean(body[key]);
    if (!options.includes(d[key])) errors[key] = "Elegí una opción.";
  };
  const activas = new Set(aseguradoras.filter((a) => a.activa).map((a) => a.id));
  const companias = (key) => {
    const raw = Array.isArray(body[key]) ? body[key] : [];
    const ids = [...new Set(raw.map(clean))].filter((id) => activas.has(id));
    if (!ids.length) errors[key] = "Elegí al menos una compañía.";
    d[key] = ids;
  };

  if (!TIPOS[d.tipo]) {
    errors.tipo = "Elegí una opción.";
    return { ok: false, errors, data: d };
  }

  need("nombre", null, 120);
  need("telefono", "phone", 30);
  need("email", "email", 120);
  need("localidad", null, 80);
  pick("provincia", PROVINCIAS);

  if (d.tipo === "nuevo" || d.tipo === "activo") {
    need("dni", "dni", 12);
    need("cuit", "cuit", 15);
    need("matricula", "matricula", 10);
    if (!errors.cuit && !errors.dni && d.cuit.slice(2, 10) !== d.dni.padStart(8, "0")) {
      errors.cuit = "El CUIT no coincide con el DNI. Revisá los dos.";
    }
    pick("trabaja_organizacion", ["si", "no"]);
    if (d.trabaja_organizacion === "si") need("organizacion", null, 120, true);
    else d.organizacion = "";
    companias("companias");
    need("comentarios", null, 1500, true);
  }

  if (d.tipo === "nuevo") {
    need("fecha_matricula", null, 10);
    if (!errors.fecha_matricula && (!isISODate(d.fecha_matricula) || d.fecha_matricula > todayAR() || d.fecha_matricula < "1950-01-01")) {
      errors.fecha_matricula = "Revisá la fecha de matriculación.";
    }
    pick("primera_experiencia", ["si", "no"]);
  }

  if (d.tipo === "activo") {
    need("companias_actuales", null, 400);
    pick("tiene_codigo", ["si", "no", "algunas"]);
    if (d.tiene_codigo !== "no") need("codigo_detalle", null, 300, true);
    else d.codigo_detalle = "";
  }

  if (d.tipo === "info") {
    pick("perfil", Object.keys(PERFILES));
    need("consulta", null, 1500, true);
  }

  if (clean(body.consentimiento) !== "si") errors.consentimiento = "Necesitamos tu conformidad para usar estos datos en la gestión.";

  return { ok: Object.keys(errors).length === 0, errors, data: d };
}

/* ---------- Texto de la solicitud ---------- */
export function buildText(d, ref, aseguradoras, archivos = []) {
  const nombreDe = new Map(aseguradoras.map((a) => [a.id, a.nombre]));
  const lista = (ids) => (ids || []).map((id) => nombreDe.get(id) || id).join(", ");
  const L = [`ORGANIZACIÓN DE PRODUCTORES · ${TIPOS[d.tipo].toUpperCase()}`, `Solicitud ${ref}`];
  const sec = (title, rows) => {
    const lines = rows.filter(([, v]) => v !== undefined && v !== "");
    if (!lines.length) return;
    L.push("", title);
    for (const [label, v] of lines) L.push(`${label}: ${v}`);
  };
  sec("Datos personales", [
    ["Nombre y apellido", d.nombre], ["DNI", d.dni], ["CUIT", d.cuit ? fmtCuit(d.cuit) : ""],
    ["Teléfono / WhatsApp", d.telefono], ["Correo", d.email], ["Localidad", d.localidad], ["Provincia", d.provincia],
  ]);
  if (d.tipo === "nuevo") {
    sec("Datos profesionales", [
      ["Matrícula SSN", d.matricula], ["Fecha de matriculación", dmy(d.fecha_matricula)],
      ["¿Primera experiencia como productor?", siNo(d.primera_experiencia)],
      ["¿Trabaja con alguna organización?", siNo(d.trabaja_organizacion) + (d.organizacion ? ` (${d.organizacion})` : "")],
      ["Compañías con las que quiere comenzar", lista(d.companias)],
    ]);
  } else if (d.tipo === "activo") {
    sec("Datos profesionales", [
      ["Matrícula SSN", d.matricula],
      ["¿Trabaja con alguna organización?", siNo(d.trabaja_organizacion) + (d.organizacion ? ` (${d.organizacion})` : "")],
      ["Aseguradoras con las que trabaja hoy", d.companias_actuales],
      ["Aseguradoras que quiere incorporar", lista(d.companias)],
      ["¿Ya tiene código en alguna de ellas?", CODIGO[d.tiene_codigo] + (d.codigo_detalle ? ` (${d.codigo_detalle})` : "")],
    ]);
  } else {
    sec("Consulta", [["Perfil", PERFILES[d.perfil]], ["Mensaje", d.consulta]]);
  }
  if (d.comentarios) sec("Comentarios", [["Comentarios", d.comentarios]]);
  if (archivos.length) sec("Documentación adjunta", archivos.map((a, i) => [`Archivo ${i + 1}`, `${a.nombre} (${a.size < 1024 * 1024 ? Math.max(1, Math.round(a.size / 1024)) + " KB" : (a.size / 1024 / 1024).toFixed(1).replace(".", ",") + " MB"})`]));
  return L.join("\n");
}

export function makeRef(seed) {
  const day = todayAR().replace(/-/g, "");
  const h = createHash("sha256").update(String(seed)).digest("hex").slice(0, 5).toUpperCase();
  return `PRD-${day}-${h}`;
}

/* ---------- Correo (Resend) ---------- */
export async function sendWithResend(msg, env, fetchImpl = fetch) {
  const headers = { Authorization: `Bearer ${String(env.RESEND_API_KEY).trim()}`, "Content-Type": "application/json" };
  if (msg.idempotencyKey) headers["Idempotency-Key"] = msg.idempotencyKey;
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify({
      from: env.PRODUCTORES_FROM || env.COTIZACION_FROM || env.DENUNCIA_FROM || DEFAULT_FROM,
      to: [msg.to],
      subject: msg.subject,
      text: msg.text,
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
      ...(msg.attachments && msg.attachments.length ? { attachments: msg.attachments } : {}),
    }),
    signal: AbortSignal.timeout(20000),
  });
  let body = {};
  try { body = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok || !body.id) throw new Error(`Resend respondió ${res.status}: ${body.message || body.name || "sin detalle"}`);
  return body.id;
}

/* ---------- Respuestas ---------- */
const json = (status, obj) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });

function originAllowed(origin, env) {
  if (!origin) return true;
  let host;
  try { host = new URL(origin).hostname; } catch { return false; }
  const extra = String(env.DENUNCIA_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return host === "segurosarnedo.com" || host.endsWith(".segurosarnedo.com") ||
    host === "seguros-arnedo.netlify.app" || host.endsWith("--seguros-arnedo.netlify.app") ||
    host === "localhost" || host === "127.0.0.1" || extra.includes(host);
}

const MENSAJES = {
  nuevo: "¡Gracias por contactarte con Seguros Arnedo! Recibimos tu solicitud de incorporación. Vamos a revisar tus datos y nos pondremos en contacto para acompañarte en el proceso de gestión y apertura de códigos con las compañías aseguradoras. Las gestiones se realizan con el respaldo de P&T Brokers Asesores de Seguros.",
  activo: "¡Gracias por confiar en Seguros Arnedo! Recibimos tu solicitud para incorporar nuevas compañías aseguradoras. Nos pondremos en contacto para evaluar las alternativas y acompañarte en el proceso de vinculación y apertura de códigos, con el respaldo de P&T Brokers Asesores de Seguros.",
  info: "¡Gracias por escribirnos! Recibimos tus datos y te vamos a contactar para contarte cómo funciona la organización y cómo podemos acompañarte.",
};

/* ---------- Manejo de la solicitud ---------- */
export async function handle(req, env = process.env, fetchImpl = fetch) {
  const correo = Boolean(String(env.RESEND_API_KEY || "").trim());
  const guardado = Boolean(dataKey(env));

  if (req.method === "GET") {
    let aseguradoras = ASEGURADORAS_INICIALES;
    try { aseguradoras = await leerAseguradoras(await getStore(env)); } catch (e) { console.error("[productores] No se pudo leer la lista de aseguradoras:", e.message); }
    return json(200, { ok: true, configurado: correo, aseguradoras: aseguradorasPublicas(aseguradoras) });
  }
  if (req.method !== "POST") return json(405, { ok: false, message: "Método no permitido." });
  if (!originAllowed(req.headers.get("origin"), env)) return json(403, { ok: false, message: "Origen no permitido." });
  if (Number(req.headers.get("content-length") || 0) > MAX_BODY) return json(413, { ok: false, message: "Los archivos son demasiado pesados. Quitá alguno o probá con archivos más livianos." });

  let fd;
  try { fd = await req.formData(); } catch { return json(400, { ok: false, message: "No pudimos leer los datos enviados." }); }

  let body;
  try { body = JSON.parse(String(fd.get("datos") || "")); } catch { return json(400, { ok: false, message: "No pudimos leer los datos enviados." }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json(400, { ok: false, message: "No pudimos leer los datos enviados." });

  // Trampas para robots: campo oculto completado o formulario enviado en menos de 4 segundos.
  const abierto = Number(body.abierto) || 0;
  if (clean(body.sitio_web) || (abierto && Date.now() - abierto < 4000)) return json(200, { ok: true, ref: "", mensaje: MENSAJES[clean(body.tipo)] || MENSAJES.info });

  if (!correo) {
    console.error("[productores] Falta la variable de entorno RESEND_API_KEY");
    return json(503, { ok: false, message: "No pudimos enviar la solicitud en este momento. Escribinos por WhatsApp al 351 516-1257." });
  }

  const store = await getStore(env);
  const lim = await rateLimit(store, "prod/" + ipKey(req, env), 8, 3600 * 1000);
  if (!lim.ok) return json(429, { ok: false, message: "Recibimos muchos envíos desde tu conexión. Probá de nuevo en un rato o escribinos por WhatsApp." });

  const aseguradoras = await leerAseguradoras(store);
  const { ok, errors, data } = validate(body, aseguradoras);

  // Adjuntos (solo productores nuevos y activos).
  const archivos = [];
  const subidos = fd.getAll("archivos").filter((f) => f && typeof f === "object" && typeof f.arrayBuffer === "function" && f.size > 0);
  if (subidos.length && data.tipo === "info") errors.archivos = "Este formulario no lleva archivos.";
  if (subidos.length > MAX_FILES) errors.archivos = `Podés adjuntar hasta ${MAX_FILES} archivos.`;
  for (const f of subidos.slice(0, MAX_FILES)) {
    if (f.size > MAX_FILE_BYTES) { errors.archivos = `«${String(f.name).slice(0, 60)}» es muy pesado (máximo 4 MB).`; break; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    const kind = sniffFile(bytes);
    if (!kind || kind.ext === "heic") { errors.archivos = "Solo se aceptan PDF o imágenes JPG, PNG o WEBP."; break; }
    const base = String(f.name || "archivo").replace(/\.[^.]*$/, "").replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 60) || "archivo";
    archivos.push({ bytes, type: kind.type, ext: kind.ext, size: bytes.length, nombre: `${base}.${kind.ext}` });
  }

  if (!ok || errors.archivos) return json(422, { ok: false, message: "Revisá los campos marcados en rojo.", errors });

  const idem = /^[A-Za-z0-9-]{8,64}$/.test(clean(body.idem)) ? clean(body.idem) : randomId(12);
  const ref = makeRef(idem);
  const id = ref.toLowerCase();

  // Doble clic o reintento: misma respuesta, sin duplicar.
  if (await store.getJSON("prod/idx/" + id)) return json(200, { ok: true, ref, mensaje: MENSAJES[data.tipo] });

  const texto = buildText(data, ref, aseguradoras, archivos);
  const wa = waLink(data.telefono);
  const nombreDe = new Map(aseguradoras.map((a) => [a.id, a.nombre]));

  try {
    const mailId = await sendWithResend({
      to: env.PRODUCTORES_TO || DEFAULT_TO,
      subject: `Productores · ${TIPOS[data.tipo]} | ${data.nombre} | ${ref}`,
      text: `${texto}\n\n${wa ? `Escribirle por WhatsApp: ${wa}\n` : ""}Enviada desde segurosarnedo.com el ${ahoraAR()} (hora de Argentina).`,
      replyTo: data.email,
      idempotencyKey: `prod-${idem}`,
      attachments: archivos.map((a) => ({ filename: `${ref}-${a.nombre}`, content: Buffer.from(a.bytes).toString("base64"), content_type: a.type })),
    }, env, fetchImpl);
    console.log(`[productores] ${ref} enviada (${mailId})`);
  } catch (err) {
    console.error(`[productores] ${ref} no enviada:`, err.message);
    return json(502, { ok: false, message: "No pudimos enviar la solicitud en este momento. Probá de nuevo en unos minutos o escribinos por WhatsApp." });
  }

  // Registro en el almacenamiento privado (para el panel). Si falla, el correo ya llegó.
  try {
    if (!guardado) throw new Error("Falta DATA_KEY: la solicitud llegó por correo pero no se guardó en el panel");
    const ahora = new Date().toISOString();
    const files = [];
    for (const a of archivos) {
      const fileId = randomId(12);
      await store.setBytes(`prod/files/${id}/${fileId}`, a.bytes, { type: a.type, ext: a.ext, size: a.size, nombre: a.nombre, at: Date.now() });
      files.push({ id: fileId, nombre: a.nombre, type: a.type, size: a.size });
    }
    const gestiones = (data.companias || []).map((cid) => ({
      id: cid, nombre: nombreDe.get(cid) || cid, estado: "recibida", inicio: "", codigo: "", habilitada: "", obs: "",
    }));
    const sol = {
      id, ref, tipo: data.tipo, createdAt: ahora, estado: "recibida",
      resumen: { nombre: data.nombre, localidad: data.localidad, provincia: data.provincia },
      enc: encrypt(JSON.stringify(data), env),
      gestiones, files, notas: [],
      log: [{ at: ahora, accion: "Solicitud recibida desde la web" }],
    };
    await store.setJSON("prod/sol/" + id, sol);
    await store.setJSON("prod/idx/" + id, indexDe(sol, data, env));
  } catch (err) {
    console.error(`[productores] ${ref} no se guardó en el panel:`, err.message);
  }

  return json(200, { ok: true, ref, mensaje: MENSAJES[data.tipo] });
}
