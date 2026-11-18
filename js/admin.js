/* Panel privado de formularios — SegurosArnedo.com.
   Toda la información se pide a /api/admin, que comprueba la sesión en el
   servidor. Esta página no contiene datos ni claves. */
(function () {
  "use strict";

  var app = document.getElementById("app");
  var $ = function (id) { return document.getElementById(id); };
  var CAT = null;       // catálogo: ramos, estados, tipos
  var dirty = false;    // cambios sin guardar en el editor
  var TZ = "America/Argentina/Cordoba";

  // ---------- Utilidades ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fecha(iso) {
    try { return new Intl.DateTimeFormat("es-AR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); } catch (e) { return iso; }
  }
  function estadoLabel(id) { var e = (CAT ? CAT.estados : []).filter(function (x) { return x.id === id; })[0]; return e ? e.label : id; }
  function publicUrl(slug) { return location.origin + "/f/" + slug; }

  function api(method, path, body) {
    return fetch("/api/admin" + path, {
      method: method,
      credentials: "same-origin",
      headers: body !== undefined ? { "content-type": "application/json", "x-jma-panel": "1" } : { "x-jma-panel": "1" },
      body: body !== undefined ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: "Respuesta inválida del servidor." }; }).then(function (j) {
        if (r.status === 401 && path !== "/login") { showLogin("Tu sesión terminó. Volvé a ingresar."); throw new Error("401"); }
        j.status = r.status;
        return j;
      });
    });
  }

  var toastTimer;
  function toast(msg, bad) {
    var t = $("ad-toast");
    t.textContent = msg;
    t.className = "ad-toast" + (bad ? " is-bad" : "");
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  // Ventana de confirmación propia (sin alert/confirm del navegador).
  function modal(o) {
    return new Promise(function (resolve) {
      var m = $("ad-modal"), ok = $("ad-modal-ok"), cancel = $("ad-modal-cancel");
      $("ad-modal-title").textContent = o.title;
      $("ad-modal-body").innerHTML = '<p class="ad-muted">' + o.html + "</p>" + (o.typeText ? '<label class="ad-typecheck">Escribí <b>' + esc(o.typeText) + '</b> para confirmar<input type="text" id="ad-modal-type" autocomplete="off"></label>' : "");
      ok.textContent = o.ok || "Aceptar";
      ok.className = "btn btn-sm " + (o.danger ? "btn-danger" : "btn-primary");
      m.hidden = false;
      var input = $("ad-modal-type");
      ok.disabled = !!o.typeText;
      if (input) { input.addEventListener("input", function () { ok.disabled = input.value.trim().toUpperCase() !== o.typeText; }); input.focus(); } else ok.focus();
      function done(v) { m.hidden = true; ok.onclick = cancel.onclick = null; document.removeEventListener("keydown", key); resolve(v); }
      function key(e) { if (e.key === "Escape") done(false); }
      ok.onclick = function () { done(true); };
      cancel.onclick = function () { done(false); };
      document.addEventListener("keydown", key);
    });
  }

  function copy(text) {
    var fallback = function () {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).catch(fallback);
    fallback();
    return Promise.resolve();
  }

  // ---------- Sesión ----------
  function setTop(show, tab) {
    $("ad-top").hidden = !show;
    document.querySelectorAll(".ad-tabs a").forEach(function (a) { a.classList.toggle("is-active", a.getAttribute("data-tab") === tab); });
  }

  function showSetup(faltan) {
    setTop(false);
    app.innerHTML = '<section class="ad-card ad-narrow"><h1 class="ad-h1">Falta configurar el panel</h1>' +
      '<p class="ad-muted">Para activar el panel hay que cargar estas variables en Netlify (Configuración del sitio → Variables de entorno), marcarlas como secretas y volver a publicar:</p>' +
      '<ul class="ad-list">' + faltan.map(function (k) { return "<li><code>" + esc(k) + "</code></li>"; }).join("") + "</ul>" +
      '<p class="ad-muted">Los valores se generan en tu navegador con <a href="/admin/generar-clave.html">el generador de claves</a>. Nadie más los ve.</p></section>';
  }

  function showLogin(msg) {
    setTop(false);
    app.innerHTML = '<section class="ad-card ad-narrow ad-login"><img src="/img/web/logo-160.webp" alt="" width="64" height="64">' +
      '<h1 class="ad-h1">Panel de formularios</h1><p class="ad-muted">Acceso privado de SegurosArnedo.com.</p>' +
      '<form id="ad-login" novalidate><div class="field"><label for="ad-user">Usuario</label><input id="ad-user" autocomplete="username" autocapitalize="off" spellcheck="false" required></div>' +
      '<div class="field"><label for="ad-pass">Contraseña</label><input id="ad-pass" type="password" autocomplete="current-password" required></div>' +
      '<div class="form-status' + (msg ? " is-visible is-error" : "") + '" id="ad-login-msg" role="alert">' + esc(msg || "") + "</div>" +
      '<button class="btn btn-primary btn-block" type="submit" id="ad-login-btn">Ingresar</button></form></section>';
    $("ad-user").focus();
    $("ad-login").addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = $("ad-login-btn"), box = $("ad-login-msg");
      btn.disabled = true; btn.textContent = "Ingresando…";
      api("POST", "/login", { usuario: $("ad-user").value, clave: $("ad-pass").value }).then(function (j) {
        if (j.ok) { $("ad-pass").value = ""; boot(); return; }
        box.textContent = j.error || "No se pudo ingresar."; box.className = "form-status is-visible is-error";
        $("ad-pass").value = ""; $("ad-pass").focus();
      }).catch(function () {}).then(function () { btn.disabled = false; btn.textContent = "Ingresar"; });
    });
  }

  $("ad-logout").addEventListener("click", function () {
    api("POST", "/salir").catch(function () {}).then(function () { CAT = null; location.hash = ""; showLogin("Cerraste la sesión."); });
  });

  // ---------- Rutas ----------
  function route() {
    if (!CAT) return;
    var h = location.hash.replace(/^#\/?/, "");
    var q = h.split("?"), parts = q[0].split("/").filter(Boolean), params = new URLSearchParams(q[1] || "");
    if (parts[0] === "respuestas" && parts[1]) return viewRespuesta(parts[1]);
    if (parts[0] === "respuestas") return viewRespuestas(params);
    if (parts[0] === "formularios" && parts[1]) return viewEditor(parts[1]);
    return viewFormularios();
  }
  var lastHash = location.hash, skip = false;
  window.addEventListener("hashchange", function () {
    if (skip) { skip = false; return; }
    if (dirty) {
      var target = location.hash;
      skip = true; location.hash = lastHash;
      modal({ title: "¿Salir sin guardar?", html: "Tenés cambios sin guardar en este formulario.", ok: "Salir sin guardar", danger: true }).then(function (y) {
        if (y) { dirty = false; location.hash = target; }
      });
      return;
    }
    lastHash = location.hash;
    route();
  });
  window.addEventListener("beforeunload", function (e) { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  function boot() {
    api("GET", "/estado").then(function (j) {
      if (j.faltan && j.faltan.length) return showSetup(j.faltan);
      if (!j.sesion) return showLogin();
      return api("GET", "/catalogo").then(function (c) { CAT = c; route(); });
    }).catch(function (e) { if (e.message !== "401") app.innerHTML = '<p class="ad-muted">No se pudo conectar con el servidor. Recargá la página.</p>'; });
  }

  // ---------- Formularios ----------
  function viewFormularios() {
    dirty = false;
    setTop(true, "formularios");
    app.innerHTML = '<p class="ad-muted">Cargando formularios…</p>';
    api("GET", "/formularios").then(function (j) {
      var list = j.formularios || [];
      app.innerHTML = '<div class="ad-head"><div><h1 class="ad-h1">Formularios</h1><p class="ad-muted">Creá un formulario, copiá su enlace y mandáselo al cliente por WhatsApp.</p></div>' +
        '<div class="ad-new"><button class="btn btn-primary" type="button" id="ad-new">+ Nuevo formulario</button>' +
        '<div class="ad-menu" id="ad-new-menu" hidden><button type="button" data-plantilla="alta_automotor">Desde «Alta automotor»</button><button type="button" data-plantilla="en_blanco">En blanco</button></div></div></div>' +
        (list.length ? '<div class="ad-forms">' + list.map(cardForm).join("") + "</div>" : '<div class="ad-card"><p class="ad-muted">Todavía no hay formularios.</p></div>');
      $("ad-new").addEventListener("click", function () { var m = $("ad-new-menu"); m.hidden = !m.hidden; });
      $("ad-new-menu").addEventListener("click", function (e) {
        var b = e.target.closest("[data-plantilla]"); if (!b) return;
        api("POST", "/formularios", { plantilla: b.getAttribute("data-plantilla") }).then(function (r) {
          if (r.ok) { toast("Formulario creado. Está desactivado hasta que lo actives."); location.hash = "#/formularios/" + r.formulario.id; }
        });
      });
      app.querySelectorAll("[data-act]").forEach(function (b) { b.addEventListener("click", formAction); });
      app.querySelectorAll("[data-toggle]").forEach(function (c) { c.addEventListener("change", toggleActive); });
    }).catch(function () {});
  }

  function cardForm(f) {
    var url = publicUrl(f.slug);
    return '<article class="ad-card ad-form' + (f.active ? "" : " is-off") + '" data-id="' + esc(f.id) + '">' +
      '<div class="ad-form-top"><span class="ad-chip">' + esc(f.ramo) + '</span>' +
      '<label class="ad-switch" title="Activar o desactivar"><input type="checkbox" data-toggle="' + esc(f.id) + '"' + (f.active ? " checked" : "") + '><span></span><b>' + (f.active ? "Activo" : "Inactivo") + "</b></label></div>" +
      '<h2 class="ad-h2">' + esc(f.title) + "</h2>" +
      '<p class="ad-muted ad-small"><a href="#/respuestas?formulario=' + esc(f.id) + '">' + f.respuestas + (f.respuestas === 1 ? " respuesta" : " respuestas") + "</a> · Editado " + esc(fecha(f.updatedAt)) + "</p>" +
      '<div class="ad-linkbox"><input type="text" readonly value="' + esc(url) + '" aria-label="Enlace del formulario"><button class="btn btn-primary btn-sm" type="button" data-act="copiar" data-url="' + esc(url) + '">Copiar enlace</button></div>' +
      '<div class="ad-actions">' +
      '<a class="ad-btn" href="https://wa.me/?text=' + encodeURIComponent("Hola, te paso el formulario para completar tus datos: " + url) + '" target="_blank" rel="noopener">Enviar por WhatsApp</a>' +
      '<a class="ad-btn" href="' + esc(url) + '" target="_blank" rel="noopener">Ver</a>' +
      '<a class="ad-btn" href="#/formularios/' + esc(f.id) + '">Editar</a>' +
      '<button class="ad-btn" type="button" data-act="duplicar">Duplicar</button>' +
      '<button class="ad-btn" type="button" data-act="enlace">Nuevo enlace</button>' +
      '<button class="ad-btn ad-btn--danger" type="button" data-act="eliminar">Eliminar</button></div></article>';
  }

  function toggleActive(e) {
    var id = e.target.getAttribute("data-toggle"), on = e.target.checked;
    api("POST", "/formularios/" + id + "/activo", { activo: on }).then(function (r) {
      if (!r.ok) { e.target.checked = !on; toast(r.error || "No se pudo cambiar.", true); return; }
      toast(on ? "Formulario activado: el enlace ya funciona." : "Formulario desactivado: el enlace deja de funcionar.");
      viewFormularios();
    }).catch(function () {});
  }

  function formAction(e) {
    var b = e.currentTarget, act = b.getAttribute("data-act"), card = b.closest("[data-id]"), id = card && card.getAttribute("data-id");
    if (act === "copiar") { copy(b.getAttribute("data-url")).then(function () { toast("Enlace copiado. Pegalo en WhatsApp."); }); return; }
    if (act === "duplicar") {
      api("POST", "/formularios/" + id + "/duplicar").then(function (r) { if (r.ok) { toast("Copia creada (desactivada)."); viewFormularios(); } }).catch(function () {});
      return;
    }
    if (act === "enlace") {
      modal({ title: "¿Generar un enlace nuevo?", html: "El enlace actual va a dejar de funcionar. Usalo si mandaste el enlace a alguien por error o querés anularlo. Las respuestas recibidas no se borran.", ok: "Generar enlace nuevo" }).then(function (yes) {
        if (!yes) return;
        api("POST", "/formularios/" + id + "/nuevo-enlace").then(function (r) { if (r.ok) { toast("Enlace nuevo generado. El anterior ya no funciona."); viewFormularios(); } }).catch(function () {});
      });
      return;
    }
    if (act === "eliminar") {
      modal({ title: "¿Eliminar este formulario?", html: "El enlace deja de funcionar y el formulario se borra. Las respuestas que ya recibiste <b>no</b> se borran: siguen en Respuestas.", ok: "Eliminar formulario", danger: true, typeText: "ELIMINAR" }).then(function (yes) {
        if (!yes) return;
        api("DELETE", "/formularios/" + id).then(function (r) { if (r.ok) { toast("Formulario eliminado."); viewFormularios(); } }).catch(function () {});
      });
    }
  }

  // ---------- Editor ----------
  var ED = null; // formulario en edición

  function viewEditor(id) {
    setTop(true, "formularios");
    app.innerHTML = '<p class="ad-muted">Cargando…</p>';
    api("GET", "/formularios/" + id).then(function (j) {
      if (!j.ok) { app.innerHTML = '<p class="ad-muted">' + esc(j.error) + ' <a href="#/formularios">Volver</a></p>'; return; }
      ED = JSON.parse(JSON.stringify(j.formulario));
      ED.sections.forEach(function (s) { s.fields.forEach(function (f) { if (Array.isArray(f.options)) f.options = f.options.join("\n"); }); });
      dirty = false;
      drawEditor();
    }).catch(function () {});
  }

  var TYPE_ORDER = ["text", "textarea", "number", "dni", "tel", "email", "date", "select", "photo", "document", "cbu", "card", "consent", "note"];

  function selectFields(exceptId) {
    var out = [];
    ED.sections.forEach(function (s) { s.fields.forEach(function (f) { if (f.type === "select" && f.id !== exceptId) out.push(f); }); });
    return out;
  }

  function fieldEditor(f, si, fi) {
    var p = "s" + si + "f" + fi;
    var typeSel = '<select data-k="type">' + TYPE_ORDER.map(function (t) { return '<option value="' + t + '"' + (f.type === t ? " selected" : "") + ">" + esc(CAT.tipos[t]) + "</option>"; }).join("") + "</select>";
    var conds = selectFields(f.id);
    var condRef = f.show && conds.filter(function (c) { return c.id === f.show.field; })[0];
    var condOpts = condRef ? String(condRef.options || "").split("\n").filter(Boolean) : [];
    var rows = [
      '<label class="ad-f ad-f--wide">Tipo de campo' + typeSel + "</label>",
      f.type === "note"
        ? '<label class="ad-f ad-f--full">Texto de la aclaración<textarea data-k="label" rows="3">' + esc(f.label) + "</textarea></label>"
        : '<label class="ad-f ad-f--full">Pregunta o dato que pedís<input data-k="label" value="' + esc(f.label) + '"></label>'
    ];
    if (f.type !== "note") {
      rows.push('<label class="ad-f ad-f--full">Ayuda debajo del campo <span class="opt">(opcional)</span><input data-k="help" value="' + esc(f.help || "") + '"></label>');
      if (["text", "textarea", "number", "dni", "tel", "email", "cbu", "card"].indexOf(f.type) >= 0) rows.push('<label class="ad-f">Ejemplo dentro del campo<input data-k="placeholder" value="' + esc(f.placeholder || "") + '"></label>');
      if (f.type === "select") rows.push('<label class="ad-f ad-f--full">Opciones (una por línea)<textarea data-k="options" rows="4">' + esc(f.options || "") + "</textarea></label>");
      if (f.type === "number") rows.push('<label class="ad-f">Mínimo<input data-k="min" inputmode="decimal" value="' + esc(f.min == null ? "" : f.min) + '"></label><label class="ad-f">Máximo<input data-k="max" inputmode="decimal" value="' + esc(f.max == null ? "" : f.max) + '"></label>');
      if (f.type === "photo" || f.type === "document") rows.push('<label class="ad-f">Cantidad máxima<select data-k="max">' + [1, 2, 3, 4, 5].map(function (n) { return "<option" + (+f.max === n ? " selected" : "") + ">" + n + "</option>"; }).join("") + "</select></label>");
      if (f.type === "photo") rows.push('<label class="ad-f">Dibujo de referencia<select data-k="illustration">' + [["", "Ninguno"], ["frente", "Auto de frente"], ["trasera", "Auto de atrás"], ["izquierdo", "Lateral izquierdo"], ["derecho", "Lateral derecho"], ["cedula", "Tarjeta / documento"]].map(function (o) { return '<option value="' + o[0] + '"' + ((f.illustration || "") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>");
      if (f.type === "consent") rows.push('<label class="ad-f">Enlace de la política<input data-k="link" value="' + esc(f.link || "/pages/privacidad.html") + '"></label>');
      rows.push('<label class="ad-f">Se usa en el listado como<select data-k="role">' + [["", "—"], ["nombre", "Nombre del cliente"], ["dni", "DNI"], ["telefono", "Teléfono"], ["email", "Correo"]].map(function (o) { return '<option value="' + o[0] + '"' + ((f.role || "") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>");
      rows.push('<label class="ad-check"><input type="checkbox" data-k="required"' + (f.required ? " checked" : "") + "> Obligatorio</label>");
      rows.push('<label class="ad-check"><input type="checkbox" data-k="half"' + (f.width === "half" ? " checked" : "") + "> Media fila en compu</label>");
    } else {
      rows.push('<label class="ad-f">Estilo<select data-k="variant"><option value="info"' + (f.variant !== "warning" ? " selected" : "") + '>Informativa</option><option value="warning"' + (f.variant === "warning" ? " selected" : "") + ">Importante</option></select></label>");
    }
    rows.push('<div class="ad-f ad-f--full ad-cond"><span>Mostrar solo si</span><select data-k="showField"><option value="">Siempre visible</option>' + conds.map(function (c) { return '<option value="' + esc(c.id) + '"' + (f.show && f.show.field === c.id ? " selected" : "") + ">" + esc(c.label) + "</option>"; }).join("") + "</select>" +
      (condRef ? '<span>es</span><select data-k="showValue">' + condOpts.map(function (o) { return '<option' + (f.show && f.show.value === o ? " selected" : "") + ">" + esc(o) + "</option>"; }).join("") + "</select>" : "") + "</div>");
    return '<div class="ad-field' + (f._open ? " is-open" : "") + '" data-si="' + si + '" data-fi="' + fi + '">' +
      '<div class="ad-field-head"><button type="button" class="ad-field-title" data-ed="toggle" aria-expanded="' + !!f._open + '"><span class="ad-type">' + esc(CAT.tipos[f.type] || f.type) + "</span><b>" + esc(f.label || "(sin texto)") + "</b>" + (f.required ? '<span class="ad-req">Obligatorio</span>' : "") + (f.show ? '<span class="ad-cond-tag">Condicional</span>' : "") + "</button>" +
      '<div class="ad-mini"><button type="button" data-ed="up" aria-label="Subir campo" title="Subir">↑</button><button type="button" data-ed="down" aria-label="Bajar campo" title="Bajar">↓</button><button type="button" data-ed="dup" aria-label="Duplicar campo" title="Duplicar">⧉</button><button type="button" data-ed="del" aria-label="Eliminar campo" title="Eliminar" class="is-danger">✕</button></div></div>' +
      (f._open ? '<div class="ad-field-body" id="' + p + '">' + rows.join("") + "</div>" : "") + "</div>";
  }

  function drawEditor() {
    var url = publicUrl(ED.slug);
    app.innerHTML = '<div class="ad-head"><div><a class="ad-back" href="#/formularios">← Formularios</a><h1 class="ad-h1">Editar formulario</h1></div>' +
      '<div class="ad-head-actions"><a class="btn btn-outline btn-sm" href="' + esc(url) + '" target="_blank" rel="noopener">Vista previa</a><button class="btn btn-primary btn-sm" type="button" id="ad-save">Guardar cambios</button></div></div>' +
      (ED.active ? "" : '<p class="ad-note">Este formulario está <b>desactivado</b>: el enlace no funciona hasta que lo actives en la lista de formularios.</p>') +
      '<div class="form-status" id="ad-ed-status" role="alert"></div>' +
      '<section class="ad-card ad-meta"><div class="ad-grid">' +
      '<label class="ad-f ad-f--wide">Título<input id="m-title" value="' + esc(ED.title) + '" maxlength="120"></label>' +
      '<label class="ad-f">Ramo<select id="m-ramo">' + CAT.ramos.map(function (r) { return "<option" + (ED.ramo === r ? " selected" : "") + ">" + esc(r) + "</option>"; }).join("") + "</select></label>" +
      '<label class="ad-f ad-f--full">Texto de presentación<textarea id="m-desc" rows="3">' + esc(ED.description) + "</textarea></label>" +
      '<label class="ad-f">Texto del botón final<input id="m-submit" value="' + esc(ED.submitLabel) + '" maxlength="40"></label>' +
      '<label class="ad-f ad-f--wide">Mensaje al terminar<textarea id="m-success" rows="3">' + esc(ED.successMessage) + "</textarea></label></div></section>" +
      ED.sections.map(function (s, si) {
        return '<section class="ad-card ad-section" data-si="' + si + '"><div class="ad-section-head"><span class="ad-step">Paso ' + (si + 1) + "</span>" +
          '<div class="ad-mini"><button type="button" data-sec="up" title="Subir paso" aria-label="Subir paso">↑</button><button type="button" data-sec="down" title="Bajar paso" aria-label="Bajar paso">↓</button><button type="button" data-sec="del" class="is-danger" title="Eliminar paso" aria-label="Eliminar paso">✕</button></div></div>' +
          '<div class="ad-grid"><label class="ad-f ad-f--full">Título del paso<input data-s="title" value="' + esc(s.title) + '"></label>' +
          '<label class="ad-f ad-f--full">Explicación <span class="opt">(opcional)</span><textarea data-s="description" rows="2">' + esc(s.description || "") + "</textarea></label></div>" +
          '<div class="ad-fields">' + s.fields.map(function (f, fi) { return fieldEditor(f, si, fi); }).join("") + "</div>" +
          '<div class="ad-add"><select data-add-type aria-label="Tipo de campo a agregar">' + TYPE_ORDER.map(function (t) { return '<option value="' + t + '">' + esc(CAT.tipos[t]) + "</option>"; }).join("") + '</select><button class="btn btn-outline btn-sm" type="button" data-sec="add">+ Agregar campo</button></div></section>';
      }).join("") +
      '<button class="btn btn-outline" type="button" id="ad-add-sec">+ Agregar paso</button>' +
      '<div class="ad-savebar"><span id="ad-dirty" class="ad-muted"></span><button class="btn btn-primary" type="button" id="ad-save2">Guardar cambios</button></div>';

    var metaMap = { "m-title": "title", "m-ramo": "ramo", "m-desc": "description", "m-submit": "submitLabel", "m-success": "successMessage" };
    Object.keys(metaMap).forEach(function (id) { $(id).addEventListener("input", function (e) { ED[metaMap[id]] = e.target.value; markDirty(); }); });
    $("ad-save").addEventListener("click", saveEditor);
    $("ad-save2").addEventListener("click", saveEditor);
    $("ad-add-sec").addEventListener("click", function () { ED.sections.push({ title: "Nuevo paso", description: "", fields: [] }); markDirty(); redraw(); });
    app.querySelectorAll(".ad-section").forEach(function (sec) {
      var si = +sec.getAttribute("data-si"), S = ED.sections[si];
      sec.querySelectorAll("[data-s]").forEach(function (el) { el.addEventListener("input", function () { S[el.getAttribute("data-s")] = el.value; markDirty(); }); });
      sec.querySelectorAll("[data-sec]").forEach(function (b) {
        b.addEventListener("click", function () {
          var a = b.getAttribute("data-sec");
          if (a === "add") {
            var t = sec.querySelector("[data-add-type]").value;
            var nf = { id: "", type: t, label: t === "note" ? "Escribí la aclaración" : CAT.tipos[t], required: t !== "note", _open: true, width: "full" };
            if (t === "select") nf.options = "Opción 1\nOpción 2";
            if (t === "photo" || t === "document") nf.max = 1;
            S.fields.push(nf); markDirty(); redraw(); return;
          }
          if (a === "up" && si > 0) { ED.sections.splice(si - 1, 0, ED.sections.splice(si, 1)[0]); markDirty(); redraw(); }
          if (a === "down" && si < ED.sections.length - 1) { ED.sections.splice(si + 1, 0, ED.sections.splice(si, 1)[0]); markDirty(); redraw(); }
          if (a === "del") {
            modal({ title: "¿Eliminar este paso?", html: "Se borran el paso «" + esc(S.title) + "» y sus " + S.fields.length + " campos. Se aplica cuando guardes.", ok: "Eliminar paso", danger: true }).then(function (y) { if (y) { ED.sections.splice(si, 1); markDirty(); redraw(); } });
          }
        });
      });
      sec.querySelectorAll(".ad-field").forEach(function (box) {
        var fi = +box.getAttribute("data-fi"), F = S.fields[fi];
        box.querySelectorAll("[data-ed]").forEach(function (b) {
          b.addEventListener("click", function () {
            var a = b.getAttribute("data-ed");
            if (a === "toggle") { F._open = !F._open; redraw(); return; }
            if (a === "up" && fi > 0) { S.fields.splice(fi - 1, 0, S.fields.splice(fi, 1)[0]); }
            else if (a === "down" && fi < S.fields.length - 1) { S.fields.splice(fi + 1, 0, S.fields.splice(fi, 1)[0]); }
            else if (a === "dup") { var c = JSON.parse(JSON.stringify(F)); c.id = ""; c.label = c.label + " (copia)"; c.role = ""; S.fields.splice(fi + 1, 0, c); }
            else if (a === "del") { S.fields.splice(fi, 1); }
            else return;
            markDirty(); redraw();
          });
        });
        box.querySelectorAll("[data-k]").forEach(function (el) {
          var ev = el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input";
          el.addEventListener(ev, function () {
            var k = el.getAttribute("data-k");
            if (k === "required") F.required = el.checked;
            else if (k === "half") F.width = el.checked ? "half" : "full";
            else if (k === "showField") { F.show = el.value ? { field: el.value, value: "" } : null; var ref = selectFields(F.id).filter(function (c) { return c.id === el.value; })[0]; if (ref && F.show) F.show.value = String(ref.options || "").split("\n").filter(Boolean)[0] || ""; markDirty(); redraw(); return; }
            else if (k === "showValue") { if (F.show) F.show.value = el.value; }
            else if (k === "type") { F.type = el.value; if (F.type === "select" && !F.options) F.options = "Opción 1\nOpción 2"; if ((F.type === "photo" || F.type === "document") && !F.max) F.max = 1; markDirty(); redraw(); return; }
            else F[k] = el.value;
            markDirty();
            if (k === "label") { var t = box.querySelector(".ad-field-title b"); if (t) t.textContent = el.value || "(sin texto)"; }
          });
        });
      });
    });
    function redraw() { var y = window.scrollY; drawEditor(); window.scrollTo(0, y); }
  }

  function markDirty() { dirty = true; var d = $("ad-dirty"); if (d) d.textContent = "Hay cambios sin guardar."; }

  function saveEditor() {
    var box = $("ad-ed-status");
    var payload = JSON.parse(JSON.stringify(ED));
    payload.sections.forEach(function (s) { s.fields.forEach(function (f) { delete f._open; if (f.type === "select") f.options = String(f.options || "").split("\n"); }); });
    api("PUT", "/formularios/" + ED.id, payload).then(function (j) {
      if (!j.ok) {
        box.innerHTML = "<b>No se guardó:</b> " + esc((j.errors || [j.error]).join(" "));
        box.className = "form-status is-visible is-error";
        box.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      var open = {};
      ED.sections.forEach(function (s, si) { s.fields.forEach(function (f, fi) { if (f._open) open[si + "-" + fi] = 1; }); });
      ED = j.formulario;
      ED.sections.forEach(function (s, si) { s.fields.forEach(function (f, fi) { if (Array.isArray(f.options)) f.options = f.options.join("\n"); if (open[si + "-" + fi]) f._open = true; }); });
      dirty = false;
      var y = window.scrollY; drawEditor(); window.scrollTo(0, y);
      toast("Cambios guardados.");
    }).catch(function () {});
  }

  // ---------- Respuestas ----------
  function viewRespuestas(params) {
    dirty = false;
    setTop(true, "respuestas");
    app.innerHTML = '<p class="ad-muted">Cargando respuestas…</p>';
    Promise.all([api("GET", "/respuestas"), api("GET", "/formularios")]).then(function (res) {
      var all = res[0].respuestas || [], forms = res[1].formularios || [];
      var fSel = params.get("formulario") || "", eSel = params.get("estado") || "";
      var titles = {};
      all.forEach(function (s) { titles[s.formId] = s.formTitle; });
      forms.forEach(function (f) { titles[f.id] = f.title; });
      app.innerHTML = '<div class="ad-head"><div><h1 class="ad-h1">Respuestas</h1><p class="ad-muted">Las solicitudes que completaron tus clientes.</p></div></div>' +
        '<div class="ad-filters"><label class="ad-f">Formulario<select id="r-form"><option value="">Todos</option>' + Object.keys(titles).map(function (id) { return '<option value="' + esc(id) + '"' + (fSel === id ? " selected" : "") + ">" + esc(titles[id]) + "</option>"; }).join("") + "</select></label>" +
        '<label class="ad-f">Estado<select id="r-estado"><option value="">Todos</option>' + CAT.estados.map(function (e) { return '<option value="' + e.id + '"' + (eSel === e.id ? " selected" : "") + ">" + esc(e.label) + "</option>"; }).join("") + "</select></label>" +
        '<label class="ad-f ad-f--wide">Buscar<input id="r-q" type="search" placeholder="Nombre, DNI o referencia"></label></div>' +
        '<div id="r-list"></div>';
      function draw() {
        var q = $("r-q").value.trim().toLowerCase(), f = $("r-form").value, e = $("r-estado").value;
        var rows = all.filter(function (s) {
          return (!f || s.formId === f) && (!e || s.status === e) && (!q || (s.nombre + " " + s.dni + " " + s.ref).toLowerCase().indexOf(q) >= 0);
        });
        $("r-list").innerHTML = rows.length ? '<div class="ad-table" role="table" aria-label="Respuestas"><div class="ad-tr ad-th" role="row"><span role="columnheader">Cliente</span><span role="columnheader">DNI</span><span role="columnheader">Formulario</span><span role="columnheader">Recibida</span><span role="columnheader">Estado</span></div>' +
          rows.map(function (s) {
            return '<a class="ad-tr" role="row" href="#/respuestas/' + esc(s.id) + '"><span role="cell" class="ad-name">' + esc(s.nombre || "(sin nombre)") + '<small>' + esc(s.ref) + '</small></span><span role="cell">' + esc(s.dni || "—") + '</span><span role="cell">' + esc(s.ramo) + "<small>" + esc(s.formTitle) + '</small></span><span role="cell">' + esc(fecha(s.createdAt)) + '</span><span role="cell"><span class="ad-status ad-status--' + esc(s.status) + '">' + esc(estadoLabel(s.status)) + "</span></span></a>";
          }).join("") + "</div>" : '<div class="ad-card"><p class="ad-muted">' + (all.length ? "No hay respuestas con esos filtros." : "Todavía no llegó ninguna respuesta.") + "</p></div>";
      }
      ["r-form", "r-estado"].forEach(function (id) { $(id).addEventListener("change", function () {
        var p = new URLSearchParams(); if ($("r-form").value) p.set("formulario", $("r-form").value); if ($("r-estado").value) p.set("estado", $("r-estado").value);
        history.replaceState(null, "", "#/respuestas" + (p.toString() ? "?" + p : "")); draw();
      }); });
      $("r-q").addEventListener("input", draw);
      draw();
    }).catch(function () {});
  }

  function viewRespuesta(id) {
    dirty = false;
    setTop(true, "respuestas");
    app.innerHTML = '<p class="ad-muted">Cargando solicitud…</p>';
    api("GET", "/respuestas/" + id).then(function (j) {
      if (!j.ok) { app.innerHTML = '<p class="ad-muted">' + esc(j.error) + ' <a href="#/respuestas">Volver</a></p>'; return; }
      var s = j.respuesta, files = s.files || {};
      var fileUrl = function (fid, ver) { return "/api/admin/respuestas/" + encodeURIComponent(s.id) + "/archivo/" + encodeURIComponent(fid) + (ver ? "?ver=1" : ""); };
      var allFiles = [];
      var blocks = (s.campos || []).map(function (sec) {
        var rows = sec.fields.map(function (f) {
          if (!(f.id in s.data)) return "";
          var v = s.data[f.id];
          if (files[f.id]) {
            return '<div class="ad-dt ad-dt--files"><span>' + esc(f.label) + '</span><div class="ad-thumbs">' + files[f.id].map(function (x, i) {
              allFiles.push({ id: x.id, name: f.id + (files[f.id].length > 1 ? "-" + (i + 1) : "") + "." + x.ext });
              var img = /^image\/(jpeg|png|webp)$/.test(x.type);
              return '<figure class="ad-thumb">' + (img ? '<a href="' + fileUrl(x.id, true) + '" target="_blank" rel="noopener"><img src="' + fileUrl(x.id, true) + '" alt="' + esc(f.label) + '" loading="lazy"></a>' : '<a class="ad-thumb-doc" href="' + fileUrl(x.id, true) + '" target="_blank" rel="noopener">' + esc(x.ext.toUpperCase()) + "</a>") +
                '<figcaption><a href="' + fileUrl(x.id) + '" download>Descargar</a> · ' + (x.size < 1024 * 1024 ? Math.max(1, Math.round(x.size / 1024)) + " KB" : (x.size / 1024 / 1024).toFixed(1).replace(".", ",") + " MB") + "</figcaption></figure>";
            }).join("") + "</div></div>";
          }
          var sens = s.cifrados.indexOf(f.id) >= 0;
          return '<div class="ad-dt"><span>' + esc(f.label) + '</span><b' + (sens ? ' class="ad-sens" data-campo="' + esc(f.id) + '"' : "") + ">" + esc(f.type === "date" ? v.split("-").reverse().join("/") : v) + (sens ? ' <button type="button" class="ad-btn ad-btn--sm" data-reveal="' + esc(f.id) + '">Mostrar completo</button>' : "") + "</b></div>";
        }).join("");
        return rows ? '<section class="ad-card"><h2 class="ad-h2">' + esc(sec.title) + "</h2>" + rows + "</section>" : "";
      }).join("");

      app.innerHTML = '<div class="ad-head"><div><a class="ad-back" href="#/respuestas">← Respuestas</a><h1 class="ad-h1">' + esc(s.summary.nombre || "Solicitud") + '</h1><p class="ad-muted">' + esc(s.formTitle) + " · " + esc(s.ref) + " · Recibida el " + esc(fecha(s.createdAt)) + "</p></div>" +
        '<div class="ad-head-actions">' + (allFiles.length ? '<button class="btn btn-primary btn-sm" type="button" id="d-zip">Descargar todos los archivos (.zip)</button>' : "") + "</div></div>" +
        '<div class="ad-detail"><div class="ad-detail-main">' + blocks + "</div>" +
        '<aside class="ad-detail-side"><section class="ad-card"><h2 class="ad-h2">Seguimiento</h2>' +
        '<label class="ad-f">Estado<select id="d-estado">' + CAT.estados.map(function (e) { return '<option value="' + e.id + '"' + (s.status === e.id ? " selected" : "") + ">" + esc(e.label) + "</option>"; }).join("") + "</select></label>" +
        '<label class="ad-f">Nota interna <span class="opt">(solo la ves vos)</span><textarea id="d-nota" rows="3">' + esc(s.nota || "") + "</textarea></label>" +
        '<button class="btn btn-primary btn-sm btn-block" type="button" id="d-guardar">Guardar</button>' +
        (s.summary.telefono ? '<a class="btn btn-whatsapp btn-sm btn-block" href="https://wa.me/' + esc(waNumber(s.summary.telefono)) + '" target="_blank" rel="noopener">Escribirle por WhatsApp</a>' : "") + "</section>" +
        '<section class="ad-card"><h2 class="ad-h2">Historial</h2><ul class="ad-log">' + (s.log || []).slice().reverse().map(function (l) { return "<li><b>" + esc(fecha(l.at)) + "</b> " + esc(l.accion) + "</li>"; }).join("") + "</ul></section>" +
        '<section class="ad-card ad-danger-zone"><h2 class="ad-h2">Eliminar</h2>' +
        (s.cifrados.length ? '<button class="ad-btn ad-btn--danger" type="button" id="d-borrar-pago">Eliminar datos de pago</button><p class="ad-muted ad-small">Borra el CBU o la tarjeta y deja el resto de la solicitud. Útil una vez emitida la póliza.</p>' : "") +
        '<button class="ad-btn ad-btn--danger" type="button" id="d-borrar">Eliminar solicitud</button><p class="ad-muted ad-small">Antes de eliminar, verificá los plazos de conservación de documentación que te corresponden como productor.</p></section></aside></div>';

      $("d-guardar").addEventListener("click", function () {
        api("POST", "/respuestas/" + s.id + "/estado", { estado: $("d-estado").value, nota: $("d-nota").value }).then(function (r) { if (r.ok) { toast("Guardado."); viewRespuesta(s.id); } else toast(r.error, true); }).catch(function () {});
      });
      app.querySelectorAll("[data-reveal]").forEach(function (b) {
        b.addEventListener("click", function () {
          api("POST", "/respuestas/" + s.id + "/revelar", { campo: b.getAttribute("data-reveal") }).then(function (r) {
            if (!r.ok) { toast(r.error, true); return; }
            var holder = b.parentNode;
            holder.innerHTML = '<span class="ad-revealed">' + esc(r.valor) + '</span> <button type="button" class="ad-btn ad-btn--sm" data-copy>Copiar</button>';
            holder.querySelector("[data-copy]").addEventListener("click", function () { copy(r.valor).then(function () { toast("Copiado."); }); });
          }).catch(function () {});
        });
      });
      if ($("d-zip")) $("d-zip").addEventListener("click", function () { downloadZip(s, allFiles, fileUrl); });
      if ($("d-borrar-pago")) $("d-borrar-pago").addEventListener("click", function () {
        modal({ title: "¿Eliminar los datos de pago?", html: "Se borran del sistema el CBU o el número de tarjeta de esta solicitud. No se puede deshacer.", ok: "Eliminar datos de pago", danger: true }).then(function (y) {
          if (y) api("POST", "/respuestas/" + s.id + "/borrar-pago").then(function () { toast("Datos de pago eliminados."); viewRespuesta(s.id); }).catch(function () {});
        });
      });
      $("d-borrar").addEventListener("click", function () {
        modal({ title: "¿Eliminar esta solicitud?", html: "Se borran los datos y todos los archivos de <b>" + esc(s.summary.nombre || s.ref) + "</b>. No se puede deshacer. Si la necesitás, descargá antes los archivos.", ok: "Eliminar solicitud", danger: true, typeText: "ELIMINAR" }).then(function (y) {
          if (y) api("DELETE", "/respuestas/" + s.id).then(function (r) { if (r.ok) { toast("Solicitud eliminada."); location.hash = "#/respuestas"; } }).catch(function () {});
        });
      });
    }).catch(function () {});
  }

  function waNumber(tel) {
    var d = String(tel).replace(/\D/g, "").replace(/^0/, "");
    if (d.indexOf("54") === 0) return d;
    d = d.replace(/^(\d{2,4})15/, "$1");
    return "549" + d;
  }

  // ---------- ZIP (sin compresión, armado en el navegador) ----------
  var CRC = (function () { var t = [], c, n, k; for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xffffffff; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function makeZip(entries) {
    var parts = [], central = [], offset = 0, enc = new TextEncoder();
    var d = new Date(), dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)), dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate());
    entries.forEach(function (e) {
      var name = enc.encode(e.name), data = e.data, crc = crc32(data);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dt, true); h.setUint16(12, dd, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, dt, true); c.setUint16(14, dd, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var size = central.reduce(function (a, p) { return a + p.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: "application/zip" });
  }
  function downloadZip(s, list, fileUrl) {
    var btn = $("d-zip"); btn.disabled = true; btn.textContent = "Preparando…";
    var base = (s.summary.nombre || s.ref).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "solicitud";
    Promise.all(list.map(function (f) {
      return fetch(fileUrl(f.id), { credentials: "same-origin" }).then(function (r) { if (!r.ok) throw new Error(); return r.arrayBuffer(); }).then(function (b) { return { name: f.name, data: new Uint8Array(b) }; });
    })).then(function (entries) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(makeZip(entries));
      a.download = base + "_" + s.ref + ".zip";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    }).catch(function () { toast("No se pudieron descargar los archivos.", true); }).then(function () { btn.disabled = false; btn.textContent = "Descargar todos los archivos (.zip)"; });
  }

  boot();
})();
