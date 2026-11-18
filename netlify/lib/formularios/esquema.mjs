// Tipos de campo, validación de formularios y respuestas, y plantillas.

export const RAMOS = [
  "Automotor", "Motocicletas", "Hogar", "Comercio", "Accidentes personales", "Seguro de vida",
  "Integral de consorcio", "Responsabilidad civil", "Caución", "Seguros para empresas", "Otro",
];

export const ESTADOS = [
  { id: "pendiente", label: "Pendiente de revisión" },
  { id: "incompleta", label: "Documentación incompleta" },
  { id: "completa", label: "Documentación completa" },
  { id: "emision", label: "En proceso de emisión" },
  { id: "emitido", label: "Emitido" },
];

export const TIPOS = {
  text: "Texto corto",
  textarea: "Texto largo",
  number: "Número",
  dni: "DNI",
  tel: "Teléfono",
  email: "Correo electrónico",
  date: "Fecha",
  select: "Opciones (elegir una)",
  photo: "Foto (cámara o galería)",
  document: "Documento (PDF o foto)",
  cbu: "CBU (22 números)",
  card: "Número de tarjeta",
  consent: "Casilla de aceptación",
  note: "Aclaración (solo texto)",
};

export const ILUSTRACIONES = ["", "frente", "trasera", "izquierdo", "derecho", "cedula"];
export const ROLES = ["", "nombre", "dni", "telefono", "email"];
export const SENSIBLES = new Set(["cbu", "card"]);
export const ARCHIVOS = new Set(["photo", "document"]);
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

const clip = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const clipText = (v, n) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, n);
const digits = (v) => String(v ?? "").replace(/\D/g, "");

// ---------- Validadores ----------
export function cbuValido(v) {
  const d = digits(v);
  if (d.length !== 22) return false;
  const n = d.split("").map(Number);
  const w1 = [7, 1, 3, 9, 7, 1, 3];
  const s1 = w1.reduce((a, w, i) => a + w * n[i], 0);
  if ((10 - (s1 % 10)) % 10 !== n[7]) return false;
  const w2 = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3];
  const s2 = w2.reduce((a, w, i) => a + w * n[8 + i], 0);
  return (10 - (s2 % 10)) % 10 === n[21];
}

export function luhn(v) {
  const d = digits(v);
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let x = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) { x *= 2; if (x > 9) x -= 9; }
    sum += x;
  }
  return d.length > 0 && sum % 10 === 0;
}

// Tarjeta Naranja (BIN 589562) no usa el dígito verificador de Luhn.
export function tarjetaValida(v) {
  const d = digits(v);
  if (d.length < 15 || d.length > 16) return false;
  return d.startsWith("589562") || luhn(d);
}

export const mask = (v) => "•••• " + digits(v).slice(-4);

// ---------- Normalización del formulario (lo que guarda el panel) ----------
function slugId(v, used) {
  let id = String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  if (!id || !/^[a-z]/.test(id)) id = "campo_" + (id || used.size + 1);
  let k = id, i = 2;
  while (used.has(k)) k = id + "_" + i++;
  used.add(k);
  return k;
}

export function normalizeForm(input) {
  const errors = [];
  const used = new Set();
  const title = clip(input.title, 120);
  if (!title) errors.push("El formulario necesita un título.");
  const sectionsIn = Array.isArray(input.sections) ? input.sections.slice(0, 20) : [];
  const sections = sectionsIn.map((s, si) => {
    const fieldsIn = Array.isArray(s.fields) ? s.fields.slice(0, 60) : [];
    return {
      id: "s" + (si + 1),
      title: clip(s.title, 100) || "Sección " + (si + 1),
      description: clipText(s.description, 600),
      fields: fieldsIn.map((f) => {
        const type = Object.prototype.hasOwnProperty.call(TIPOS, f.type) ? f.type : "text";
        const field = {
          id: slugId(f.id || f.label, used),
          type,
          label: type === "note" ? clipText(f.label, 1200) : clip(f.label, 200),
          help: clipText(f.help, 500),
          required: type === "note" ? false : !!f.required,
          width: f.width === "half" ? "half" : "full",
        };
        if (!field.label) errors.push(`Hay un campo sin texto en «${clip(s.title, 60) || "Sección " + (si + 1)}».`);
        if (["text", "textarea", "number", "dni", "tel", "email", "cbu", "card"].includes(type)) field.placeholder = clip(f.placeholder, 80);
        if (type === "select") {
          field.options = (Array.isArray(f.options) ? f.options : String(f.options || "").split("\n")).map((o) => clip(o, 80)).filter(Boolean).slice(0, 30);
          field.options = [...new Set(field.options)];
          if (field.options.length < 2) errors.push(`«${field.label || "Opciones"}» necesita al menos dos opciones.`);
        }
        if (type === "number") {
          if (f.min !== "" && f.min != null && !isNaN(Number(f.min))) field.min = Number(f.min);
          if (f.max !== "" && f.max != null && !isNaN(Number(f.max))) field.max = Number(f.max);
        }
        if (ARCHIVOS.has(type)) {
          field.max = Math.min(5, Math.max(1, parseInt(f.max, 10) || 1));
          field.illustration = type === "photo" && ILUSTRACIONES.includes(f.illustration) ? f.illustration : "";
        }
        if (type === "consent") field.link = /^\/[\w./#-]*$/.test(String(f.link || "")) ? f.link : "/pages/privacidad.html";
        if (type === "note") field.variant = f.variant === "warning" ? "warning" : "info";
        field.role = ROLES.includes(f.role) ? f.role : "";
        if (f.show && f.show.field && f.show.value) field.show = { field: String(f.show.field).slice(0, 40), value: clip(f.show.value, 80) };
        return field;
      }),
    };
  });
  if (!sections.length || !sections.some((s) => s.fields.some((f) => f.type !== "note"))) errors.push("Agregá al menos un campo.");
  // Las condiciones tienen que apuntar a un campo de opciones existente.
  const all = sections.flatMap((s) => s.fields);
  for (const f of all) {
    if (!f.show) continue;
    const ref = all.find((x) => x.id === f.show.field);
    if (!ref || ref.type !== "select" || !ref.options.includes(f.show.value) || ref.id === f.id) delete f.show;
  }
  const ramo = RAMOS.includes(input.ramo) ? input.ramo : "Otro";
  return {
    errors,
    form: {
      title,
      description: clipText(input.description, 1500),
      ramo,
      submitLabel: clip(input.submitLabel, 40) || "Enviar información",
      successMessage: clipText(input.successMessage, 800) || "¡Muchas gracias! Recibimos tu información.",
      sections,
    },
  };
}

// Lo que ve el cliente: sin datos internos.
export function publicForm(form) {
  return {
    title: form.title,
    description: form.description,
    ramo: form.ramo,
    submitLabel: form.submitLabel,
    successMessage: form.successMessage,
    sections: form.sections,
  };
}

// ---------- Validación de una respuesta ----------
// values: { campo: valor }, fileIndex: { fileId: { field, size, type } } de los archivos subidos en este borrador.
export function validateSubmission(form, values, fileIndex, encryptFn) {
  const errors = {};
  const data = {};
  const files = {};
  const enc = {};
  const summary = { nombre: "", dni: "", telefono: "", email: "" };
  const all = form.sections.flatMap((s) => s.fields);
  const raw = values && typeof values === "object" ? values : {};
  const visible = (f) => !f.show || clip(raw[f.show.field], 80) === f.show.value;

  for (const f of all) {
    if (f.type === "note" || !visible(f)) continue;
    const v = raw[f.id];
    const empty = v == null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length) || v === false;
    if (empty) { if (f.required) errors[f.id] = f.type === "consent" ? "Tenés que aceptar para continuar." : ARCHIVOS.has(f.type) ? "Falta este archivo." : "Completá este dato."; continue; }
    let out;
    switch (f.type) {
      case "text": out = clip(v, 200); break;
      case "textarea": out = clipText(v, 2000); break;
      case "number": {
        const n = Number(String(v).replace(/\./g, "").replace(",", "."));
        if (!isFinite(n)) { errors[f.id] = "Ingresá un número."; continue; }
        if (f.min != null && n < f.min) { errors[f.id] = `Tiene que ser ${f.min} o más.`; continue; }
        if (f.max != null && n > f.max) { errors[f.id] = `Tiene que ser ${f.max} o menos.`; continue; }
        out = String(n); break;
      }
      case "dni": { const d = digits(v); if (d.length < 7 || d.length > 8) { errors[f.id] = "Ingresá un DNI válido (7 u 8 números)."; continue; } out = d; break; }
      case "tel": { const d = digits(v); if (d.length < 8 || d.length > 15) { errors[f.id] = "Ingresá un teléfono con código de área."; continue; } out = clip(v, 30); break; }
      case "email": { const e = clip(v, 120).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) { errors[f.id] = "Revisá el correo electrónico."; continue; } out = e; break; }
      case "date": { const s = clip(v, 10); const ok = /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z")); if (!ok) { errors[f.id] = "Ingresá una fecha válida."; continue; } out = s; break; }
      case "select": { const s = clip(v, 80); if (!f.options.includes(s)) { errors[f.id] = "Elegí una opción."; continue; } out = s; break; }
      case "consent": out = v === true || v === "true" || v === "si" ? "Aceptado" : null; if (!out) { if (f.required) errors[f.id] = "Tenés que aceptar para continuar."; continue; } break;
      case "cbu": {
        const d = digits(v);
        if (d.length !== 22) { errors[f.id] = "El CBU tiene 22 números."; continue; }
        if (!cbuValido(d)) { errors[f.id] = "El CBU no es válido. Revisá los números."; continue; }
        enc[f.id] = encryptFn(d); out = mask(d); break;
      }
      case "card": {
        const d = digits(v);
        if (d.length < 15 || d.length > 16) { errors[f.id] = "El número de tarjeta tiene 16 números (15 en American Express)."; continue; }
        if (!tarjetaValida(d)) { errors[f.id] = "El número de tarjeta no es válido. Revisalo."; continue; }
        enc[f.id] = encryptFn(d); out = mask(d); break;
      }
      case "photo":
      case "document": {
        const ids = (Array.isArray(v) ? v : [v]).map(String).slice(0, f.max);
        const okIds = ids.filter((id) => fileIndex[id] && fileIndex[id].field === f.id);
        if (okIds.length !== ids.length) { errors[f.id] = "Volvé a cargar este archivo."; continue; }
        files[f.id] = okIds; out = okIds.length + (okIds.length === 1 ? " archivo" : " archivos"); break;
      }
      default: continue;
    }
    data[f.id] = out;
    if (f.role && !summary[f.role]) summary[f.role] = f.type === "cbu" || f.type === "card" ? "" : out;
  }
  return { errors, data, files, enc, summary };
}

// ---------- Plantillas ----------
export function plantillaAltaAutomotor() {
  return {
    title: "Solicitud de alta – Seguro automotor",
    ramo: "Automotor",
    description: "¡Perfecto! Para gestionar el alta de tu seguro automotor, necesito que completes los siguientes datos y adjuntes la documentación solicitada.",
    submitLabel: "Enviar información",
    successMessage: "¡Muchas gracias! Recibimos correctamente tu información y documentación. Vamos a revisar los datos para avanzar con la emisión de tu póliza. Si necesitamos información adicional, nos comunicaremos con vos.",
    sections: [
      {
        title: "Datos del tomador",
        description: "La persona que contrata el seguro.",
        fields: [
          { id: "nombre", type: "text", label: "Nombre y apellido", required: true, role: "nombre", placeholder: "Como figura en el DNI" },
          { id: "dni", type: "dni", label: "DNI del tomador", required: true, role: "dni", placeholder: "Sin puntos", width: "half" },
          { id: "telefono", type: "tel", label: "Teléfono de contacto", required: true, role: "telefono", placeholder: "Ej.: 351 555-1234", width: "half" },
          { id: "email", type: "email", label: "Correo electrónico", required: true, role: "email", placeholder: "nombre@correo.com" },
          { id: "domicilio", type: "text", label: "Domicilio completo", required: true, placeholder: "Calle, número, piso y depto." },
          { id: "localidad", type: "text", label: "Localidad", required: true, width: "half" },
          { id: "provincia", type: "text", label: "Provincia", required: true, placeholder: "Ej.: Córdoba", width: "half" },
        ],
      },
      {
        title: "Fotos del vehículo",
        description: "Sacá las fotos a plena luz, con el auto completo en cada toma y sin cortes. Podés tomarlas con la cámara o elegirlas de la galería.",
        fields: [
          { id: "foto_frente", type: "photo", label: "Frente completo", required: true, illustration: "frente", width: "half" },
          { id: "foto_trasera", type: "photo", label: "Parte trasera completa", required: true, illustration: "trasera", width: "half" },
          { id: "foto_lateral_izq", type: "photo", label: "Lateral izquierdo completo", required: true, illustration: "izquierdo", width: "half" },
          { id: "foto_lateral_der", type: "photo", label: "Lateral derecho completo", required: true, illustration: "derecho", width: "half" },
          { id: "cedula_frente", type: "photo", label: "Cédula del vehículo (tarjeta verde) – frente", required: true, illustration: "cedula", width: "half" },
          { id: "cedula_dorso", type: "photo", label: "Cédula del vehículo (tarjeta verde) – dorso", required: false, illustration: "cedula", width: "half" },
        ],
      },
      {
        title: "Forma de pago",
        description: "Elegí cómo querés abonar la póliza. Tus datos de pago se guardan cifrados.",
        fields: [
          { id: "forma_pago", type: "select", label: "Forma de pago", required: true, options: ["Débito por CBU", "Tarjeta de crédito"] },
          { id: "nota_cvu", type: "note", variant: "warning", label: "Por disposiciones operativas y de las entidades bancarias con las que trabajamos, no se admiten CVU de billeteras virtuales para la adhesión al débito automático. Se requiere CBU bancario.", show: { field: "forma_pago", value: "Débito por CBU" } },
          { id: "banco", type: "text", label: "Banco", required: true, placeholder: "Ej.: Banco de Córdoba", show: { field: "forma_pago", value: "Débito por CBU" } },
          { id: "cbu", type: "cbu", label: "CBU (22 números)", required: true, placeholder: "22 números, sin espacios", show: { field: "forma_pago", value: "Débito por CBU" } },
          { id: "tarjeta_tipo", type: "select", label: "Tarjeta", required: true, options: ["Visa", "Mastercard", "American Express", "Cabal", "Naranja", "Otra"], show: { field: "forma_pago", value: "Tarjeta de crédito" } },
          { id: "tarjeta_numero", type: "card", label: "Número de la tarjeta", required: true, placeholder: "16 números", help: "No te pedimos el código de seguridad ni la fecha de vencimiento.", show: { field: "forma_pago", value: "Tarjeta de crédito" } },
        ],
      },
      {
        title: "Autorización y envío",
        fields: [
          { id: "acepto", type: "consent", label: "Leí y acepto la política de privacidad y el tratamiento de mis datos personales para la gestión de mi seguro.", required: true, link: "/pages/privacidad.html" },
        ],
      },
    ],
  };
}

export function plantillaEnBlanco() {
  return {
    title: "Nuevo formulario",
    ramo: "Otro",
    description: "",
    submitLabel: "Enviar información",
    successMessage: "¡Muchas gracias! Recibimos correctamente tu información. Si necesitamos algo más, nos comunicaremos con vos.",
    sections: [
      { title: "Tus datos", fields: [
        { id: "nombre", type: "text", label: "Nombre y apellido", required: true, role: "nombre" },
        { id: "dni", type: "dni", label: "DNI", required: true, role: "dni", width: "half" },
        { id: "telefono", type: "tel", label: "Teléfono", required: true, role: "telefono", width: "half" },
      ] },
      { title: "Autorización y envío", fields: [
        { id: "acepto", type: "consent", label: "Leí y acepto la política de privacidad y el tratamiento de mis datos personales para la gestión de mi seguro.", required: true, link: "/pages/privacidad.html" },
      ] },
    ],
  };
}

export const PLANTILLAS = { alta_automotor: plantillaAltaAutomotor, en_blanco: plantillaEnBlanco };

// ---------- Archivos ----------
export function sniffFile(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", type: "image/jpeg", image: true };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png", type: "image/png", image: true };
  const s = String.fromCharCode(...b.slice(0, 12));
  if (s.startsWith("RIFF") && s.slice(8, 12) === "WEBP") return { ext: "webp", type: "image/webp", image: true };
  if (s.slice(4, 8) === "ftyp" && /^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(s.slice(8, 12))) return { ext: "heic", type: "image/heic", image: true };
  if (s.startsWith("%PDF-")) return { ext: "pdf", type: "application/pdf", image: false };
  return null;
}
