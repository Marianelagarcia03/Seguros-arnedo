// Netlify Function: solicitudes de la sección «Organización de Productores».
// GET  → lista pública de aseguradoras activas.
// POST → valida, avisa por correo (Resend) y guarda la solicitud cifrada.
// Variables: RESEND_API_KEY y DATA_KEY (las mismas del sitio); opcionales
// PRODUCTORES_TO (por defecto juanmanuelarnedo@gmail.com) y PRODUCTORES_FROM.
import { handle } from "../../lib/productores/core.mjs";

export default async (req) => handle(req, process.env);

export const config = { path: "/api/productores" };
