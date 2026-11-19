// Registro de cotizaciones y denuncias en Google Sheets a través de un formulario de Google.
// No requiere autorizaciones: el formulario «Registro web SegurosArnedo (uso interno)» guarda cada
// envío en la planilla «Registro web SegurosArnedo» (cuenta jma.seguroscba@gmail.com).
// Usa el formulario por defecto; la variable de entorno SHEETS_FORM_ID permite cambiarlo
// (el código largo de docs.google.com/forms/d/e/<ID>/viewform) o apagarlo con SHEETS_FORM_ID=off.
export const FORM_ID_DEFAULT = "1FAIpQLSc6I2jjXaGcFVTJbC7hA3wIvpWOe4vfS7o4Ll2BqZ5F0ZLq5Q";
export const formId = (env) => {
  const v = String(env.SHEETS_FORM_ID ?? "").trim();
  if (v.toLowerCase() === "off") return "";
  return v || FORM_ID_DEFAULT;
};

// Identificador de cada pregunta del formulario (no son secretos).
const CAMPOS = {
  hoja: "entry.118978874",
  ref: "entry.545487511",
  enviada: "entry.223815013",
  tipo: "entry.2039314865",
  nombre: "entry.1156523578",
  telefono: "entry.2030217499",
  email: "entry.1415419668",
  localidad: "entry.1371015405",
  detalle: "entry.652654581",
  origen: "entry.1416890480",
};

// Evita que un texto que empieza con =, +, - o @ se tome como fórmula en la planilla.
const seguro = (v) => {
  const s = String(v ?? "").slice(0, 20000);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
};

export function formBody(fila) {
  const p = new URLSearchParams();
  for (const [k, entry] of Object.entries(CAMPOS)) p.set(entry, seguro(fila[k]));
  return p.toString();
}

export async function enviarAPlanilla(fila, env, fetchImpl = fetch) {
  const id = formId(env);
  if (!/^[A-Za-z0-9_-]{20,120}$/.test(id)) return false;
  const res = await fetchImpl(`https://docs.google.com/forms/d/e/${id}/formResponse`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: formBody(fila),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Formulario de Google respondió ${res.status}`);
  return true;
}
