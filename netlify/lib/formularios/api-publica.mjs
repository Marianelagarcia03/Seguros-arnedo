// API pública de los formularios para clientes: /api/f/<enlace>[/archivo|/enviar]
// El cliente no inicia sesión: el enlace (aleatorio) identifica el formulario y
// cada visita recibe un "borrador" firmado al que se asocian los archivos.

import { getStore } from "./store.mjs";
import { json, randomId, sign, verifySigned, ipKey, rateLimit, encrypt, configStatus } from "./seguridad.mjs";
import { publicForm, validateSubmission, sniffFile, ARCHIVOS, MAX_FILE_BYTES } from "./esquema.mjs";

const DRAFT_HOURS = 8;
const SLUG_RE = /^[A-Za-z0-9_-]{16,40}$/;
const ID_RE = /^[A-Za-z0-9_-]{10,40}$/;

async function formBySlug(store, slug) {
  if (!SLUG_RE.test(slug)) return null;
  const ref = await store.getJSON("slugs/" + slug);
  if (!ref) return null;
  const form = await store.getJSON("forms/" + ref.formId);
  if (!form || form.slug !== slug) return null;
  return form;
}

const noDisponible = () => json({ ok: false, error: "Este formulario no está disponible. Consultanos por WhatsApp al 351 516-1257." }, 404);

function draftFrom(req, slug, env) {
  const p = verifySigned(req.headers.get("x-borrador"), env);
  return p && p.k === "d" && p.s === slug && ID_RE.test(p.d) ? p.d : null;
}

export async function handle(req, env = process.env, fetchImpl = fetch) {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/f\/?/, "").split("/").filter(Boolean);
  const [slug, accion] = parts;
  if (!slug) return noDisponible();
  if (configStatus(env).some((k) => k === "SESSION_SECRET" || k === "DATA_KEY")) {
    return json({ ok: false, error: "El formulario todavía no está habilitado. Consultanos por WhatsApp al 351 516-1257." }, 503);
  }
  const store = await getStore(env);

  // Ver el formulario y obtener un borrador.
  if (req.method === "GET" && !accion) {
    const form = await formBySlug(store, slug);
    if (!form || !form.active) return noDisponible();
    const d = randomId(16);
    const token = sign({ k: "d", s: slug, d, exp: Date.now() + DRAFT_HOURS * 3600 * 1000 }, env);
    return json({ ok: true, form: publicForm(form), borrador: token });
  }

  // Subir un archivo (de a uno; el navegador ya achicó las fotos).
  if (req.method === "POST" && accion === "archivo") {
    const draft = draftFrom(req, slug, env);
    if (!draft) return json({ ok: false, error: "La página estuvo abierta mucho tiempo. Recargala para seguir." }, 401);
    const lim = await rateLimit(store, "up/" + ipKey(req, env), 80, 3600 * 1000);
    if (!lim.ok) return json({ ok: false, error: "Demasiados archivos en poco tiempo. Probá de nuevo más tarde." }, 429);
    const form = await formBySlug(store, slug);
    if (!form || !form.active) return noDisponible();
    const field = form.sections.flatMap((s) => s.fields).find((f) => f.id === url.searchParams.get("campo"));
    if (!field || !ARCHIVOS.has(field.type)) return json({ ok: false, error: "Campo inválido." }, 400);
    const existing = await store.list(`filemeta/${draft}/`);
    if (existing.length >= 40) return json({ ok: false, error: "Se alcanzó el máximo de archivos. Recargá la página." }, 429);
    const len = Number(req.headers.get("content-length") || 0);
    if (len > MAX_FILE_BYTES) return json({ ok: false, error: "El archivo es muy pesado (máximo 4 MB)." }, 413);
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length) return json({ ok: false, error: "El archivo está vacío." }, 400);
    if (bytes.length > MAX_FILE_BYTES) return json({ ok: false, error: "El archivo es muy pesado (máximo 4 MB)." }, 413);
    const kind = sniffFile(bytes);
    if (!kind || (field.type === "photo" && !kind.image)) {
      return json({ ok: false, error: field.type === "photo" ? "Ese archivo no es una foto. Probá con otra." : "Solo se aceptan PDF o fotos (JPG, PNG, WEBP o HEIC)." }, 415);
    }
    const fileId = randomId(12);
    const meta = { field: field.id, type: kind.type, ext: kind.ext, size: bytes.length, at: Date.now(), slug };
    await store.setBytes(`files/${draft}/${fileId}`, bytes, meta);
    await store.setJSON(`filemeta/${draft}/${fileId}`, meta);
    return json({ ok: true, id: fileId });
  }

  // Enviar la respuesta.
  if (req.method === "POST" && accion === "enviar") {
    let body;
    try { body = await req.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    const draft = draftFrom(new Request(req.url, { headers: { "x-borrador": body && body.borrador } }), slug, env);
    if (!draft) return json({ ok: false, error: "La página estuvo abierta mucho tiempo. Recargala para seguir (tus datos no se envían hasta que tocás Enviar)." }, 401);
    const form = await formBySlug(store, slug);
    if (!form || !form.active) return noDisponible();

    // Doble envío: devolver el mismo resultado.
    const prev = await store.getJSON("subs/" + draft);
    if (prev) return json({ ok: true, ref: prev.ref, mensaje: form.successMessage });

    if (body.website) return json({ ok: true, ref: "", mensaje: form.successMessage }); // trampa para robots
    const lim = await rateLimit(store, "send/" + ipKey(req, env), 12, 3600 * 1000);
    if (!lim.ok) return json({ ok: false, error: "Recibimos muchos envíos desde tu conexión. Probá de nuevo en un rato." }, 429);

    const metaKeys = await store.list(`filemeta/${draft}/`);
    const fileIndex = {};
    for (const k of metaKeys) {
      const m = await store.getJSON(k);
      if (m) fileIndex[k.split("/").pop()] = m;
    }
    const v = validateSubmission(form, body.valores, fileIndex, (t) => encrypt(t, env));
    if (Object.keys(v.errors).length) return json({ ok: false, errors: v.errors }, 422);

    // Borra los archivos subidos que el cliente reemplazó o quitó.
    const used = new Set(Object.values(v.files).flat());
    for (const id of Object.keys(fileIndex)) {
      if (!used.has(id)) { await store.del(`files/${draft}/${id}`); await store.del(`filemeta/${draft}/${id}`); }
    }

    const now = new Date();
    const ref = "SOL-" + now.toISOString().slice(0, 10).replace(/-/g, "") + "-" + draft.slice(0, 5).toUpperCase();
    const files = {};
    for (const [fid, ids] of Object.entries(v.files)) {
      files[fid] = ids.map((id) => ({ id, type: fileIndex[id].type, ext: fileIndex[id].ext, size: fileIndex[id].size }));
    }
    const sub = {
      id: draft,
      ref,
      formId: form.id,
      formTitle: form.title,
      ramo: form.ramo,
      createdAt: now.toISOString(),
      status: "pendiente",
      nota: "",
      summary: v.summary,
      data: v.data,
      enc: v.enc,
      files,
      campos: form.sections.map((s) => ({ title: s.title, fields: s.fields.filter((f) => f.type !== "note").map((f) => ({ id: f.id, label: f.label, type: f.type })) })),
      log: [{ at: now.toISOString(), accion: "Recibida" }],
    };
    await store.setJSON("subs/" + draft, sub);
    await store.setJSON("subidx/" + draft, indexEntry(sub));
    await notify(form, sub, env, fetchImpl).catch(() => {});
    return json({ ok: true, ref, mensaje: form.successMessage });
  }

  return json({ ok: false, error: "No encontrado." }, 404);
}

export function indexEntry(sub) {
  return {
    id: sub.id, ref: sub.ref, formId: sub.formId, formTitle: sub.formTitle, ramo: sub.ramo,
    createdAt: sub.createdAt, status: sub.status, nombre: sub.summary.nombre || "", dni: sub.summary.dni || "",
  };
}

// Aviso por correo sin datos personales: solo que llegó algo y el enlace al panel.
async function notify(form, sub, env, fetchImpl) {
  const key = (env.RESEND_API_KEY || "").trim();
  if (!key) return;
  const to = env.FORMULARIOS_AVISO_A || env.DENUNCIA_TO || "juanmanuelarnedo@gmail.com";
  const from = env.FORMULARIOS_FROM || env.COTIZACION_FROM || env.DENUNCIA_FROM || "JMA Seguros <onboarding@resend.dev>";
  const base = (env.URL || "https://segurosarnedo.com").replace(/\/$/, "");
  const link = `${base}/admin/formularios#/respuestas/${sub.id}`;
  const text = `Llegó una nueva respuesta al formulario «${form.title}».\n\nReferencia: ${sub.ref}\nRamo: ${form.ramo}\n\nVer la respuesta en el panel (requiere iniciar sesión):\n${link}\n\nEste aviso no incluye datos personales.`;
  await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "idempotency-key": "form-" + sub.id },
    body: JSON.stringify({ from, to: [to], subject: `Nueva solicitud: ${form.title} (${sub.ref})`, text }),
  });
}
