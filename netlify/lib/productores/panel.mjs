// Panel privado · Organización de Productores: /api/admin/productores/...
// Lo llama api-panel.mjs después de comprobar la sesión. Todo queda en el
// historial de cada solicitud con fecha y usuario.

import { getMany } from "../formularios/store.mjs";
import { json, encrypt, decrypt } from "../formularios/seguridad.mjs";
import { ESTADOS, TIPOS, leerAseguradoras, validate, indexDe } from "./core.mjs";

const ID_RE = /^prd-\d{8}-[0-9a-f]{5}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const TZ = "America/Argentina/Cordoba";
const ESTADO_IDS = Object.keys(ESTADOS);
const isISODate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));
const str = (v, max) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim().slice(0, max) : "");
const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

async function body(req) {
  try { const b = await req.json(); return b && typeof b === "object" && !Array.isArray(b) ? b : {}; } catch { return {}; }
}

function abrir(enc, env) {
  if (!enc) return null;
  const t = decrypt(enc, env);
  if (!t) return null;
  try { return JSON.parse(t); } catch { return null; }
}

async function guardar(store, sol, env, datos) {
  sol.updatedAt = new Date().toISOString();
  await store.setJSON("prod/sol/" + sol.id, sol);
  await store.setJSON("prod/idx/" + sol.id, indexDe(sol, datos || abrir(sol.enc, env), env));
}

function registrar(sol, session, accion) {
  sol.log = sol.log || [];
  sol.log.push({ at: new Date().toISOString(), por: session.u, accion: String(accion).slice(0, 300) });
}

async function listar(store, env) {
  const keys = await store.list("prod/idx/");
  const rows = (await getMany(store, keys)).filter(Boolean);
  return rows.map(({ enc, ...r }) => ({ ...r, ...(abrir(enc, env) || {}) })).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function indicadores(rows) {
  const n = (e) => rows.filter((r) => r.estado === e).length;
  const personas = new Set(rows.filter((r) => r.tipo !== "info").map((r) => r.cuit || r.email || r.id));
  return {
    productores: personas.size,
    total: rows.length,
    nuevas: n("recibida"),
    pendientes: n("revision") + n("documentacion"),
    gestion: n("gestion"),
    aprobadas: n("aprobada"),
    rechazadas: n("rechazada"),
    codigos: rows.reduce((s, r) => s + (r.gestiones || []).filter((g) => g.estado === "aprobada").length, 0),
  };
}

/* ---------- Exportación (CSV para Excel: separador «;» y BOM) ---------- */
function csv(rows) {
  const cell = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // que Excel no lo tome como fórmula
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}
const dmy = (iso) => (iso ? (isISODate(iso) ? iso : new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso))).split("-").reverse().join("/") : "");

async function exportar(store, env, tipo) {
  const keys = await store.list("prod/sol/");
  const sols = (await getMany(store, keys)).filter(Boolean).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  if (tipo === "gestiones") {
    const out = [["Solicitud", "Fecha de ingreso", "Nombre y apellido", "CUIT", "Matrícula", "Aseguradora", "Estado", "Inicio de gestión", "Código asignado", "Fecha de habilitación", "Observaciones"]];
    for (const s of sols) {
      const d = abrir(s.enc, env) || {};
      for (const g of s.gestiones || []) out.push([s.ref, dmy(s.createdAt), s.resumen.nombre, d.cuit, d.matricula, g.nombre, ESTADOS[g.estado], dmy(g.inicio), g.codigo, dmy(g.habilitada), g.obs]);
    }
    return csv(out);
  }
  const out = [["Solicitud", "Fecha de ingreso", "Tipo", "Estado", "Nombre y apellido", "DNI", "CUIT", "Matrícula", "Fecha de matriculación", "Teléfono", "Correo", "Localidad", "Provincia", "Organización actual", "Aseguradoras actuales", "Compañías solicitadas", "Compañías habilitadas", "Comentarios / consulta"]];
  for (const s of sols) {
    const d = abrir(s.enc, env) || {};
    const g = s.gestiones || [];
    out.push([
      s.ref, dmy(s.createdAt), TIPOS[s.tipo], ESTADOS[s.estado], s.resumen.nombre, d.dni, d.cuit, d.matricula, dmy(d.fecha_matricula),
      d.telefono, d.email, s.resumen.localidad, s.resumen.provincia, d.trabaja_organizacion === "si" ? d.organizacion || "Sí" : d.trabaja_organizacion === "no" ? "No" : "",
      d.companias_actuales, g.map((x) => x.nombre).join(", "),
      g.filter((x) => x.estado === "aprobada").map((x) => `${x.nombre}${x.codigo ? " (" + x.codigo + ")" : ""}`).join(", "),
      d.comentarios || d.consulta,
    ]);
  }
  return csv(out);
}

/* ---------- Rutas ---------- */
export async function handlePanel(req, env, store, parts, session, url) {
  const m = req.method;

  // Lista de aseguradoras (administrable)
  if (parts[0] === "aseguradoras") {
    if (m === "GET") return json({ ok: true, aseguradoras: await leerAseguradoras(store) });
    if (m === "PUT") {
      const b = await body(req);
      const prev = await leerAseguradoras(store);
      const lista = Array.isArray(b.aseguradoras) ? b.aseguradoras.slice(0, 80) : [];
      const vistos = new Set();
      const errores = [];
      const limpia = lista.map((a, i) => {
        const nombre = str(a && a.nombre, 60);
        let id = str(a && a.id, 40).toLowerCase();
        if (!id) id = nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
        if (!nombre) errores.push(`Fila ${i + 1}: falta el nombre.`);
        if (!SLUG_RE.test(id)) errores.push(`Fila ${i + 1}: nombre inválido.`);
        if (vistos.has(id)) errores.push(`«${nombre}» está repetida.`);
        vistos.add(id);
        return { id, nombre, activa: a && a.activa !== false };
      });
      // No se pueden quitar de la lista las que ya tienen gestiones (se desactivan).
      const enUso = new Set((await listar(store, env)).flatMap((r) => r.companias || []));
      for (const a of prev) if (enUso.has(a.id) && !vistos.has(a.id)) errores.push(`«${a.nombre}» tiene gestiones cargadas: desactivala en lugar de quitarla.`);
      if (!limpia.length) errores.push("La lista no puede quedar vacía.");
      if (errores.length) return json({ ok: false, error: errores[0], errores }, 422);
      await store.setJSON("prod/aseguradoras", { lista: limpia, actualizada: new Date().toISOString(), por: session.u });
      return json({ ok: true, aseguradoras: limpia });
    }
    return json({ ok: false, error: "No encontrado." }, 404);
  }

  // Exportar
  if (parts[0] === "exportar" && m === "GET") {
    const tipo = url.searchParams.get("tipo") === "gestiones" ? "gestiones" : "productores";
    const fecha = hoy();
    return new Response(await exportar(store, env, tipo), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${tipo === "gestiones" ? "gestiones-por-aseguradora" : "productores"}-${fecha}.csv"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }

  // Listado + indicadores
  if (!parts[0] && m === "GET") {
    const rows = await listar(store, env);
    return json({ ok: true, indicadores: indicadores(rows), solicitudes: rows, estados: ESTADOS, tipos: TIPOS, aseguradoras: await leerAseguradoras(store) });
  }

  // Una solicitud
  const id = parts[0];
  if (!ID_RE.test(id || "")) return json({ ok: false, error: "No encontrado." }, 404);
  const sol = await store.getJSON("prod/sol/" + id);
  if (!sol) return json({ ok: false, error: "Esa solicitud ya no existe." }, 404);
  const accion = parts[1];
  const datos = abrir(sol.enc, env);

  if (!accion && m === "GET") {
    const { enc, ...rest } = sol;
    return json({ ok: true, solicitud: { ...rest, datos: datos || {}, datosDisponibles: !!datos }, estados: ESTADOS, tipos: TIPOS, aseguradoras: await leerAseguradoras(store) });
  }

  if (accion === "estado" && m === "POST") {
    const b = await body(req);
    if (!ESTADO_IDS.includes(b.estado)) return json({ ok: false, error: "Estado inválido." }, 400);
    if (b.estado !== sol.estado) {
      registrar(sol, session, `Estado general: ${ESTADOS[sol.estado]} → ${ESTADOS[b.estado]}`);
      sol.estado = b.estado;
      await guardar(store, sol, env, datos);
    }
    return json({ ok: true });
  }

  if (accion === "datos" && m === "PUT") {
    if (!datos) return json({ ok: false, error: "No se pudieron leer los datos guardados. ¿Cambió la DATA_KEY?" }, 500);
    const b = await body(req);
    const aseguradoras = await leerAseguradoras(store);
    // Las compañías se editan desde las gestiones: para validar se usan las actuales (aunque estén desactivadas).
    const todas = aseguradoras.map((a) => ({ ...a, activa: true }));
    const { ok, errors, data } = validate({ ...b, tipo: sol.tipo, consentimiento: "si", companias: (sol.gestiones || []).map((g) => g.id).concat(datos.companias || []) }, todas);
    delete errors.companias;
    if (!ok && Object.keys(errors).length) return json({ ok: false, error: "Revisá los datos marcados.", errors }, 422);
    data.companias = datos.companias || [];
    const cambios = Object.keys(data).filter((k) => k !== "companias" && String(data[k] ?? "") !== String(datos[k] ?? ""));
    if (cambios.length) {
      sol.enc = encrypt(JSON.stringify(data), env);
      sol.resumen = { nombre: data.nombre, localidad: data.localidad, provincia: data.provincia };
      registrar(sol, session, "Datos editados: " + cambios.join(", "));
      await guardar(store, sol, env, data);
    }
    return json({ ok: true, cambios: cambios.length });
  }

  if (accion === "nota" && m === "POST") {
    const b = await body(req);
    const texto = str(b.texto, 2000);
    if (!texto) return json({ ok: false, error: "Escribí la observación." }, 422);
    sol.notas = sol.notas || [];
    sol.notas.push({ at: new Date().toISOString(), por: session.u, texto });
    registrar(sol, session, "Nueva observación interna");
    await guardar(store, sol, env, datos);
    return json({ ok: true });
  }

  if (accion === "gestion") {
    const cid = parts[2];
    sol.gestiones = sol.gestiones || [];
    if (!cid && m === "POST") {
      const b = await body(req);
      const a = (await leerAseguradoras(store)).find((x) => x.id === b.id);
      if (!a) return json({ ok: false, error: "Elegí una aseguradora de la lista." }, 422);
      if (sol.gestiones.some((g) => g.id === a.id)) return json({ ok: false, error: "Esa aseguradora ya está en la lista." }, 422);
      sol.gestiones.push({ id: a.id, nombre: a.nombre, estado: "recibida", inicio: "", codigo: "", habilitada: "", obs: "" });
      registrar(sol, session, `Se agregó la gestión con ${a.nombre}`);
      await guardar(store, sol, env, datos);
      return json({ ok: true });
    }
    const g = sol.gestiones.find((x) => x.id === cid);
    if (!g) return json({ ok: false, error: "Gestión no encontrada." }, 404);
    if (m === "PUT") {
      const b = await body(req);
      const nuevo = {
        estado: ESTADO_IDS.includes(b.estado) ? b.estado : g.estado,
        inicio: str(b.inicio, 10), codigo: str(b.codigo, 40), habilitada: str(b.habilitada, 10), obs: str(b.obs, 1000),
      };
      const errors = {};
      if (nuevo.inicio && (!isISODate(nuevo.inicio) || nuevo.inicio > hoy())) errors.inicio = "Revisá la fecha.";
      if (nuevo.habilitada && (!isISODate(nuevo.habilitada) || nuevo.habilitada > hoy())) errors.habilitada = "Revisá la fecha.";
      // Una apertura no se da por finalizada sin la confirmación de la aseguradora: código y fecha.
      if (nuevo.estado === "aprobada") {
        if (!nuevo.codigo) errors.codigo = "Para marcarla aprobada cargá el código que confirmó la aseguradora.";
        if (!nuevo.habilitada) errors.habilitada = "Cargá la fecha de habilitación.";
      }
      if (Object.keys(errors).length) return json({ ok: false, error: Object.values(errors)[0], errors }, 422);
      if (nuevo.estado === "gestion" && !nuevo.inicio && !g.inicio) nuevo.inicio = hoy();
      const etiquetas = { estado: "estado", inicio: "inicio", codigo: "código", habilitada: "fecha de habilitación", obs: "observaciones" };
      const cambios = Object.keys(nuevo).filter((k) => String(nuevo[k]) !== String(g[k] || ""));
      if (cambios.length) {
        const detalle = cambios.map((k) => (k === "estado" ? `estado → ${ESTADOS[nuevo.estado]}` : k === "codigo" ? `código → ${nuevo.codigo || "(vacío)"}` : etiquetas[k])).join(", ");
        Object.assign(g, nuevo);
        registrar(sol, session, `${g.nombre}: ${detalle}`);
        await guardar(store, sol, env, datos);
      }
      return json({ ok: true, gestion: g });
    }
    if (m === "DELETE") {
      sol.gestiones = sol.gestiones.filter((x) => x.id !== cid);
      registrar(sol, session, `Se quitó la gestión con ${g.nombre}`);
      await guardar(store, sol, env, datos);
      return json({ ok: true });
    }
  }

  if (accion === "archivo" && m === "GET") {
    const f = (sol.files || []).find((x) => x.id === parts[2]);
    if (!f) return json({ ok: false, error: "Archivo no encontrado." }, 404);
    const blob = await store.getBytes(`prod/files/${sol.id}/${f.id}`);
    if (!blob) return json({ ok: false, error: "Archivo no encontrado." }, 404);
    const name = `${sol.ref}-${f.nombre}`.replace(/[^A-Za-z0-9._-]+/g, "-");
    return new Response(blob.data, {
      status: 200,
      headers: {
        "content-type": f.type,
        "content-disposition": `${url.searchParams.get("ver") === "1" ? "inline" : "attachment"}; filename="${name}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      },
    });
  }

  if (!accion && m === "DELETE") {
    for (const k of await store.list(`prod/files/${sol.id}/`)) await store.del(k);
    await store.del("prod/idx/" + sol.id);
    await store.del("prod/sol/" + sol.id);
    console.log(`[productores] ${sol.ref} eliminada por ${session.u}`);
    return json({ ok: true });
  }

  return json({ ok: false, error: "No encontrado." }, 404);
}

// Para el respaldo general del panel: solicitudes tal como están guardadas (datos cifrados).
export async function respaldoProductores(store) {
  const keys = await store.list("prod/sol/");
  return {
    aseguradoras: (await store.getJSON("prod/aseguradoras")) || null,
    solicitudes: (await getMany(store, keys)).filter(Boolean),
  };
}
