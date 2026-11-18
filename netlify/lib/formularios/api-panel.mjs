// API del panel privado: /api/admin/...
// Todo, salvo /estado y /login, exige la cookie de sesión firmada.

import { getStore, getMany } from "./store.mjs";
import {
  json, randomId, configStatus, verifyPassword, checkUser, sessionCookie, clearCookie,
  readSession, sameOrigin, ipKey, rateLimit, resetLimit, decrypt,
} from "./seguridad.mjs";
import { normalizeForm, PLANTILLAS, ESTADOS, RAMOS, TIPOS, ILUSTRACIONES, mask } from "./esquema.mjs";
import { indexEntry } from "./api-publica.mjs";

const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const newSlug = () => randomId(16); // 22 caracteres aleatorios: imposible de adivinar

async function listForms(store) {
  const keys = await store.list("forms/");
  return (await getMany(store, keys)).filter(Boolean);
}

async function listIndex(store) {
  const keys = await store.list("subidx/");
  return (await getMany(store, keys)).filter(Boolean).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

async function saveSub(store, sub) {
  await store.setJSON("subs/" + sub.id, sub);
  await store.setJSON("subidx/" + sub.id, indexEntry(sub));
}

function formOut(f, counts) {
  return {
    id: f.id, slug: f.slug, title: f.title, ramo: f.ramo, active: f.active, createdAt: f.createdAt,
    updatedAt: f.updatedAt, respuestas: counts[f.id] || 0,
  };
}

async function createForm(store, base, extra = {}) {
  const { errors, form } = normalizeForm(base);
  if (errors.length) return { errors };
  const now = new Date().toISOString();
  const f = { ...form, id: randomId(9), slug: newSlug(), active: true, createdAt: now, updatedAt: now, ...extra };
  await store.setJSON("forms/" + f.id, f);
  await store.setJSON("slugs/" + f.slug, { formId: f.id });
  return { form: f };
}

const safeName = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export async function handle(req, env = process.env) {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/admin\/?/, "").split("/").filter(Boolean);
  const m = req.method;
  const faltan = configStatus(env);

  if (parts[0] === "estado" && m === "GET") {
    const s = faltan.length ? null : readSession(req, env);
    return json({ ok: true, faltan, sesion: !!s, usuario: s ? s.u : null });
  }
  if (faltan.length) return json({ ok: false, error: "El panel todavía no está configurado.", faltan }, 503);
  if (!sameOrigin(req)) return json({ ok: false, error: "Origen no permitido." }, 403);
  const store = await getStore(env);

  if (parts[0] === "login" && m === "POST") {
    let b = {};
    try { b = await req.json(); } catch {}
    const ipLim = await rateLimit(store, "login-ip/" + ipKey(req, env), 8, 15 * 60 * 1000);
    const allLim = await rateLimit(store, "login-all", 30, 15 * 60 * 1000);
    if (!ipLim.ok || !allLim.ok) {
      const wait = Math.max(ipLim.ok ? 0 : ipLim.retryAfter, allLim.ok ? 0 : allLim.retryAfter);
      return json({ ok: false, error: `Demasiados intentos. Esperá ${Math.ceil(wait / 60)} minutos y probá de nuevo.` }, 429);
    }
    const okUser = checkUser(b.usuario, env);
    const okPass = verifyPassword(b.clave || "", env.ADMIN_PASS_HASH);
    if (!okUser || !okPass) return json({ ok: false, error: "Usuario o contraseña incorrectos." }, 401);
    await resetLimit(store, "login-ip/" + ipKey(req, env));
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(env, String(b.usuario).trim().toLowerCase()) });
  }
  if (parts[0] === "salir" && m === "POST") return json({ ok: true }, 200, { "set-cookie": clearCookie() });

  const session = readSession(req, env);
  if (!session) return json({ ok: false, error: "Tu sesión terminó. Volvé a ingresar." }, 401);

  // ---------- Datos de referencia para el editor ----------
  if (parts[0] === "catalogo" && m === "GET") {
    return json({ ok: true, ramos: RAMOS, estados: ESTADOS, tipos: TIPOS, ilustraciones: ILUSTRACIONES, plantillas: Object.keys(PLANTILLAS) });
  }

  // ---------- Formularios ----------
  if (parts[0] === "formularios") {
    const id = parts[1];
    if (!id && m === "GET") {
      const [forms, idx] = await Promise.all([listForms(store), listIndex(store)]);
      const counts = {};
      for (const s of idx) counts[s.formId] = (counts[s.formId] || 0) + 1;
      // La primera vez, crea el formulario de alta de automotores.
      if (!forms.length && !(await store.getJSON("meta/sembrado"))) {
        const r = await createForm(store, PLANTILLAS.alta_automotor());
        await store.setJSON("meta/sembrado", { at: new Date().toISOString() });
        if (r.form) forms.push(r.form);
      }
      forms.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return json({ ok: true, formularios: forms.map((f) => formOut(f, counts)) });
    }
    if (!id && m === "POST") {
      let b = {};
      try { b = await req.json(); } catch {}
      const make = PLANTILLAS[b.plantilla] || PLANTILLAS.en_blanco;
      const r = await createForm(store, make(), { active: false });
      if (r.errors) return json({ ok: false, errors: r.errors }, 422);
      return json({ ok: true, formulario: r.form });
    }
    if (!ID_RE.test(id || "")) return json({ ok: false, error: "No encontrado." }, 404);
    const form = await store.getJSON("forms/" + id);
    if (!form) return json({ ok: false, error: "Ese formulario ya no existe." }, 404);
    const accion = parts[2];

    if (!accion && m === "GET") return json({ ok: true, formulario: form });
    if (!accion && m === "PUT") {
      let b = {};
      try { b = await req.json(); } catch {}
      const { errors, form: clean } = normalizeForm(b);
      if (errors.length) return json({ ok: false, errors }, 422);
      const f = { ...form, ...clean, updatedAt: new Date().toISOString() };
      await store.setJSON("forms/" + id, f);
      return json({ ok: true, formulario: f });
    }
    if (!accion && m === "DELETE") {
      await store.del("slugs/" + form.slug);
      await store.del("forms/" + id);
      return json({ ok: true });
    }
    if (accion === "duplicar" && m === "POST") {
      const r = await createForm(store, { ...form, title: (form.title + " (copia)").slice(0, 120) }, { active: false });
      if (r.errors) return json({ ok: false, errors: r.errors }, 422);
      return json({ ok: true, formulario: r.form });
    }
    if (accion === "activo" && m === "POST") {
      let b = {};
      try { b = await req.json(); } catch {}
      form.active = !!b.activo;
      form.updatedAt = new Date().toISOString();
      await store.setJSON("forms/" + id, form);
      return json({ ok: true, formulario: form });
    }
    if (accion === "nuevo-enlace" && m === "POST") {
      await store.del("slugs/" + form.slug);
      form.slug = newSlug();
      form.updatedAt = new Date().toISOString();
      await store.setJSON("slugs/" + form.slug, { formId: form.id });
      await store.setJSON("forms/" + id, form);
      return json({ ok: true, formulario: form });
    }
    return json({ ok: false, error: "No encontrado." }, 404);
  }

  // ---------- Respuestas ----------
  if (parts[0] === "respuestas") {
    const id = parts[1];
    if (!id && m === "GET") {
      let idx = await listIndex(store);
      const f = url.searchParams.get("formulario");
      const e = url.searchParams.get("estado");
      if (f) idx = idx.filter((s) => s.formId === f);
      if (e) idx = idx.filter((s) => s.status === e);
      return json({ ok: true, respuestas: idx });
    }
    if (!ID_RE.test(id || "")) return json({ ok: false, error: "No encontrado." }, 404);
    const sub = await store.getJSON("subs/" + id);
    if (!sub) return json({ ok: false, error: "Esa solicitud ya no existe." }, 404);
    const accion = parts[2];

    if (!accion && m === "GET") {
      const { enc, ...rest } = sub;
      return json({ ok: true, respuesta: { ...rest, cifrados: Object.keys(enc || {}) } });
    }
    if (accion === "estado" && m === "POST") {
      let b = {};
      try { b = await req.json(); } catch {}
      if (b.estado !== undefined) {
        if (!ESTADOS.some((x) => x.id === b.estado)) return json({ ok: false, error: "Estado inválido." }, 400);
        if (b.estado !== sub.status) sub.log.push({ at: new Date().toISOString(), accion: "Estado: " + ESTADOS.find((x) => x.id === b.estado).label });
        sub.status = b.estado;
      }
      if (b.nota !== undefined) sub.nota = String(b.nota).slice(0, 2000);
      await saveSub(store, sub);
      return json({ ok: true });
    }
    if (accion === "revelar" && m === "POST") {
      let b = {};
      try { b = await req.json(); } catch {}
      const blob = sub.enc && sub.enc[b.campo];
      if (!blob) return json({ ok: false, error: "No hay datos para mostrar." }, 404);
      const value = decrypt(blob, env);
      if (!value) return json({ ok: false, error: "No se pudo descifrar. ¿Cambió la DATA_KEY?" }, 500);
      sub.log.push({ at: new Date().toISOString(), accion: "Se mostró el dato de pago completo" });
      await saveSub(store, sub);
      return json({ ok: true, valor: value });
    }
    if (accion === "borrar-pago" && m === "POST") {
      for (const k of Object.keys(sub.enc || {})) sub.data[k] = "Eliminado del sistema";
      sub.enc = {};
      sub.log.push({ at: new Date().toISOString(), accion: "Datos de pago eliminados" });
      await saveSub(store, sub);
      return json({ ok: true });
    }
    if (accion === "archivo" && m === "GET") {
      const fileId = parts[3];
      const entry = Object.entries(sub.files || {}).flatMap(([fid, arr]) => arr.map((x, i) => ({ fid, i, ...x }))).find((x) => x.id === fileId);
      if (!entry) return json({ ok: false, error: "Archivo no encontrado." }, 404);
      const blob = await store.getBytes(`files/${sub.id}/${entry.id}`);
      if (!blob) return json({ ok: false, error: "Archivo no encontrado." }, 404);
      const many = (sub.files[entry.fid] || []).length > 1;
      const name = [safeName(sub.summary.nombre) || sub.ref, entry.fid + (many ? "-" + (entry.i + 1) : "")].join("_") + "." + entry.ext;
      const inline = url.searchParams.get("ver") === "1";
      return new Response(blob.data, {
        status: 200,
        headers: {
          "content-type": entry.type,
          "content-disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
        },
      });
    }
    if (!accion && m === "DELETE") {
      for (const k of await store.list(`files/${sub.id}/`)) await store.del(k);
      for (const k of await store.list(`filemeta/${sub.id}/`)) await store.del(k);
      await store.del("subidx/" + sub.id);
      await store.del("subs/" + sub.id);
      return json({ ok: true });
    }
    return json({ ok: false, error: "No encontrado." }, 404);
  }

  // ---------- Respaldo (sin archivos; los datos de pago van enmascarados) ----------
  if (parts[0] === "respaldo" && m === "GET") {
    const forms = await listForms(store);
    const subs = (await getMany(store, await store.list("subs/"))).filter(Boolean).map(({ enc, ...s }) => s);
    const body = JSON.stringify({ generado: new Date().toISOString(), formularios: forms, respuestas: subs }, null, 2);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="respaldo-formularios-${new Date().toISOString().slice(0, 10)}.json"`,
        "cache-control": "no-store",
      },
    });
  }

  return json({ ok: false, error: "No encontrado." }, 404);
}

export { mask };
