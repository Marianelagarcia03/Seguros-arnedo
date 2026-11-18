// Lógica del formulario «Denuncia de siniestro»: validación del lado del
// servidor, armado del correo y envío con adjuntos a través de Resend.
// Sin dependencias externas (usa FormData, File y fetch nativos de Node 18+).

export const LIMITS = {
  body: 4.5 * 1024 * 1024, // margen bajo el límite de 6 MB de Netlify Functions
  file: 2 * 1024 * 1024,   // por foto, ya comprimida en el navegador
  terceros: 10,
};

const DEFAULT_TO = "juanmanuelarnedo@gmail.com";
const DEFAULT_FROM = "Web JMA Seguros <onboarding@resend.dev>";
const TZ = "America/Argentina/Cordoba";

const TERCERO_FIELDS = [
  ["nombre", "Apellido y nombre", null, 120],
  ["dni", "DNI", "dni", 12],
  ["telefono", "Teléfono de contacto", "phone", 30],
  ["vehiculo", "Marca y modelo del vehículo", null, 120],
  ["patente", "Patente", "plate", 10],
  ["compania", "Compañía aseguradora", null, 120],
  ["danios", "Daños del vehículo", null, 3000],
];

const CONDUCTOR_FIELDS = [
  ["conductor_nombre", "Apellido y nombre", null, 120],
  ["conductor_dni", "DNI", "dni", 12],
  ["conductor_nacimiento", "Fecha de nacimiento", "birthdate", 10],
  ["conductor_telefono", "Teléfono o celular", "phone", 30],
  ["conductor_domicilio", "Domicilio", null, 200],
];

/* ---------- Utilidades ---------- */
const digits = (v) => String(v || "").replace(/\D/g, "");
const normPlate = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const todayAR = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const isISODate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));
const dmy = (iso) => (isISODate(iso) ? iso.split("-").reverse().join("/") : iso);
const str = (fd, k) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : "";
};

function checkTyped(type, value) {
  if (!value) return "Completá este campo.";
  if (type === "dni" && !/^\d{7,8}$/.test(digits(value))) return "Ingresá un DNI válido (7 u 8 números).";
  if (type === "phone" && digits(value).length < 8) return "Ingresá un teléfono válido, con código de área.";
  if (type === "plate" && !/^[A-Z0-9]{5,8}$/.test(normPlate(value))) return "Ingresá una patente válida.";
  if (type === "birthdate" && (!isISODate(value) || value > todayAR() || value < "1900-01-01")) return "Revisá la fecha de nacimiento.";
  return "";
}

// Firma de los formatos de imagen admitidos (no se confía en el tipo declarado)
function sniffImage(bytes) {
  const b = bytes;
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png", type: "image/png" };
  const ascii = (s, e) => String.fromCharCode(...b.slice(s, e));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { ext: "webp", type: "image/webp" };
  if (ascii(4, 8) === "ftyp" && /^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(ascii(8, 12))) return { ext: "heic", type: "image/heic" };
  return null;
}

/* ---------- Validación ---------- */
export async function parseAndValidate(fd) {
  const errors = {};
  const data = {};
  const need = (key, label, type, max) => {
    const v = str(fd, key);
    let err = checkTyped(type, v);
    if (!err && v.length > max) err = `Máximo ${max} caracteres.`;
    if (err) errors[key] = err;
    data[key] = type === "plate" ? normPlate(v) : v;
  };

  need("fecha", "Fecha", null, 10);
  if (!errors.fecha) {
    if (!isISODate(data.fecha)) errors.fecha = "Ingresá una fecha válida.";
    else if (data.fecha > todayAR()) errors.fecha = "La fecha no puede ser posterior a hoy.";
    else if (data.fecha < "2000-01-01") errors.fecha = "Revisá la fecha del hecho.";
  }
  need("hora", "Hora", null, 5);
  if (!errors.hora && !/^([01]\d|2[0-3]):[0-5]\d$/.test(data.hora)) errors.hora = "Ingresá una hora válida.";
  need("direccion", "Dirección del hecho", null, 200);
  need("relato", "Relato", null, 5000);

  data.asegurado_conducia = str(fd, "asegurado_conducia");
  if (!["si", "no"].includes(data.asegurado_conducia)) errors.asegurado_conducia = "Elegí una opción.";
  if (data.asegurado_conducia === "no") CONDUCTOR_FIELDS.forEach(([k, l, t, m]) => need(k, l, t, m));

  need("patente", "Patente", "plate", 10);
  need("danios", "Daños del vehículo", null, 3000);

  data.hubo_terceros = str(fd, "hubo_terceros");
  data.terceros = [];
  if (!["si", "no"].includes(data.hubo_terceros)) errors.hubo_terceros = "Elegí una opción.";
  if (data.hubo_terceros === "si") {
    const n = Number(str(fd, "terceros_cantidad"));
    if (!Number.isInteger(n) || n < 1 || n > LIMITS.terceros) {
      errors.hubo_terceros = "Cargá los datos de al menos un tercero.";
    } else {
      for (let i = 1; i <= n; i++) {
        const t = {};
        for (const [k, , type, max] of TERCERO_FIELDS) {
          const key = `t${i}_${k}`;
          if (str(fd, `${key}_nolose`) === "1") { t[k] = null; continue; }
          const v = str(fd, key);
          let err = v ? checkTyped(type, v) : "Completá este dato o marcá «No lo sé».";
          if (!err && v.length > max) err = `Máximo ${max} caracteres.`;
          if (err) errors[key] = err;
          t[k] = type === "plate" ? normPlate(v) : v;
        }
        data.terceros.push(t);
      }
    }
  }

  if (str(fd, "consentimiento") !== "si") errors.consentimiento = "Necesitamos tu autorización para gestionar la denuncia.";

  data.fotos = {};
  for (const [key, side] of [["carnet_frente", "frente"], ["carnet_dorso", "dorso"]]) {
    const f = fd.get(key);
    if (!f || typeof f === "string" || !f.size) { errors[key] = `Subí la foto del ${side} del carnet.`; continue; }
    if (f.size > LIMITS.file) { errors[key] = "La foto es demasiado pesada. Probá con otra."; continue; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    const kind = sniffImage(bytes);
    if (!kind) { errors[key] = "El archivo no es una imagen admitida (JPG, PNG, WEBP o HEIC)."; continue; }
    data.fotos[side] = { bytes, ...kind };
  }

  return { ok: Object.keys(errors).length === 0, errors, data };
}

/* ---------- Correo ---------- */
export function buildEmail(d) {
  const sentAt = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }).format(new Date());
  const unk = (v) => (v === null ? "Desconocido" : v);
  const L = [];
  L.push("DENUNCIA DE SINIESTRO");
  L.push(`Enviada desde segurosarnedo.com el ${sentAt} (hora de Argentina).`);
  L.push("");
  L.push("DATOS DEL SINIESTRO");
  L.push(`Fecha: ${dmy(d.fecha)}`);
  L.push(`Hora: ${d.hora}`);
  L.push(`Dirección del hecho: ${d.direccion}`);
  L.push(`Relato de los hechos: ${d.relato}`);
  L.push("");
  L.push("DATOS DEL CONDUCTOR");
  L.push(`¿El asegurado conducía el vehículo?: ${d.asegurado_conducia === "si" ? "Sí" : "No"}`);
  if (d.asegurado_conducia === "no") {
    L.push(`Apellido y nombre: ${d.conductor_nombre}`);
    L.push(`DNI: ${d.conductor_dni}`);
    L.push(`Fecha de nacimiento: ${dmy(d.conductor_nacimiento)}`);
    L.push(`Teléfono o celular: ${d.conductor_telefono}`);
    L.push(`Domicilio: ${d.conductor_domicilio}`);
  }
  L.push("");
  L.push("VEHÍCULO ASEGURADO");
  L.push(`Patente: ${d.patente}`);
  L.push(`Daños del vehículo: ${d.danios}`);
  L.push("");
  L.push("TERCEROS INVOLUCRADOS");
  L.push(`¿Hubo terceros involucrados?: ${d.hubo_terceros === "si" ? `Sí (${d.terceros.length})` : "No"}`);
  d.terceros.forEach((t, i) => {
    L.push("");
    L.push(`Tercero ${i + 1}`);
    for (const [k, label] of TERCERO_FIELDS) L.push(`${label}: ${unk(t[k])}`);
  });
  L.push("");
  L.push("FOTOS DEL CARNET DE CONDUCIR");
  const quien = d.asegurado_conducia === "si" ? "el asegurado" : d.conductor_nombre;
  const files = attachmentsFor(d);
  L.push(`Frente: adjunto «${files[0].filename}»`);
  L.push(`Dorso: adjunto «${files[1].filename}»`);
  L.push(`Corresponden a la persona que conducía: ${quien}.`);
  L.push("");
  L.push("La persona aceptó el uso de sus datos para gestionar la denuncia (Ley 25.326).");

  return {
    subject: `Denuncia de siniestro | Patente ${d.patente} | ${dmy(d.fecha)}`,
    text: L.join("\n"),
    attachments: files,
  };
}

function attachmentsFor(d) {
  return [
    ["frente", "FRENTE"],
    ["dorso", "DORSO"],
  ].map(([side, label]) => {
    const f = d.fotos[side];
    return {
      filename: `Carnet-${label}-${d.patente}.${f.ext}`,
      content: Buffer.from(f.bytes).toString("base64"),
      content_type: f.type,
    };
  });
}

/* ---------- Envío (Resend) ---------- */
export async function sendWithResend(email, env, fetchImpl = fetch) {
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.DENUNCIA_FROM || DEFAULT_FROM,
      to: [env.DENUNCIA_TO || DEFAULT_TO],
      subject: email.subject,
      text: email.text,
      attachments: email.attachments,
    }),
    signal: AbortSignal.timeout(20000),
  });
  let body = {};
  try { body = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok || !body.id) {
    const err = new Error(`Resend respondió ${res.status}: ${body.message || body.name || "sin detalle"}`);
    err.status = res.status;
    throw err;
  }
  return body.id;
}

/* ---------- Manejo completo de la solicitud ---------- */
const json = (status, obj) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

function originAllowed(origin, env) {
  if (!origin) return true;
  let host;
  try { host = new URL(origin).hostname; } catch { return false; }
  const extra = String(env.DENUNCIA_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return (
    host === "segurosarnedo.com" || host.endsWith(".segurosarnedo.com") ||
    host === "seguros-arnedo.netlify.app" || host.endsWith("--seguros-arnedo.netlify.app") ||
    host === "localhost" || host === "127.0.0.1" || extra.includes(host)
  );
}

export async function handle(req, env = process.env, fetchImpl = fetch) {
  if (req.method !== "POST") return json(405, { ok: false, message: "Método no permitido." });
  if (!originAllowed(req.headers.get("origin"), env)) return json(403, { ok: false, message: "Origen no permitido." });
  const len = Number(req.headers.get("content-length") || 0);
  if (len > LIMITS.body) return json(413, { ok: false, message: "Las fotos son demasiado pesadas. Probá con fotos más livianas." });

  let fd;
  try { fd = await req.formData(); } catch {
    return json(400, { ok: false, message: "No pudimos leer los datos enviados." });
  }

  // Trampa para bots: se responde como si estuviera todo bien, sin enviar nada.
  if (str(fd, "sitio_web")) return json(200, { ok: true });

  const { ok, errors, data } = await parseAndValidate(fd);
  if (!ok) return json(422, { ok: false, message: "Revisá los campos marcados en rojo.", errors });

  if (!env.RESEND_API_KEY) {
    console.error("[denuncia] Falta la variable de entorno RESEND_API_KEY");
    return json(500, { ok: false, message: "No pudimos enviar la denuncia en este momento." });
  }

  const email = buildEmail(data);
  try {
    const id = await sendWithResend(email, env, fetchImpl);
    console.log(`[denuncia] Enviada (${id}) · patente ${data.patente}`);
    return json(200, { ok: true });
  } catch (err) {
    console.error("[denuncia] Error al enviar:", err.message);
    return json(502, { ok: false, message: "No pudimos enviar la denuncia en este momento." });
  }
}
