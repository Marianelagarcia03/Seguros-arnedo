// Lógica del formulario «Denuncia de siniestro»: validación del lado del
// servidor, armado del correo y envío con adjuntos a través de Resend.
// Sin dependencias externas (usa FormData, File y fetch nativos de Node 18+).

export const LIMITS = {
  body: 4.5 * 1024 * 1024,   // margen bajo el límite de 6 MB de Netlify Functions
  carnet: 2 * 1024 * 1024,   // por foto del carnet, ya comprimida en el navegador
  extra: 1.3 * 1024 * 1024,  // por foto de daños o de papeles del tercero
  danios: 4,                 // fotos de daños
  docs: 3,                   // fotos de papeles por tercero
  terceros: 10,
};

const DEFAULT_TO = "juanmanuelarnedo@gmail.com";
const DEFAULT_FROM = "Web JMA Seguros <onboarding@resend.dev>";
const TZ = "America/Argentina/Cordoba";

export const TIPOS = {
  choque: "Choque o accidente de tránsito",
  robo: "Robo o hurto",
  incendio: "Incendio",
  granizo: "Granizo o fenómeno climático",
  cristales: "Rotura de cristales o cerraduras",
  otro: "Otro",
};
const CON_CONDUCTOR = ["choque", "otro"]; // conductor, terceros y carnet
const COMPANIAS = ["Zurich", "La Segunda", "Federación Patronal", "San Cristóbal", "Sancor Seguros", "Galicia Seguros", "Mercantil Andina", "No lo sé"];

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
const siNo = (v) => (v === "si" ? "Sí" : "No");
const str = (fd, k) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : "";
};
const plusDays = (iso, n) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function checkTyped(type, value) {
  if (!value) return "Completá este campo.";
  if (type === "dni" && !/^\d{7,8}$/.test(digits(value))) return "Ingresá un DNI válido (7 u 8 números).";
  if (type === "phone" && digits(value).length < 8) return "Ingresá un teléfono válido, con código de área.";
  if (type === "plate" && !/^[A-Z0-9]{5,8}$/.test(normPlate(value))) return "Ingresá una patente válida.";
  if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return "Revisá el correo electrónico.";
  if (type === "birthdate" && (!isISODate(value) || value > todayAR() || value < "1900-01-01")) return "Revisá la fecha de nacimiento.";
  return "";
}

// Firma de los formatos de imagen admitidos (no se confía en el tipo declarado)
function sniffImage(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png", type: "image/png" };
  const ascii = (s, e) => String.fromCharCode(...b.slice(s, e));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { ext: "webp", type: "image/webp" };
  if (ascii(4, 8) === "ftyp" && /^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(ascii(8, 12))) return { ext: "heic", type: "image/heic" };
  return null;
}

async function readImages(fd, key, { max, limit, required, label }, errors) {
  const files = fd.getAll(key).filter((f) => f && typeof f !== "string" && f.size);
  if (required && !files.length) { errors[key] = `Subí la foto del ${label}.`; return []; }
  if (files.length > max) { errors[key] = `Podés enviar hasta ${max} fotos.`; return []; }
  const out = [];
  for (const f of files) {
    if (f.size > limit) { errors[key] = "Una de las fotos es demasiado pesada. Probá con otra."; return []; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    const kind = sniffImage(bytes);
    if (!kind) { errors[key] = "Uno de los archivos no es una imagen admitida (JPG, PNG, WEBP o HEIC)."; return []; }
    out.push({ bytes, ...kind });
  }
  return out;
}

/* ---------- Validación ---------- */
export async function parseAndValidate(fd) {
  const errors = {};
  const data = {};
  const need = (key, type, max, optional = false) => {
    const v = str(fd, key);
    let err = !v && optional ? "" : checkTyped(type, v);
    if (!err && v.length > max) err = `Máximo ${max} caracteres.`;
    if (err) errors[key] = err;
    data[key] = type === "plate" ? normPlate(v) : v;
  };
  const choice = (key) => {
    data[key] = str(fd, key);
    if (!["si", "no"].includes(data[key])) errors[key] = "Elegí una opción.";
  };

  data.tipo = str(fd, "tipo");
  if (!TIPOS[data.tipo]) errors.tipo = "Elegí el tipo de siniestro.";
  const conConductor = CON_CONDUCTOR.includes(data.tipo);

  need("asegurado_nombre", null, 120);
  need("asegurado_telefono", "phone", 30);
  need("asegurado_email", "email", 120, true);
  data.compania = str(fd, "compania");
  if (!COMPANIAS.includes(data.compania)) errors.compania = "Elegí la compañía aseguradora.";
  need("poliza", null, 40, true);

  need("fecha", null, 10);
  if (!errors.fecha) {
    if (!isISODate(data.fecha)) errors.fecha = "Ingresá una fecha válida.";
    else if (data.fecha > todayAR()) errors.fecha = "La fecha no puede ser posterior a hoy.";
    else if (data.fecha < "2000-01-01") errors.fecha = "Revisá la fecha del hecho.";
  }
  need("hora", null, 5);
  if (!errors.hora && !/^([01]\d|2[0-3]):[0-5]\d$/.test(data.hora)) errors.hora = "Ingresá una hora válida.";
  need("direccion", null, 200);
  if (data.tipo === "choque") {
    need("circulacion", null, 600);
    need("otro_vehiculo", null, 600);
    need("impacto", null, 200);
  }
  need("relato", null, 5000);

  choice("lesionados");
  if (data.lesionados === "si") need("lesionados_detalle", null, 1500);
  choice("policia");
  if (data.policia === "si") need("policia_detalle", null, 600, true);
  choice("testigos");
  if (data.testigos === "si") need("testigos_detalle", null, 800);

  if (conConductor) {
    choice("asegurado_conducia");
    if (data.asegurado_conducia === "no") CONDUCTOR_FIELDS.forEach(([k, , t, m]) => need(k, t, m));
  }

  need("patente", "plate", 10);
  need("danios", null, 3000);
  data.fotosDanios = await readImages(fd, "foto_danio", { max: LIMITS.danios, limit: LIMITS.extra }, errors);

  data.terceros = [];
  if (conConductor) {
    choice("hubo_terceros");
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
          t.docs = await readImages(fd, `t${i}_doc`, { max: LIMITS.docs, limit: LIMITS.extra }, errors);
          data.terceros.push(t);
        }
      }
    }
    const frente = await readImages(fd, "carnet_frente", { max: 1, limit: LIMITS.carnet, required: true, label: "frente del carnet" }, errors);
    const dorso = await readImages(fd, "carnet_dorso", { max: 1, limit: LIMITS.carnet, required: true, label: "dorso del carnet" }, errors);
    data.carnet = { frente: frente[0], dorso: dorso[0] };
  }

  if (str(fd, "consentimiento") !== "si") errors.consentimiento = "Necesitamos tu autorización para gestionar la denuncia.";

  return { ok: Object.keys(errors).length === 0, errors, data };
}

/* ---------- Número de denuncia ---------- */
export function makeRef(d) {
  const day = todayAR().replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, "0");
  return `DEN-${day}-${d.patente}-${rand}`;
}

/* ---------- Correo ---------- */
function attachmentsFor(d) {
  const out = [];
  const add = (f, name) => out.push({ filename: `${name}.${f.ext}`, content: Buffer.from(f.bytes).toString("base64"), content_type: f.type });
  if (d.carnet) {
    add(d.carnet.frente, `Carnet-FRENTE-${d.patente}`);
    add(d.carnet.dorso, `Carnet-DORSO-${d.patente}`);
  }
  d.fotosDanios.forEach((f, i) => add(f, `Danios-${i + 1}-${d.patente}`));
  d.terceros.forEach((t, i) => (t.docs || []).forEach((f, j) => add(f, `Tercero${i + 1}-Papeles-${j + 1}`)));
  return out;
}

export function buildEmail(d, ref) {
  const sentAt = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }).format(new Date());
  const unk = (v) => (v === null ? "Desconocido" : v);
  const opt = (v) => v || "No informado";
  const files = attachmentsFor(d);
  const conConductor = CON_CONDUCTOR.includes(d.tipo);
  const L = [];
  const sec = (t) => { L.push(""); L.push(t); };

  L.push(`DENUNCIA DE SINIESTRO ${ref}`);
  L.push(`Enviada desde segurosarnedo.com el ${sentAt} (hora de Argentina).`);
  L.push(`Plazo legal de 3 días (Ley 17.418) contado desde la fecha del hecho: vence el ${dmy(plusDays(d.fecha, 3))}.`);
  sec("TIPO DE SINIESTRO");
  L.push(`Tipo: ${TIPOS[d.tipo]}`);
  sec("DATOS DEL ASEGURADO");
  L.push(`Apellido y nombre: ${d.asegurado_nombre}`);
  L.push(`Teléfono o celular: ${d.asegurado_telefono}`);
  L.push(`Correo electrónico: ${opt(d.asegurado_email)}`);
  L.push(`Compañía aseguradora: ${d.compania}`);
  L.push(`Número de póliza: ${opt(d.poliza)}`);
  sec("DATOS DEL SINIESTRO");
  L.push(`Fecha: ${dmy(d.fecha)}`);
  L.push(`Hora: ${d.hora}`);
  L.push(`Dirección del hecho: ${d.direccion}`);
  if (d.tipo === "choque") {
    L.push(`Por dónde circulaba y hacia dónde: ${d.circulacion}`);
    L.push(`Qué hizo el otro vehículo o qué provocó el hecho: ${d.otro_vehiculo}`);
    L.push(`Parte del vehículo donde fue el impacto: ${d.impacto}`);
  }
  L.push(`Relato de los hechos: ${d.relato}`);
  sec("LESIONADOS, POLICÍA Y TESTIGOS");
  L.push(`¿Hubo personas lesionadas?: ${siNo(d.lesionados)}`);
  if (d.lesionados === "si") L.push(`Detalle de lesionados: ${d.lesionados_detalle}`);
  L.push(`¿Intervino la policía o hay denuncia policial?: ${siNo(d.policia)}`);
  if (d.policia === "si") L.push(`Comisaría y número de denuncia: ${opt(d.policia_detalle)}`);
  L.push(`¿Hubo testigos?: ${siNo(d.testigos)}`);
  if (d.testigos === "si") L.push(`Testigos: ${d.testigos_detalle}`);
  if (conConductor) {
    sec("DATOS DEL CONDUCTOR");
    L.push(`¿El asegurado conducía el vehículo?: ${siNo(d.asegurado_conducia)}`);
    if (d.asegurado_conducia === "no") {
      L.push(`Apellido y nombre: ${d.conductor_nombre}`);
      L.push(`DNI: ${d.conductor_dni}`);
      L.push(`Fecha de nacimiento: ${dmy(d.conductor_nacimiento)}`);
      L.push(`Teléfono o celular: ${d.conductor_telefono}`);
      L.push(`Domicilio: ${d.conductor_domicilio}`);
    }
  }
  sec("VEHÍCULO ASEGURADO");
  L.push(`Patente: ${d.patente}`);
  L.push(`Daños del vehículo: ${d.danios}`);
  L.push(`Fotos de los daños y del lugar: ${d.fotosDanios.length ? `${d.fotosDanios.length} adjunta(s)` : "No se enviaron"}`);
  if (conConductor) {
    sec("TERCEROS INVOLUCRADOS");
    L.push(`¿Hubo terceros involucrados?: ${d.hubo_terceros === "si" ? `Sí (${d.terceros.length})` : "No"}`);
    d.terceros.forEach((t, i) => {
      L.push("");
      L.push(`Tercero ${i + 1}`);
      for (const [k, label] of TERCERO_FIELDS) L.push(`${label}: ${unk(t[k])}`);
      L.push(`Fotos de sus papeles: ${t.docs.length ? `${t.docs.length} adjunta(s)` : "No se enviaron"}`);
    });
    sec("FOTOS DEL CARNET DE CONDUCIR");
    L.push(`Frente: adjunto «Carnet-FRENTE-${d.patente}.${d.carnet.frente.ext}»`);
    L.push(`Dorso: adjunto «Carnet-DORSO-${d.patente}.${d.carnet.dorso.ext}»`);
    L.push(`Corresponden a la persona que conducía: ${d.asegurado_conducia === "si" ? `el asegurado (${d.asegurado_nombre})` : d.conductor_nombre}.`);
  }
  sec("ARCHIVOS ADJUNTOS");
  files.forEach((f) => L.push(`- ${f.filename}`));
  if (!files.length) L.push("- Ninguno");
  L.push("");
  L.push("La persona aceptó el uso de sus datos para gestionar la denuncia (Ley 25.326).");

  return {
    subject: `Denuncia de siniestro | Patente ${d.patente} | ${dmy(d.fecha)} | ${ref}`,
    text: L.join("\n"),
    attachments: files,
    replyTo: d.asegurado_email || undefined,
  };
}

function buildClientCopy(d, ref, email) {
  const text = [
    `Hola, ${d.asegurado_nombre}:`,
    "",
    `Recibimos tu denuncia de siniestro. Tu número de denuncia es ${ref}.`,
    "Juan Manuel la va a revisar y se va a comunicar con vos para los próximos pasos.",
    "",
    `Recordá: la Ley de Seguros (17.418) fija 3 días desde que conocés el siniestro para comunicarlo a la compañía. Contando desde la fecha del hecho, vence el ${dmy(plusDays(d.fecha, 3))}.`,
    "",
    "Este es un resumen de lo que enviaste (las fotos no se incluyen en esta copia):",
    "",
    email.text.split("\n").slice(3).join("\n"),
    "",
    "JMA Seguros · Juan Manuel Arnedo, Productor Asesor de Seguros (Matrícula SSN N° 86525)",
    "WhatsApp: +54 9 351 516-1257",
  ].join("\n");
  return { subject: `Recibimos tu denuncia de siniestro ${ref}`, text };
}

/* ---------- Envío (Resend) ---------- */
export async function sendWithResend(msg, env, fetchImpl = fetch) {
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${String(env.RESEND_API_KEY).trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.DENUNCIA_FROM || DEFAULT_FROM,
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
  if (!res.ok || !body.id) {
    const err = new Error(`Resend respondió ${res.status}: ${body.message || body.name || "sin detalle"}`);
    err.status = res.status;
    throw err;
  }
  return body.id;
}

/* ---------- Registro opcional en Google Sheets ---------- */
async function logToSheets(d, ref, env, fetchImpl) {
  if (!env.SHEETS_WEBHOOK_URL) return;
  const row = {
    token: env.SHEETS_TOKEN || "",
    ref,
    enviada: new Intl.DateTimeFormat("es-AR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }).format(new Date()),
    tipo: TIPOS[d.tipo],
    asegurado: d.asegurado_nombre,
    telefono: d.asegurado_telefono,
    email: d.asegurado_email || "",
    compania: d.compania,
    poliza: d.poliza || "",
    patente: d.patente,
    fecha_hecho: dmy(d.fecha),
    hora: d.hora,
    direccion: d.direccion,
    lesionados: siNo(d.lesionados),
    policia: siNo(d.policia),
    terceros: d.terceros.length,
    plazo_vence: dmy(plusDays(d.fecha, 3)),
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
  // Consulta de estado: el formulario la usa para avisar si el envío no está habilitado.
  if (req.method === "GET") return json(200, { ok: true, configurado: Boolean(String(env.RESEND_API_KEY || "").trim()) });
  if (req.method !== "POST") return json(405, { ok: false, message: "Método no permitido." });
  if (!originAllowed(req.headers.get("origin"), env)) return json(403, { ok: false, message: "Origen no permitido." });
  const len = Number(req.headers.get("content-length") || 0);
  if (len > LIMITS.body) return json(413, { ok: false, message: "Las fotos son demasiado pesadas. Quitá alguna o probá con fotos más livianas." });

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

  const ref = makeRef(data);
  const email = buildEmail(data, ref);
  try {
    const id = await sendWithResend({ ...email, to: env.DENUNCIA_TO || DEFAULT_TO }, env, fetchImpl);
    console.log(`[denuncia] ${ref} enviada (${id})`);
  } catch (err) {
    console.error("[denuncia] Error al enviar:", err.message);
    return json(502, { ok: false, message: "No pudimos enviar la denuncia en este momento." });
  }

  // Extras opcionales: si fallan, la denuncia ya fue entregada igual.
  const extras = [];
  if (env.DENUNCIA_COPIA_CLIENTE === "si" && data.asegurado_email) {
    const copy = buildClientCopy(data, ref, email);
    extras.push(sendWithResend({ ...copy, to: data.asegurado_email }, env, fetchImpl)
      .catch((e) => console.error(`[denuncia] ${ref} copia al cliente no enviada:`, e.message)));
  }
  extras.push(logToSheets(data, ref, env, fetchImpl)
    .catch((e) => console.error(`[denuncia] ${ref} no se registró en Sheets:`, e.message)));
  await Promise.all(extras);

  return json(200, { ok: true, ref });
}
