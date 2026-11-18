// Panel privado de formularios: ver netlify/lib/formularios/api-panel.mjs
import { handle } from "../../lib/formularios/api-panel.mjs";

export default (req) => handle(req, process.env);

export const config = { path: ["/api/admin", "/api/admin/*"] };
