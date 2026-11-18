// Formularios para clientes: ver netlify/lib/formularios/api-publica.mjs
import { handle } from "../../lib/formularios/api-publica.mjs";

export default (req) => handle(req, process.env);

export const config = { path: "/api/f/*" };
