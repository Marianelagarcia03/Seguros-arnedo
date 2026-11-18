# 🛡️ SegurosArnedo.com — Seguros Arnedo

**Sitio web de SegurosArnedo.com, del Productor Asesor de Seguros Juan Manuel Arnedo (Córdoba, Argentina).**
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
| `DENUNCIA_FROM` | No | Remitente (el nombre va entre comillas porque lleva un punto). Por defecto `"Web SegurosArnedo.com" <onboarding@resend.dev>`. Con el dominio verificado en Resend: `"SegurosArnedo.com" <denuncias@segurosarnedo.com>`. |
| `DENUNCIA_COPIA_CLIENTE` | No | `si` para mandarle al cliente una copia con su número de denuncia. **Requiere el dominio verificado en Resend.** |
| `SHEETS_WEBHOOK_URL` | No | URL de la aplicación web de Google Apps Script que registra cada denuncia en una planilla. |
| `SHEETS_TOKEN` | No | Clave compartida con el Apps Script, para que nadie más pueda escribir en la planilla. |
| `DENUNCIA_ORIGINS` | No | Dominios extra desde los que se permite enviar, separados por coma. |

Sin dominio verificado, Resend solo entrega a la dirección con la que se creó la cuenta:
crear la cuenta con `juanmanuelarnedo@gmail.com` o verificar `segurosarnedo.com` en Resend.

## Formulario «Pedí tu cotización» (`/pages/cotizar.html`, también `/cotizar`)

Auto, hogar, accidentes personales, asistencia al viajero y otros seguros. Se envía a la Netlify Function
`/api/cotizacion`, que valida todo de nuevo y manda el **detalle completo por correo** (con clave de
idempotencia para que un doble clic no genere dos correos). «Recibimos tu solicitud» se muestra solo si el
servidor acepta el envío; después se ofrece «Enviar solicitud por WhatsApp» con un **resumen sin DNI, CUIT,
domicilios ni fechas de nacimiento**. El enlace anterior `/?seguro=auto#cotizar` redirige a `/cotizar` con Auto.

| Variable | Obligatoria | Valor |
|---|---|---|
| `RESEND_API_KEY` | Sí | La misma que usa la denuncia. |
| `COTIZACION_TO` | No | Destinatario. Por defecto `juanmanuelarnedo@gmail.com`. |
| `COTIZACION_FROM` | No | Remitente. Por defecto usa `DENUNCIA_FROM`. Con el dominio verificado: `"SegurosArnedo.com" <avisos@segurosarnedo.com>`. |
| `COTIZACION_COPIA_CLIENTE` | No | `si` para mandarle al cliente la confirmación (sin datos sensibles). **Requiere el dominio verificado en Resend.** |

### Registro en Google Sheets (opcional)

Una sola planilla con dos hojas, «Cotizaciones» y «Denuncias», que se crean solas. Cada fila trae el número de
solicitud; si llega dos veces el mismo número, no se duplica.

1. Crear una planilla en Google Sheets → Extensiones → Apps Script y pegar este código:

```js
// SegurosArnedo.com · registro de solicitudes de la web (cotizaciones y denuncias).
// La clave NO va en el código: Configuración del proyecto → Propiedades de la secuencia de comandos → TOKEN.
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var d = JSON.parse(e.postData.contents);
    var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || d.token !== token) return out('forbidden');
    delete d.token;
    var name = d.hoja === 'Cotizaciones' ? 'Cotizaciones' : 'Denuncias';
    delete d.hoja;
    var book = SpreadsheetApp.getActiveSpreadsheet();
    var sh = book.getSheetByName(name) || book.insertSheet(name);
    var keys = Object.keys(d);
    if (sh.getLastRow() === 0) {
      sh.appendRow(keys);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, keys.length).setFontWeight('bold');
    }
    var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    keys.forEach(function (k) {
      if (header.indexOf(k) === -1) { header.push(k); sh.getRange(1, header.length).setValue(k).setFontWeight('bold'); }
    });
    var col = header.indexOf('ref') + 1;
    if (d.ref && col > 0 && sh.getLastRow() > 1) {
      var refs = sh.getRange(2, col, sh.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; });
      if (refs.indexOf(d.ref) > -1) return out('duplicado');
    }
    sh.appendRow(header.map(function (h) {
      var v = d[h] === undefined ? '' : d[h];
      return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; // evita que un texto se tome como fórmula
    }));
    return out('ok');
  } finally {
    lock.releaseLock();
  }
}
function out(t) { return ContentService.createTextOutput(t); }
```

2. En el mismo Apps Script: Configuración del proyecto → Propiedades de la secuencia de comandos → agregar
   `TOKEN` con una clave larga.
3. Implementar → Nueva implementación → Aplicación web. Ejecutar como «Yo», acceso «Cualquier persona».
4. En Netlify, cargar `SHEETS_WEBHOOK_URL` (la URL de la implementación) y `SHEETS_TOKEN` (la misma clave),
   marcadas como secretas, y volver a publicar.

Si la planilla falla, la solicitud se envía igual por correo. La planilla guarda el detalle completo (incluye DNI y
domicilios): compartila solo con quien la necesite.
