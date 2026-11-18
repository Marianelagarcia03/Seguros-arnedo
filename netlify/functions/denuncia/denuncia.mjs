// Netlify Function: recibe el formulario «Denuncia de siniestro» y lo envía
// por correo con las fotos del carnet adjuntas. Ver core.mjs.
// Variables de entorno: RESEND_API_KEY (obligatoria), DENUNCIA_TO, DENUNCIA_FROM.
import { handle } from "./core.mjs";

export default async (req) => handle(req, process.env);

export const config = { path: "/api/denuncia" };
