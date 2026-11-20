/* Panel privado · Organización de Productores — SegurosArnedo.com.
   Se engancha en js/admin.js (rutas #/productores...). Todo se pide a
   /api/admin/productores, que comprueba la sesión en el servidor. */
(function () {
  "use strict";

  var P = function () { return window.JMAPanel; };
  var ESTADOS = {};
  var TIPOS = {};
  var ORDEN = ["recibida", "revision", "documentacion", "gestion", "aprobada", "rechazada"];
  var TIPO_CORTO = { nuevo: "Productor nuevo", activo: "Sumar aseguradoras", info: "Información" };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return P().esc(s); }
  function dmy(iso) { return iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : ""; }
  function hoy() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  function badge(e) { return '<span class="pr-st pr-st--' + esc(e) + '">' + esc(ESTADOS[e] || e) + "</span>"; }
  function fmtCuit(c) { c = String(c || ""); return c.length === 11 ? c.slice(0, 2) + "-" + c.slice(2, 10) + "-" + c.slice(10) : c; }
  function opcionesEstado(sel) {
    return ORDEN.map(function (id) { return '<option value="' + id + '"' + (sel === id ? " selected" : "") + ">" + esc(ESTADOS[id] || id) + "</option>"; }).join("");
  }
  function guardarCatalogo(j) {
    if (j.estados) ESTADOS = j.estados;
    if (j.tipos) TIPOS = j.tipos;
  }
  function mostrarErrores(box, errors) {
    box.querySelectorAll(".has-error").forEach(function (el) { el.classList.remove("has-error"); });
    box.querySelectorAll(".pr-err").forEach(function (el) { el.textContent = ""; });
    Object.keys(errors || {}).forEach(function (k) {
      var el = box.querySelector('[data-k="' + k + '"]');
      if (!el) return;
      var f = el.closest(".ad-f") || el;
      f.classList.add("has-error");
      var m = f.querySelector(".pr-err");
      if (m) m.textContent = errors[k];
    });
  }

  function route(parts, params) {
    P().setTop(true, "productores");
    if (parts[0] === "aseguradoras") return viewAseguradoras();
    if (parts[0] && parts[1] === "editar") return viewEditar(parts[0]);
    if (parts[0]) return viewFicha(parts[0]);
    return viewLista(params);
  }

  /* ---------- Listado ---------- */
  function viewLista(params) {
    var app = P().app;
    app.innerHTML = '<p class="ad-muted">Cargando productores…</p>';
    P().api("GET", "/productores").then(function (j) {
      if (!j.ok) { app.innerHTML = '<p class="ad-muted">' + esc(j.error || "No se pudo cargar.") + "</p>"; return; }
      guardarCatalogo(j);
      var all = j.solicitudes || [], k = j.indicadores || {};
      var nombres = {};
      (j.aseguradoras || []).forEach(function (a) { nombres[a.id] = a.nombre; });
      var eSel = params.get("estado") || "", tSel = params.get("tipo") || "", aSel = params.get("aseguradora") || "";
      var kpi = function (id, n, label, extra) {
        return '<button type="button" class="pr-kpi' + (eSel === id && id ? " is-active" : "") + (extra || "") + '" data-kpi="' + id + '"><b>' + (n || 0) + "</b><span>" + label + "</span></button>";
      };
      app.innerHTML = '<div class="ad-head"><div><h1 class="ad-h1">Organización de Productores</h1><p class="ad-muted">Solicitudes que llegaron desde la web y el seguimiento de cada apertura de código.</p></div>' +
        '<div class="ad-head-actions"><a class="ad-btn" href="#/productores/aseguradoras">Aseguradoras</a>' +
        '<a class="ad-btn" href="/api/admin/productores/exportar?tipo=productores" download>Exportar productores (Excel/CSV)</a>' +
        '<a class="ad-btn" href="/api/admin/productores/exportar?tipo=gestiones" download>Exportar gestiones (Excel/CSV)</a></div></div>' +
        '<div class="pr-kpis">' +
        kpi("", k.productores, "Productores registrados", " pr-kpi--total") +
        kpi("recibida", k.nuevas, "Nuevas solicitudes") +
        kpi("pendientes", k.pendientes, "Pendientes") +
        kpi("gestion", k.gestion, "En gestión") +
        kpi("aprobada", k.aprobadas, "Aprobadas") +
        kpi("rechazada", k.rechazadas, "Rechazadas") +
        "</div>" +
        '<p class="ad-muted ad-small pr-kpi-note">' + (k.codigos || 0) + " código" + (k.codigos === 1 ? "" : "s") + " habilitado" + (k.codigos === 1 ? "" : "s") + " en total · " + (k.total || 0) + " solicitud" + (k.total === 1 ? "" : "es") + " (incluye pedidos de información). «Pendientes» suma «En revisión» y «Documentación pendiente».</p>" +
        '<div class="ad-filters pr-filters">' +
        '<label class="ad-f ad-f--wide">Buscar<input id="p-q" type="search" placeholder="Nombre, CUIT, DNI, matrícula o n.º de solicitud"></label>' +
        '<label class="ad-f">Estado<select id="p-estado"><option value="">Todos</option><option value="pendientes"' + (eSel === "pendientes" ? " selected" : "") + ">Pendientes (revisión + documentación)</option>" + opcionesEstado(eSel) + "</select></label>" +
        '<label class="ad-f">Tipo<select id="p-tipo"><option value="">Todos</option>' + Object.keys(TIPO_CORTO).map(function (t) { return '<option value="' + t + '"' + (tSel === t ? " selected" : "") + ">" + TIPO_CORTO[t] + "</option>"; }).join("") + "</select></label>" +
        '<label class="ad-f">Aseguradora<select id="p-aseg"><option value="">Todas</option>' + (j.aseguradoras || []).map(function (a) { return '<option value="' + esc(a.id) + '"' + (aSel === a.id ? " selected" : "") + ">" + esc(a.nombre) + (a.activa ? "" : " (inactiva)") + "</option>"; }).join("") + "</select></label>" +
        "</div><div id=\"p-list\"></div>";

      function draw() {
        var q = $("p-q").value.trim().toLowerCase(), qd = q.replace(/\D/g, "");
        var e = $("p-estado").value, t = $("p-tipo").value, a = $("p-aseg").value;
        app.querySelectorAll("[data-kpi]").forEach(function (b) { b.classList.toggle("is-active", !!e && b.getAttribute("data-kpi") === e); });
        var rows = all.filter(function (s) {
          if (e === "pendientes" ? (s.estado !== "revision" && s.estado !== "documentacion") : (e && s.estado !== e)) return false;
          if (t && s.tipo !== t) return false;
          if (a && (s.companias || []).indexOf(a) < 0) return false;
          if (!q) return true;
          var texto = (s.nombre + " " + s.ref + " " + s.localidad).toLowerCase();
          var nums = (s.cuit || "") + " " + (s.dni || "") + " " + (s.matricula || "");
          return texto.indexOf(q) >= 0 || (qd.length >= 3 && nums.indexOf(qd) >= 0);
        });
        $("p-list").innerHTML = rows.length ? '<div class="ad-table pr-table" role="table" aria-label="Productores"><div class="ad-tr ad-th" role="row"><span role="columnheader">Productor</span><span role="columnheader">CUIT · Matrícula</span><span role="columnheader">Teléfono</span><span role="columnheader">Tipo · Compañías</span><span role="columnheader">Ingreso</span><span role="columnheader">Estado</span></div>' +
          rows.map(function (s) {
            var comp = (s.companias || []).map(function (c) { return nombres[c] || c; }).join(", ");
            return '<a class="ad-tr" role="row" href="#/productores/' + esc(s.id) + '"><span role="cell" class="ad-name">' + esc(s.nombre) + "<small>" + esc(s.ref) + " · " + esc(s.localidad) + '</small></span><span role="cell">' + esc(fmtCuit(s.cuit) || "—") + "<small>" + (s.matricula ? "Mat. " + esc(s.matricula) : "") + '</small></span><span role="cell">' + esc(s.telefono || "—") + '</span><span role="cell">' + esc(TIPO_CORTO[s.tipo] || s.tipo) + "<small>" + esc(comp || "—") + '</small></span><span role="cell">' + esc(dmy(s.createdAt)) + '</span><span role="cell">' + badge(s.estado) + "</span></a>";
          }).join("") + "</div>" : '<div class="ad-card"><p class="ad-muted">' + (all.length ? "No hay solicitudes con esos filtros." : "Todavía no llegó ninguna solicitud. Cuando un productor complete el formulario de la web, va a aparecer acá.") + "</p></div>";
      }
      function syncUrl() {
        var p = new URLSearchParams();
        if ($("p-estado").value) p.set("estado", $("p-estado").value);
        if ($("p-tipo").value) p.set("tipo", $("p-tipo").value);
        if ($("p-aseg").value) p.set("aseguradora", $("p-aseg").value);
        history.replaceState(null, "", "#/productores" + (p.toString() ? "?" + p : ""));
      }
      ["p-estado", "p-tipo", "p-aseg"].forEach(function (id) { $(id).addEventListener("change", function () { syncUrl(); draw(); }); });
      $("p-q").addEventListener("input", draw);
      app.querySelectorAll("[data-kpi]").forEach(function (b) {
        b.addEventListener("click", function () {
          var v = b.getAttribute("data-kpi");
          $("p-estado").value = $("p-estado").value === v ? "" : v;
          syncUrl(); draw();
        });
      });
      draw();
    }).catch(function () {});
  }

  /* ---------- Ficha ---------- */
  function fila(label, v) { return v ? '<div class="ad-dt"><span>' + esc(label) + "</span><b>" + esc(v) + "</b></div>" : ""; }
  function siNo(v) { return v === "si" ? "Sí" : v === "no" ? "No" : v === "algunas" ? "En algunas" : ""; }

  function tarjetaGestion(g) {
    var id = esc(g.id);
    return '<div class="pr-gestion" data-gestion="' + id + '"><div class="pr-gestion-head"><h3>' + esc(g.nombre) + "</h3>" + badge(g.estado) + "</div>" +
      '<div class="pr-gestion-grid">' +
      '<label class="ad-f">Estado<select data-k="estado">' + opcionesEstado(g.estado) + '</select><span class="pr-err"></span></label>' +
      '<label class="ad-f">Inicio de gestión<input type="date" data-k="inicio" max="' + hoy() + '" value="' + esc(g.inicio) + '"><span class="pr-err"></span></label>' +
      '<label class="ad-f">Código asignado<input type="text" data-k="codigo" maxlength="40" value="' + esc(g.codigo) + '"><span class="pr-err"></span></label>' +
      '<label class="ad-f">Fecha de habilitación<input type="date" data-k="habilitada" max="' + hoy() + '" value="' + esc(g.habilitada) + '"><span class="pr-err"></span></label>' +
      '<label class="ad-f pr-span">Observaciones <span class="opt">(internas)</span><textarea data-k="obs" rows="2" maxlength="1000">' + esc(g.obs) + '</textarea><span class="pr-err"></span></label>' +
      "</div>" +
      '<div class="pr-gestion-actions"><button class="btn btn-primary btn-sm" type="button" data-g-save>Guardar</button><button class="ad-btn ad-btn--danger" type="button" data-g-del>Quitar</button>' + "</div></div>";
  }

  function viewFicha(id) {
    var app = P().app;
    app.innerHTML = '<p class="ad-muted">Cargando ficha…</p>';
    P().api("GET", "/productores/" + encodeURIComponent(id)).then(function (j) {
      if (!j.ok) { app.innerHTML = '<p class="ad-muted">' + esc(j.error) + ' <a href="#/productores">Volver</a></p>'; return; }
      guardarCatalogo(j);
      var s = j.solicitud, d = s.datos || {}, gs = s.gestiones || [];
      var usadas = gs.map(function (g) { return g.id; });
      var libres = (j.aseguradoras || []).filter(function (a) { return a.activa && usadas.indexOf(a.id) < 0; });
      var wa = d.telefono ? "https://wa.me/" + P().waNumber(d.telefono) + "?text=" + encodeURIComponent("Hola " + String(s.resumen.nombre || "").split(" ")[0] + ", te escribo de Seguros Arnedo por tu solicitud " + s.ref + " de la Organización de Productores.") : "";
      var mail = d.email ? "mailto:" + d.email + "?subject=" + encodeURIComponent("Seguros Arnedo · Organización de Productores · " + s.ref) : "";
      var archivos = (s.files || []).map(function (f) {
        var u = "/api/admin/productores/" + encodeURIComponent(s.id) + "/archivo/" + encodeURIComponent(f.id);
        return '<li><a href="' + u + '?ver=1" target="_blank" rel="noopener">' + esc(f.nombre) + '</a> <span class="ad-muted ad-small">(' + (f.size < 1048576 ? Math.max(1, Math.round(f.size / 1024)) + " KB" : (f.size / 1048576).toFixed(1).replace(".", ",") + " MB") + ')</span> · <a href="' + u + '" download>Descargar</a></li>';
      }).join("");

      var profesionales = s.tipo === "info" ? fila("Situación", { nuevo: "Se matriculó hace poco", activo: "Ya trabaja como productor", estudiante: "Está estudiando para matricularse", otro: "Otro" }[d.perfil]) + fila("Consulta", d.consulta) :
        fila("Matrícula SSN", d.matricula) + fila("Fecha de matriculación", dmy(d.fecha_matricula)) + fila("¿Primera experiencia?", siNo(d.primera_experiencia)) +
        fila("¿Trabaja con una organización?", siNo(d.trabaja_organizacion) + (d.organizacion ? " · " + d.organizacion : "")) +
        fila("Aseguradoras con las que trabaja", d.companias_actuales) + fila("¿Ya tiene código en las que pidió?", siNo(d.tiene_codigo) + (d.codigo_detalle ? " · " + d.codigo_detalle : "")) +
        fila("Comentarios", d.comentarios);

      app.innerHTML = '<div class="ad-head"><div><a class="ad-back" href="#/productores">← Productores</a><h1 class="ad-h1">' + esc(s.resumen.nombre) + "</h1>" +
        '<p class="ad-muted">' + esc(TIPOS[s.tipo] || s.tipo) + " · " + esc(s.ref) + " · Ingresó el " + esc(P().fecha(s.createdAt)) + "</p></div>" +
        '<div class="ad-head-actions">' + (wa ? '<a class="btn btn-whatsapp btn-sm" href="' + esc(wa) + '" target="_blank" rel="noopener">WhatsApp</a>' : "") +
        (mail ? '<a class="btn btn-outline btn-sm" href="' + esc(mail) + '">Enviar correo</a>' : "") +
        (s.datosDisponibles ? '<a class="btn btn-outline btn-sm" href="#/productores/' + esc(s.id) + '/editar">Editar datos</a>' : "") + "</div></div>" +
        (s.datosDisponibles ? "" : '<div class="form-status is-visible is-error">No se pudieron leer los datos personales guardados. Revisá que la variable DATA_KEY de Netlify sea la misma con la que se guardaron.</div>') +
        '<div class="ad-detail"><div class="ad-detail-main">' +
        '<section class="ad-card"><h2 class="ad-h2">Datos personales</h2>' + fila("Nombre y apellido", d.nombre || s.resumen.nombre) + fila("DNI", d.dni) + fila("CUIT", fmtCuit(d.cuit)) + fila("Teléfono / WhatsApp", d.telefono) + fila("Correo", d.email) + fila("Localidad", d.localidad || s.resumen.localidad) + fila("Provincia", d.provincia || s.resumen.provincia) + "</section>" +
        '<section class="ad-card"><h2 class="ad-h2">' + (s.tipo === "info" ? "Consulta" : "Datos profesionales") + "</h2>" + (profesionales || '<p class="ad-muted">Sin datos.</p>') + "</section>" +
        (s.tipo === "info" && !gs.length ? "" :
          '<section class="ad-card"><h2 class="ad-h2">Aseguradoras: solicitadas y habilitadas</h2><p class="ad-muted ad-small">Cada compañía tiene su propio seguimiento. Para marcar una apertura como «Aprobada» hace falta el código y la fecha de habilitación confirmados por la aseguradora.</p>' +
          (gs.length ? gs.map(tarjetaGestion).join("") : '<p class="ad-muted">Todavía no hay compañías en gestión.</p>') +
          (libres.length ? '<div class="pr-add"><label class="ad-f">Agregar aseguradora<select id="g-nueva"><option value="">Elegí una…</option>' + libres.map(function (a) { return '<option value="' + esc(a.id) + '">' + esc(a.nombre) + "</option>"; }).join("") + '</select></label><button class="ad-btn" type="button" id="g-agregar">Agregar</button></div>' : "") +
          "</section>") +
        (archivos ? '<section class="ad-card"><h2 class="ad-h2">Documentación</h2><ul class="pr-files">' + archivos + "</ul></section>" : "") +
        "</div>" +
        '<aside class="ad-detail-side">' +
        '<section class="ad-card"><h2 class="ad-h2">Estado general</h2><label class="ad-f"><span class="visually-hidden">Estado general</span><select id="s-estado">' + opcionesEstado(s.estado) + '</select></label><button class="btn btn-primary btn-sm btn-block" type="button" id="s-guardar">Guardar estado</button>' +
        '<p class="ad-muted ad-small">Habilitadas: ' + (gs.filter(function (g) { return g.estado === "aprobada"; }).map(function (g) { return esc(g.nombre) + (g.codigo ? " (" + esc(g.codigo) + ")" : ""); }).join(", ") || "ninguna todavía") + ".</p></section>" +
        '<section class="ad-card"><h2 class="ad-h2">Observaciones internas</h2><p class="ad-muted ad-small">Privadas: no las ve el productor.</p>' +
        '<ul class="pr-notas">' + (s.notas || []).slice().reverse().map(function (n) { return "<li><b>" + esc(P().fecha(n.at)) + (n.por ? " · " + esc(n.por) : "") + "</b><p>" + esc(n.texto) + "</p></li>"; }).join("") + "</ul>" +
        '<label class="ad-f"><span class="visually-hidden">Nueva observación</span><textarea id="n-texto" rows="3" maxlength="2000" placeholder="Escribí una observación…"></textarea></label><button class="ad-btn" type="button" id="n-agregar">Agregar observación</button></section>' +
        '<section class="ad-card"><h2 class="ad-h2">Historial</h2><ul class="ad-log">' + (s.log || []).slice().reverse().map(function (l) { return "<li><b>" + esc(P().fecha(l.at)) + "</b> " + esc(l.accion) + (l.por ? ' <span class="ad-muted">(' + esc(l.por) + ")</span>" : "") + "</li>"; }).join("") + "</ul></section>" +
        '<section class="ad-card ad-danger-zone"><h2 class="ad-h2">Eliminar</h2><button class="ad-btn ad-btn--danger" type="button" id="s-borrar">Eliminar solicitud</button><p class="ad-muted ad-small">Borra la solicitud, sus datos y sus archivos. Antes de eliminar, exportá lo que necesites conservar.</p></section>' +
        "</aside></div>";

      $("s-guardar").addEventListener("click", function () {
        P().api("POST", "/productores/" + s.id + "/estado", { estado: $("s-estado").value }).then(function (r) { if (r.ok) { P().toast("Estado guardado."); viewFicha(s.id); } else P().toast(r.error, true); }).catch(function () {});
      });
      $("n-agregar").addEventListener("click", function () {
        var t = $("n-texto").value.trim();
        if (!t) { $("n-texto").focus(); return; }
        P().api("POST", "/productores/" + s.id + "/nota", { texto: t }).then(function (r) { if (r.ok) { P().toast("Observación agregada."); viewFicha(s.id); } else P().toast(r.error, true); }).catch(function () {});
      });
      if ($("g-agregar")) $("g-agregar").addEventListener("click", function () {
        var v = $("g-nueva").value;
        if (!v) { $("g-nueva").focus(); return; }
        P().api("POST", "/productores/" + s.id + "/gestion", { id: v }).then(function (r) { if (r.ok) { P().toast("Aseguradora agregada."); viewFicha(s.id); } else P().toast(r.error, true); }).catch(function () {});
      });
      P().app.querySelectorAll("[data-gestion]").forEach(function (box) {
        var gid = box.getAttribute("data-gestion");
        var sel = box.querySelector('[data-k="estado"]');
        sel.addEventListener("change", function () {
          if (sel.value === "gestion" && !box.querySelector('[data-k="inicio"]').value) box.querySelector('[data-k="inicio"]').value = hoy();
        });
        box.querySelector("[data-g-save]").addEventListener("click", function () {
          var b = {};
          box.querySelectorAll("[data-k]").forEach(function (el) { b[el.getAttribute("data-k")] = el.value; });
          P().api("PUT", "/productores/" + s.id + "/gestion/" + encodeURIComponent(gid), b).then(function (r) {
            if (r.ok) { P().toast("Gestión guardada."); viewFicha(s.id); return; }
            mostrarErrores(box, r.errors); P().toast(r.error || "No se pudo guardar.", true);
          }).catch(function () {});
        });
        box.querySelector("[data-g-del]").addEventListener("click", function () {
          P().modal({ title: "¿Quitar esta aseguradora?", html: "Se quita la gestión con <b>" + esc(box.querySelector("h3").textContent) + "</b> de esta solicitud. Queda registrado en el historial.", ok: "Quitar", danger: true }).then(function (y) {
            if (!y) return;
            P().api("DELETE", "/productores/" + s.id + "/gestion/" + encodeURIComponent(gid)).then(function (r) { if (r.ok) { P().toast("Gestión quitada."); viewFicha(s.id); } else P().toast(r.error, true); }).catch(function () {});
          });
        });
      });
      $("s-borrar").addEventListener("click", function () {
        P().modal({ title: "¿Eliminar la solicitud?", html: "Se borran definitivamente los datos y los archivos de <b>" + esc(s.resumen.nombre) + "</b> (" + esc(s.ref) + "). No se puede deshacer.", ok: "Eliminar", danger: true, typeText: "ELIMINAR" }).then(function (y) {
          if (!y) return;
          P().api("DELETE", "/productores/" + s.id).then(function (r) { if (r.ok) { P().toast("Solicitud eliminada."); location.hash = "#/productores"; } else P().toast(r.error, true); }).catch(function () {});
        });
      });
    }).catch(function () {});
  }

  /* ---------- Editar datos ---------- */
  var PROVINCIAS = ["Buenos Aires", "Ciudad Autónoma de Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán"];

  function viewEditar(id) {
    var app = P().app;
    app.innerHTML = '<p class="ad-muted">Cargando…</p>';
    P().api("GET", "/productores/" + encodeURIComponent(id)).then(function (j) {
      if (!j.ok) { app.innerHTML = '<p class="ad-muted">' + esc(j.error) + "</p>"; return; }
      var s = j.solicitud, d = s.datos || {}, t = s.tipo;
      var inp = function (k, label, type, max, extra) { return '<label class="ad-f">' + label + '<input data-k="' + k + '" type="' + (type || "text") + '" maxlength="' + (max || 120) + '" value="' + esc(d[k] || "") + '"' + (extra || "") + '><span class="pr-err"></span></label>'; };
      var sel = function (k, label, ops) { return '<label class="ad-f">' + label + '<select data-k="' + k + '">' + ops.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(d[k] || "") === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + '</select><span class="pr-err"></span></label>'; };
      var area = function (k, label, max) { return '<label class="ad-f pr-span">' + label + '<textarea data-k="' + k + '" rows="3" maxlength="' + max + '">' + esc(d[k] || "") + '</textarea><span class="pr-err"></span></label>'; };
      var sn = [["si", "Sí"], ["no", "No"]];
      var campos = inp("nombre", "Nombre y apellido") + inp("telefono", "Teléfono / WhatsApp", "tel", 30) + inp("email", "Correo", "email") + inp("localidad", "Localidad", "text", 80) +
        sel("provincia", "Provincia", PROVINCIAS.map(function (p) { return [p, p]; }));
      if (t !== "info") {
        campos += inp("dni", "DNI", "text", 12) + inp("cuit", "CUIT (sin guiones)", "text", 15) + inp("matricula", "Matrícula SSN", "text", 10) +
          sel("trabaja_organizacion", "¿Trabaja con una organización?", sn) + inp("organizacion", "Organización", "text", 120);
      }
      if (t === "nuevo") campos += inp("fecha_matricula", "Fecha de matriculación", "date", 10, ' max="' + hoy() + '"') + sel("primera_experiencia", "¿Primera experiencia?", sn);
      if (t === "activo") campos += area("companias_actuales", "Aseguradoras con las que trabaja", 400) + sel("tiene_codigo", "¿Ya tiene código en las que pidió?", [["no", "No"], ["algunas", "En algunas"], ["si", "Sí"]]) + inp("codigo_detalle", "¿En cuáles?", "text", 300);
      if (t !== "info") campos += area("comentarios", "Comentarios", 1500);
      if (t === "info") campos += sel("perfil", "Situación", [["nuevo", "Se matriculó hace poco"], ["activo", "Ya trabaja como productor"], ["estudiante", "Está estudiando para matricularse"], ["otro", "Otro"]]) + area("consulta", "Consulta", 1500);

      app.innerHTML = '<div class="ad-head"><div><a class="ad-back" href="#/productores/' + esc(s.id) + '">← Volver a la ficha</a><h1 class="ad-h1">Editar datos</h1><p class="ad-muted">' + esc(s.resumen.nombre) + " · " + esc(s.ref) + "</p></div></div>" +
        '<section class="ad-card"><div class="pr-edit" id="e-box">' + campos + '</div><div class="pr-gestion-actions"><button class="btn btn-primary btn-sm" type="button" id="e-guardar">Guardar cambios</button><a class="ad-btn" href="#/productores/' + esc(s.id) + '">Cancelar</a></div></section>';
      $("e-guardar").addEventListener("click", function () {
        var b = {};
        $("e-box").querySelectorAll("[data-k]").forEach(function (el) { b[el.getAttribute("data-k")] = el.value; });
        P().api("PUT", "/productores/" + s.id + "/datos", b).then(function (r) {
          if (r.ok) { P().toast(r.cambios ? "Datos actualizados." : "No había cambios."); location.hash = "#/productores/" + s.id; return; }
          mostrarErrores($("e-box"), r.errors); P().toast(r.error || "No se pudo guardar.", true);
        }).catch(function () {});
      });
    }).catch(function () {});
  }

  /* ---------- Aseguradoras ---------- */
  function viewAseguradoras() {
    var app = P().app;
    app.innerHTML = '<p class="ad-muted">Cargando aseguradoras…</p>';
    P().api("GET", "/productores/aseguradoras").then(function (j) {
      var lista = (j.aseguradoras || []).map(function (a) { return { id: a.id, nombre: a.nombre, activa: a.activa !== false }; });
      function draw() {
        $("a-list").innerHTML = lista.map(function (a, i) {
          return '<div class="pr-aseg"><input type="text" aria-label="Nombre de la aseguradora" maxlength="60" data-i="' + i + '" value="' + esc(a.nombre) + '">' +
            '<label class="pr-switch"><input type="checkbox" data-act="' + i + '"' + (a.activa ? " checked" : "") + "><span>" + (a.activa ? "Activa" : "Inactiva") + "</span></label>" +
            (a.id ? "" : '<button class="ad-btn ad-btn--danger" type="button" data-rm="' + i + '">Quitar</button>') + "</div>";
        }).join("");
      }
      app.innerHTML = '<div class="ad-head"><div><a class="ad-back" href="#/productores">← Productores</a><h1 class="ad-h1">Aseguradoras</h1>' +
        '<p class="ad-muted">Son las compañías que los productores pueden elegir en los formularios de la web. Las inactivas no se muestran en la web, pero se conservan en las solicitudes que ya las tienen.</p></div></div>' +
        '<section class="ad-card"><div id="a-list" class="pr-aseg-list"></div>' +
        '<div class="pr-gestion-actions"><button class="ad-btn" type="button" id="a-add">+ Agregar aseguradora</button><button class="btn btn-primary btn-sm" type="button" id="a-save">Guardar lista</button></div>' +
        '<p class="ad-muted ad-small">Agregá solo compañías con las que efectivamente se pueda gestionar la apertura de códigos.</p></section>';
      draw();
      $("a-list").addEventListener("input", function (e) { var i = e.target.getAttribute("data-i"); if (i !== null) lista[+i].nombre = e.target.value; });
      $("a-list").addEventListener("change", function (e) {
        var i = e.target.getAttribute("data-act");
        if (i !== null) { lista[+i].activa = e.target.checked; e.target.nextElementSibling.textContent = e.target.checked ? "Activa" : "Inactiva"; }
      });
      $("a-list").addEventListener("click", function (e) { var i = e.target.getAttribute("data-rm"); if (i !== null) { lista.splice(+i, 1); draw(); } });
      $("a-add").addEventListener("click", function () { lista.push({ id: "", nombre: "", activa: true }); draw(); var ins = $("a-list").querySelectorAll('input[type="text"]'); ins[ins.length - 1].focus(); });
      $("a-save").addEventListener("click", function () {
        var limpia = lista.filter(function (a) { return a.id || a.nombre.trim(); });
        P().api("PUT", "/productores/aseguradoras", { aseguradoras: limpia }).then(function (r) {
          if (r.ok) { P().toast("Lista guardada."); viewAseguradoras(); } else P().toast(r.error || "No se pudo guardar.", true);
        }).catch(function () {});
      });
    }).catch(function () {});
  }

  window.JMAProductores = { route: route };
})();
