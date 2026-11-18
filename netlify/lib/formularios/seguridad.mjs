// Sesión del panel, contraseñas, firmas y cifrado de datos de pago.
// Todo con node:crypto, sin dependencias.

import { pbkdf2Sync, randomBytes, createHmac, timingSafeEqual, createCipheriv, createDecipheriv, createHash } from "node:crypto";

export const SESSION_HOURS = 12;
const COOKIE = "jma_panel";

// ---------- Utilidades ----------
export function randomId(bytes = 16) {
  return randomBytes(bytes).toString("base64url");
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

export function clientIp(req) {
  return (req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
}

// Huella del IP para los contadores (no se guarda el IP).
export function ipKey(req, env) {
  return createHash("sha256").update((env.SESSION_SECRET || "") + "|" + clientIp(req)).digest("base64url").slice(0, 22);
}

function sameText(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) { timingSafeEqual(x, x); return false; }
  return timingSafeEqual(x, y);
}

// ---------- Configuración ----------
export function configStatus(env) {
  const faltan = [];
  if (!env.ADMIN_USER) faltan.push("ADMIN_USER");
  if (!/^pbkdf2\$\d+\$[\w-]+\$[\w-]+$/.test(env.ADMIN_PASS_HASH || "")) faltan.push("ADMIN_PASS_HASH");
  if (!env.SESSION_SECRET || env.SESSION_SECRET.trim().length < 32) faltan.push("SESSION_SECRET");
  if (!dataKey(env)) faltan.push("DATA_KEY");
  return faltan;
}

// ---------- Contraseña ----------
// Formato: pbkdf2$<iteraciones>$<sal base64url>$<hash base64url> (SHA-256, 32 bytes).
// Lo genera la página /admin/generar-clave.html en el navegador.
export function verifyPassword(password, stored) {
  const m = /^pbkdf2\$(\d+)\$([\w-]+)\$([\w-]+)$/.exec(String(stored || "").trim());
  if (!m) return false;
  const iter = Number(m[1]);
  if (iter < 100000 || iter > 5000000) return false;
  const salt = Buffer.from(m[2], "base64url");
  const expected = Buffer.from(m[3], "base64url");
  const got = pbkdf2Sync(String(password), salt, iter, expected.length, "sha256");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function hashPassword(password, iter = 310000) {
  const salt = randomBytes(16);
  const h = pbkdf2Sync(String(password), salt, iter, 32, "sha256");
  return `pbkdf2$${iter}$${salt.toString("base64url")}$${h.toString("base64url")}`;
}

export function checkUser(user, env) {
  return sameText(String(user || "").trim().toLowerCase(), String(env.ADMIN_USER || "").trim().toLowerCase());
}

// ---------- Firmas (sesión y borradores) ----------
export function sign(payload, env) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", env.SESSION_SECRET.trim()).update(body).digest("base64url");
  return body + "." + mac;
}

export function verifySigned(token, env) {
  if (!token || !env.SESSION_SECRET) return null;
  const [body, mac] = String(token).split(".");
  if (!body || !mac) return null;
  const good = createHmac("sha256", env.SESSION_SECRET.trim()).update(body).digest("base64url");
  if (!sameText(mac, good)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p.exp || Date.now() > p.exp) return null;
    return p;
  } catch { return null; }
}

// ---------- Cookie de sesión ----------
export function sessionCookie(env, user) {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const v = sign({ u: user, exp, k: "s" }, env);
  return `${COOKIE}=${v}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function readSession(req, env) {
  const raw = req.headers.get("cookie") || "";
  const m = raw.split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!m) return null;
  const p = verifySigned(m.slice(COOKIE.length + 1), env);
  return p && p.k === "s" && checkUser(p.u, env) ? p : null;
}

// Pedidos que cambian datos: deben venir del mismo sitio (además de SameSite=Strict).
export function sameOrigin(req) {
  if (req.method === "GET" || req.method === "HEAD") return true;
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return req.headers.get("x-jma-panel") === "1";
  try { return new URL(origin).host === host; } catch { return false; }
}

// ---------- Contadores de intentos ----------
// Ventana fija: máximo `max` intentos cada `windowMs`.
export async function rateLimit(store, key, max, windowMs) {
  const k = "rl/" + key;
  const now = Date.now();
  let r = await store.getJSON(k);
  if (!r || now > r.until) r = { n: 0, until: now + windowMs };
  r.n += 1;
  await store.setJSON(k, r);
  return { ok: r.n <= max, retryAfter: Math.ceil((r.until - now) / 1000) };
}

export async function resetLimit(store, key) {
  await store.del("rl/" + key);
}

// ---------- Cifrado de CBU y tarjeta (AES-256-GCM) ----------
export function dataKey(env) {
  try {
    const k = Buffer.from(String(env.DATA_KEY || "").trim(), "base64");
    return k.length === 32 ? k : null;
  } catch { return null; }
}

export function encrypt(text, env) {
  const key = dataKey(env);
  if (!key) throw new Error("DATA_KEY no configurada");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return "v1." + Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64url");
}

export function decrypt(blob, env) {
  const key = dataKey(env);
  if (!key || !String(blob).startsWith("v1.")) return null;
  try {
    const raw = Buffer.from(String(blob).slice(3), "base64url");
    const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch { return null; }
}
