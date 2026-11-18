# 🛡️ JMA Seguros — Seguros Arnedo

**Sitio web de JMA Seguros, del Productor Asesor de Seguros Juan Manuel Arnedo (Córdoba, Argentina).**
Pensado para que cualquier persona encuentre rápido el seguro que necesita, pida una cotización, escriba por WhatsApp y sepa cómo actuar ante un siniestro.

- Dominio oficial: https://segurosarnedo.com/
- GitHub Pages: https://marianelagarcia03.github.io/Seguros-arnedo/
- Netlify: https://seguros-arnedo.netlify.app/

## Descripción del proyecto
Proyecto creado originalmente como proyecto final del curso de Desarrollo Web de Coderhouse y luego rediseñado y optimizado con foco comercial (UX, conversión, SEO, accesibilidad y rendimiento), conservando la identidad visual de la marca.

## 🖥️ Tecnologías
- `HTML5` semántico (sin frameworks)
- `CSS3` con estructura `SCSS` (parciales en `scss/`)
- `JavaScript` sin dependencias (`js/main.js`)
- Formulario de contacto con [Formspree](https://formspree.io/)
- `Git & GitHub`

## 📄 Páginas
| Página | Contenido |
| --- | --- |
| `index.html` | Hero, accesos rápidos, seguros, asesor, compañías, formulario de cotización (WhatsApp / correo), siniestros, contacto y mapa |
| `pages/productos.html` | Ficha de cada seguro: qué es, qué puede cubrir, para quién es, qué consultar y cómo cotizar |
| `pages/companias.html` | Las 7 compañías con logo, datos verificables, sitio oficial y acceso a su asistencia |
| `pages/siniestros.html` | Emergencias, pasos a seguir, checklist, teléfonos de asistencia por compañía y guías por tipo de seguro |
| `pages/contacto.html` | Canales de contacto, formulario (Formspree) y mapa |
| `404.html` | Página de error con accesos útiles |

## 📁 Estructura
```
├── index.html
├── pages/                 Páginas internas
├── css/style.css          CSS final (generado desde scss/)
├── scss/                  Fuentes de estilos (tokens, base, componentes, responsive)
├── js/main.js             Menú, WhatsApp, formularios, animaciones
├── img/                   Imágenes originales
├── img/web/               Versiones optimizadas (WebP) que usa el sitio
├── scripts/build-css.mjs  Compila scss → css sin dependencias
├── robots.txt · sitemap.xml · site.webmanifest
```

## 🎨 Estilos
Los colores de marca están centralizados en `scss/base/_funcionalidades.scss` como variables CSS.
Después de editar cualquier archivo de `scss/`, regenerá el CSS con:

```bash
node scripts/build-css.mjs        # sin dependencias
# o, si tenés Sass:
npx sass scss/style.scss css/style.css --no-source-map
```

## ⚙️ Datos que se configuran en un solo lugar
- **WhatsApp y correo:** `CONFIG` al inicio de `js/main.js` (los enlaces del HTML también los incluyen para funcionar sin JavaScript).
- **Formulario de contacto:** `action` del formulario en `pages/contacto.html` (endpoint de Formspree).

## 📂 Cómo clonar el proyecto

```bash
git clone https://github.com/Marianelagarcia03/Seguros-arnedo.git
cd Seguros-arnedo
python3 -m http.server 8000   # y abrir http://localhost:8000
```

## ⭐ Autora
Marianela García — marianela971@gmail.com

## Formulario «Denuncia de siniestro» (`/pages/denuncia.html`)

El formulario envía los datos a una Netlify Function (`netlify/functions/denuncia/`, ruta `/api/denuncia`),
que valida todo de nuevo y manda un correo con las fotos adjuntas (carnet, daños y papeles de terceros)
a través de [Resend](https://resend.com). Las fotos no se guardan en ningún lado: viajan solo como adjuntos.
Mientras falte `RESEND_API_KEY`, el formulario muestra un aviso con WhatsApp y no deja enviar.

Variables de entorno (Netlify → Site configuration → Environment variables, alcance «Functions»):

| Variable | Obligatoria | Valor |
|---|---|---|
| `RESEND_API_KEY` | Sí | Clave de API de Resend (empieza con `re_`). Marcar como secreta. |
| `DENUNCIA_TO` | No | Destinatario. Por defecto `juanmanuelarnedo@gmail.com`. |
| `DENUNCIA_FROM` | No | Remitente. Por defecto `Web JMA Seguros <onboarding@resend.dev>`. Con el dominio verificado en Resend: `JMA Seguros <denuncias@segurosarnedo.com>`. |
| `DENUNCIA_COPIA_CLIENTE` | No | `si` para mandarle al cliente una copia con su número de denuncia. **Requiere el dominio verificado en Resend.** |
| `SHEETS_WEBHOOK_URL` | No | URL de la aplicación web de Google Apps Script que registra cada denuncia en una planilla. |
| `SHEETS_TOKEN` | No | Clave compartida con el Apps Script, para que nadie más pueda escribir en la planilla. |
| `DENUNCIA_ORIGINS` | No | Dominios extra desde los que se permite enviar, separados por coma. |

Sin dominio verificado, Resend solo entrega a la dirección con la que se creó la cuenta:
crear la cuenta con `juanmanuelarnedo@gmail.com` o verificar `segurosarnedo.com` en Resend.

### Registro en Google Sheets (opcional)

1. Crear una planilla en Google Sheets → Extensiones → Apps Script, pegar este código y cambiar `TOKEN`:

```js
const TOKEN = 'CAMBIAR-POR-UNA-CLAVE-LARGA';
const COLS = ['ref', 'enviada', 'tipo', 'asegurado', 'telefono', 'email', 'compania', 'poliza', 'patente',
  'fecha_hecho', 'hora', 'direccion', 'lesionados', 'policia', 'terceros', 'plazo_vence', 'estado'];
function doPost(e) {
  const d = JSON.parse(e.postData.contents);
  if (d.token !== TOKEN) return ContentService.createTextOutput('forbidden');
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const sh = book.getSheetByName('Denuncias') || book.insertSheet('Denuncias');
  if (sh.getLastRow() === 0) sh.appendRow(COLS);
  sh.appendRow(COLS.map((c) => (d[c] === undefined ? '' : d[c])));
  return ContentService.createTextOutput('ok');
}
```

2. Implementar → Nueva implementación → Aplicación web. Ejecutar como «Yo», acceso «Cualquier persona».
3. Copiar la URL en `SHEETS_WEBHOOK_URL` y la clave en `SHEETS_TOKEN`.
La planilla registra los datos principales (sin fotos ni relato). Si falla, la denuncia se envía igual por correo.
