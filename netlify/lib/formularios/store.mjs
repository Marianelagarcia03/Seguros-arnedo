// Almacenamiento del panel de formularios.
// En Netlify usa Netlify Blobs (privado: solo se lee desde las funciones, sin
// direcciones públicas). Para las pruebas locales, si existe la variable
// BLOBS_LOCAL_DIR, guarda los mismos datos en una carpeta.
//
// Claves:
//   forms/<formId>            formulario (JSON)
//   slugs/<slug>              { formId } — enlace público vigente
//   subs/<subId>              respuesta (JSON)
//   files/<draftId>/<fileId>  archivo adjunto (bytes) + metadatos
//   rl/<clave>                contadores de intentos (login y envíos)

import { mkdir, readFile, writeFile, rm, readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";

const STORE_NAME = "jma-formularios";
let cached = null;

function fileStore(root) {
  const safe = (key) => {
    if (!/^[a-z0-9][a-z0-9/_.-]*$/i.test(key) || key.includes("..")) throw new Error("clave inválida");
    return join(root, key);
  };
  const metaPath = (key) => safe(key) + ".__meta.json";
  return {
    async getJSON(key) {
      try { return JSON.parse(await readFile(safe(key), "utf8")); } catch { return null; }
    },
    async setJSON(key, value) {
      const p = safe(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, JSON.stringify(value));
    },
    async getBytes(key) {
      try {
        const data = await readFile(safe(key));
        let metadata = {};
        try { metadata = JSON.parse(await readFile(metaPath(key), "utf8")); } catch {}
        return { data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), metadata };
      } catch { return null; }
    },
    async setBytes(key, bytes, metadata = {}) {
      const p = safe(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, Buffer.from(bytes));
      await writeFile(metaPath(key), JSON.stringify(metadata));
    },
    async del(key) {
      await rm(safe(key), { force: true });
      await rm(metaPath(key), { force: true });
    },
    async list(prefix) {
      const out = [];
      async function walk(dir, rel) {
        let entries = [];
        try { entries = await readdir(dir); } catch { return; }
        for (const name of entries) {
          if (name.endsWith(".__meta.json")) continue;
          const full = join(dir, name);
          const r = rel ? rel + "/" + name : name;
          if ((await stat(full)).isDirectory()) await walk(full, r);
          else if (r.startsWith(prefix)) out.push(r);
        }
      }
      await walk(root, "");
      return out.sort();
    },
  };
}

function blobsStore(store) {
  return {
    async getJSON(key) { return (await store.get(key, { type: "json" })) ?? null; },
    async setJSON(key, value) { await store.setJSON(key, value); },
    async getBytes(key) {
      const r = await store.getWithMetadata(key, { type: "arrayBuffer" });
      return r ? { data: r.data, metadata: r.metadata || {} } : null;
    },
    async setBytes(key, bytes, metadata = {}) { await store.set(key, bytes, { metadata }); },
    async del(key) { await store.delete(key); },
    async list(prefix) {
      const { blobs } = await store.list({ prefix });
      return blobs.map((b) => b.key).sort();
    },
  };
}

export async function getStore(env = process.env) {
  if (cached) return cached;
  if (env.BLOBS_LOCAL_DIR) {
    cached = fileStore(env.BLOBS_LOCAL_DIR);
  } else {
    const { getStore: netlifyGetStore } = await import("@netlify/blobs");
    cached = blobsStore(netlifyGetStore({ name: STORE_NAME, consistency: "strong" }));
  }
  return cached;
}

// Solo para pruebas.
export function _resetStore() { cached = null; }

// Lee varias claves JSON con concurrencia limitada.
export async function getMany(store, keys, limit = 12) {
  const out = new Array(keys.length);
  let i = 0;
  async function worker() {
    while (i < keys.length) {
      const k = i++;
      out[k] = await store.getJSON(keys[k]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, keys.length) }, worker));
  return out;
}
