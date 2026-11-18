// Netlify Function: recibe el formulario «Pedí tu cotización» y lo envía por correo.
// Variables de entorno: RESEND_API_KEY (obligatoria); opcionales COTIZACION_TO,
// COTIZACION_FROM, COTIZACION_COPIA_CLIENTE, SHEETS_WEBHOOK_URL, SHEETS_TOKEN.
import { handle } from "./core.mjs";

export default async (req) => handle(req, process.env);

export const config = { path: "/api/cotizacion" };
