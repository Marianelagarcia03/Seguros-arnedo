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

### Registro en Google Sheets (activo)

Desde el 19/11/2026 cada cotización y cada denuncia se guarda sola en la planilla **«Registro web SegurosArnedo»**
(cuenta jma.seguroscba@gmail.com), a través del formulario de Google «Registro web SegurosArnedo (uso interno)».
No requiere autorizaciones ni variables: el código está en `netlify/lib/planilla.mjs`. Para apagarlo, cargar
`SHEETS_FORM_ID=off` en Netlify; para usar otro formulario, poner su ID. Si el formulario falla, el correo se envía igual.
No cambiar el orden ni los nombres de las preguntas del formulario sin actualizar `CAMPOS` en ese archivo.

### Registro con Apps Script (alternativa anterior, no usada)

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

## Organización de Productores (`/pages/organizacion-de-productores.html`, también `/productores`)

Sección para productores: **productor nuevo** (apertura de códigos), **productor activo** (sumar aseguradoras)
y **pedido de información**. Cada opción abre su formulario; también se puede enlazar directo con
`/productores#nuevo`, `#activo` o `#info`.

El envío va a la Netlify Function `/api/productores` (`netlify/functions/productores/`, lógica en
`netlify/lib/productores/core.mjs`), que:

1. Valida todo de nuevo (DNI, CUIT con dígito verificador y coincidencia con el DNI, matrícula, teléfono, correo, provincia,
   compañías activas), con campo trampa, tiempo mínimo de llenado y límite de 8 envíos por hora por conexión.
2. Manda el detalle completo por correo (Resend) con los adjuntos y un enlace directo a WhatsApp del productor.
3. Guarda la solicitud en el almacenamiento privado del panel (Netlify Blobs, claves `prod/…`), con los datos personales
   **cifrados** con `DATA_KEY`, una gestión independiente por cada aseguradora pedida y los adjuntos.
   Si falta `DATA_KEY`, la solicitud llega igual por correo pero no queda guardada (se avisa en el log).

Adjuntos opcionales: hasta 3 archivos PDF, JPG, PNG o WEBP (las fotos grandes se achican en el navegador).
La lista de aseguradoras se lee de `prod/aseguradoras`; mientras no exista se usan las 7 de la web
(`ASEGURADORAS_INICIALES`). Se administra desde el panel.

| Variable | Obligatoria | Valor |
|---|---|---|
| `RESEND_API_KEY` | Sí | La misma de cotizaciones y denuncias. |
| `DATA_KEY` | Sí | La misma del panel de formularios (cifra los datos guardados). |
| `PRODUCTORES_TO` | No | Destinatario de los avisos. Por defecto `juanmanuelarnedo@gmail.com`. |
| `PRODUCTORES_FROM` | No | Remitente. Por defecto usa `COTIZACION_FROM` / `DENUNCIA_FROM`. |

### Panel: pestaña «Productores» (`/admin/formularios#/productores`)

Usa el mismo usuario, contraseña y sesión del panel de formularios. Código: `js/admin-productores.js` (pantallas),
`netlify/lib/productores/panel.mjs` (API `/api/admin/productores/…`, que se engancha en `api-panel.mjs` después de
comprobar la sesión) y los estilos `pr-*` al final de `css/panel.css`.

- **Indicadores:** productores registrados (personas distintas por CUIT), nuevas, pendientes (en revisión + documentación
  pendiente), en gestión, aprobadas y rechazadas. Se puede tocar cada uno para filtrar.
- **Listado** con búsqueda por nombre, CUIT, DNI, matrícula o número, y filtros por estado, tipo y aseguradora.
- **Ficha** con datos personales y profesionales, documentación, estado general, observaciones internas (no las ve el
  productor), historial con fecha y usuario de cada cambio, WhatsApp, correo, edición de datos y eliminación.
- **Seguimiento por aseguradora:** cada compañía con su estado, inicio, código asignado, fecha de habilitación y
  observaciones. No se puede marcar «Aprobada» sin código y fecha de habilitación (confirmación de la aseguradora).
- **Aseguradoras:** agregar, renombrar, activar o desactivar sin tocar el código. Las que ya tienen gestiones no se
  pueden quitar, solo desactivar.
- **Exportar** a Excel (CSV con «;»): productores (una fila por solicitud) o gestiones (una fila por aseguradora).
- El **Respaldo** del panel incluye también las solicitudes de productores (con los datos cifrados, como se guardan).
