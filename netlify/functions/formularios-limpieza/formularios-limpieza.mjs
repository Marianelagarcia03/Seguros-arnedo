// Limpieza diaria: borra archivos de formularios que nunca se enviaron
// (más de 2 días) y contadores de intentos vencidos.
import { getStore } from "../../lib/formularios/store.mjs";

export async function limpiar(env = process.env, now = Date.now()) {
  const store = await getStore(env);
  const metas = await store.list("filemeta/");
  const drafts = new Map();
  for (const k of metas) {
    const [, draft, fileId] = k.split("/");
    if (!drafts.has(draft)) drafts.set(draft, []);
    drafts.get(draft).push(fileId);
  }
  let borrados = 0;
  for (const [draft, ids] of drafts) {
    if (await store.getJSON("subs/" + draft)) continue;
    const metasDraft = await Promise.all(ids.map((id) => store.getJSON(`filemeta/${draft}/${id}`)));
    const newest = Math.max(0, ...metasDraft.map((m) => (m && m.at) || 0));
    if (now - newest < 2 * 24 * 3600 * 1000) continue;
    for (const id of ids) {
      await store.del(`files/${draft}/${id}`);
      await store.del(`filemeta/${draft}/${id}`);
      borrados++;
    }
  }
  for (const k of await store.list("rl/")) {
    const r = await store.getJSON(k);
    if (!r || now > r.until) await store.del(k);
  }
  return { borrados };
}

export default async () => {
  const r = await limpiar();
  return new Response(JSON.stringify(r), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "@daily" };
