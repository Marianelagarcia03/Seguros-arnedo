// Genera css/style.css a partir de scss/style.scss sin dependencias.
// Los parciales usan sintaxis compatible con CSS, así que basta con
// resolver los @import en orden. Si tenés Sass instalado, el resultado
// es equivalente a: npx sass scss/style.scss css/style.css --no-source-map
//
// Uso: node scripts/build-css.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(root, "scss", "style.scss");

function resolvePartial(fromDir, spec) {
  const dir = join(fromDir, dirname(spec));
  const name = basename(spec);
  const candidates = [`_${name}.scss`, `${name}.scss`, `_${name}.css`, `${name}.css`];
  for (const c of candidates) {
    const p = join(dir, c);
    if (existsSync(p)) return p;
  }
  throw new Error(`No se encontró el parcial "${spec}" desde ${fromDir}`);
}

function stripLineComments(src) {
  // Elimina comentarios "//" de Sass que no estén dentro de url() o strings.
  return src
    .split("\n")
    .map((line) => (/^\s*\/\//.test(line) ? "" : line))
    .join("\n");
}

function compile(file) {
  const src = stripLineComments(readFileSync(file, "utf8"));
  return src.replace(/@import\s+["']([^"']+)["'];?/g, (_, spec) => {
    if (/^(https?:)?\/\//.test(spec) || spec.endsWith(".css")) return `@import "${spec}";`;
    return compile(resolvePartial(dirname(file), spec));
  });
}

const css = `/* Archivo generado desde scss/ — no editar a mano. Ejecutar: node scripts/build-css.mjs */\n${compile(entry)
  .replace(/\n{3,}/g, "\n\n")
  .trim()}\n`;
writeFileSync(join(root, "css", "style.css"), css);
console.log(`css/style.css generado (${(css.length / 1024).toFixed(1)} KB)`);
