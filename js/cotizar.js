/* ==========================================================================
   JMA Seguros — Formulario «Pedí tu cotización» (pages/cotizar.html)
   - Un formulario por tipo de seguro: auto, hogar, accidentes personales,
     asistencia al viajero y otros seguros
   - Envío seguro a /api/cotizacion (correo con el detalle completo).
     «Recibimos tu solicitud» se muestra solo si el servidor la acepta
   - Botón «Enviar solicitud por WhatsApp» con un resumen SIN datos sensibles
     (DNI, CUIT, domicilios, fechas de nacimiento). Es un botón, no un enlace,
     para que Google Analytics no registre el texto del mensaje
   ========================================================================== */
(function () {
  "use strict";

  var form = document.getElementById("cotizar-form");
  if (!form) return;

  var ENDPOINT = form.getAttribute("action") || "/api/cotizacion";
  var WHATSAPP = "5493515161257";
  var MAX_VIAJEROS = 10;
  var TIPOS = {
    auto: "Seguro de auto",
    hogar: "Seguro de hogar",
    ap: "Accidentes personales",
    viajero: "Asistencia al viajero",
    otro: "Otro seguro"
  };
  var OTROS = { moto: "Seguro de moto", vida: "Seguro de vida", retiro: "Seguro de retiro", comercio: "Integral de comercio", otro: "Otro" };
  var COBERTURA = { tarjeta: "Tarjeta de crédito", cbu: "Débito por CBU" };

  var $ = function (id) { return document.getElementById(id); };
  var statusBox = $("cotizar-status");
  var submitBtn = $("cotizar-submit");
  var okPanel = $("cotizar-ok");
  var waAlt = $("cotizar-wa-alt");
  var vList = $("viajeros-list");
  var vTpl = $("viajero-template");
  var uid = 0;
  var sending = false;
  var lastRef = "";
  var lastSummary = "";

  /* ---------- Utilidades ---------- */
  function todayISO() {
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function dmy(iso) { return iso ? iso.split("-").reverse().join("/") : ""; }
  function digits(v) { return String(v || "").replace(/\D/g, ""); }
  function normPlate(v) { return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  function isHidden(el) { return !!el.closest("[hidden]"); }
  function val(name) {
    var el = form.elements[name];
    if (!el) return "";
    if (el.length && !el.tagName) {
      var r = form.querySelector("input[name='" + name + "']:checked");
      return r ? r.value : "";
    }
    if (el.type === "checkbox") return el.checked ? el.value : "";
    return String(el.value || "").trim();
  }
  function newKey() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "k" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  var idemKey = newKey();

  function fieldOf(el) { return el.closest(".field, .choice"); }
  function setError(el, msg) {
    var f = fieldOf(el);
    if (!f) return;
    f.classList.toggle("has-error", !!msg);
    var e = f.querySelector(".field-error");
    if (e) e.textContent = msg || "";
    if (el.setAttribute) el.setAttribute("aria-invalid", msg ? "true" : "false");
  }
  function showStatus(html) { statusBox.className = "form-status is-visible is-error"; statusBox.innerHTML = html; }
  function clearStatus() { statusBox.className = "form-status"; statusBox.innerHTML = ""; }

  /* ---------- Visibilidad ---------- */
  function sync() {
    var tipo = val("tipo");
    form.querySelectorAll("[data-when]").forEach(function (el) {
      el.hidden = !tipo || el.getAttribute("data-when").split(" ").indexOf(tipo) === -1;
    });
    form.querySelectorAll("[data-show]").forEach(function (el) {
      var p = el.getAttribute("data-show").split(":");
      var target = form.elements[p[0]];
      var current = target && target.type === "checkbox" ? (target.checked ? "si" : "off") : val(p[0]);
      el.hidden = current !== (p[1] || "si");
    });
    if (tipo === "viajero" && !vList.children.length) renderViajeros();
  }

  function setTipoInUrl(tipo) {
    try {
      var u = new URL(window.location.href);
      u.searchParams.set("seguro", tipo);
      u.hash = "";
      history.replaceState(null, "", u.pathname + u.search);
    } catch (e) { /* navegadores viejos */ }
  }

  /* ---------- Asistencia al viajero: un bloque por viajero ---------- */
  function vItems() { return Array.prototype.slice.call(vList.querySelectorAll("[data-viajero]")); }
  function buildViajero() {
    var node = vTpl.content.firstElementChild.cloneNode(true);
    var n = ++uid;
    node.querySelectorAll("[data-key]").forEach(function (el) {
      var key = el.getAttribute("data-key");
      if (el.type === "radio") { el.name = "v" + n + "_dato"; return; }
      el.id = "v" + n + "-" + key;
      var lab = node.querySelector("label[data-for='" + key + "']");
      if (lab) lab.htmlFor = el.id;
    });
    node.querySelector("input[type=date]").max = todayISO();
    node.addEventListener("change", function (e) {
      if (e.target.getAttribute("data-key") !== "dato") return;
      node.querySelectorAll("[data-dato]").forEach(function (f) { f.hidden = f.getAttribute("data-dato") !== e.target.value; });
      setError(e.target, "");
    });
    return node;
  }
  function renderViajeros() {
    var n = parseInt(form.elements.viaje_cantidad.value, 10);
    if (!(n >= 1)) n = 1;
    n = Math.min(n, MAX_VIAJEROS);
    var items = vItems();
    // Se conservan los viajeros que siguen en la solicitud; se agregan o quitan los del final
    for (var i = items.length; i < n; i++) vList.appendChild(buildViajero());
    for (var j = items.length - 1; j >= n; j--) items[j].remove();
    refreshViajeros();
  }
  function refreshViajeros() {
    var items = vItems();
    items.forEach(function (item, k) {
      item.querySelector(".tercero-title").textContent = "Viajero " + (k + 1);
      item.querySelector("[data-viajero-remove]").hidden = items.length < 2;
    });
    var cant = form.elements.viaje_cantidad;
    if (items.length) cant.value = items.length;
    document.querySelectorAll("[data-step]").forEach(function (b) {
      var step = Number(b.getAttribute("data-step"));
      b.disabled = step < 0 ? items.length <= 1 : items.length >= MAX_VIAJEROS;
    });
    $("viajero-add").hidden = items.length >= MAX_VIAJEROS;
  }
  function setCantidad(n) {
    form.elements.viaje_cantidad.value = Math.max(1, Math.min(MAX_VIAJEROS, n));
    setError(form.elements.viaje_cantidad, "");
    renderViajeros();
  }
  document.querySelectorAll("[data-step]").forEach(function (b) {
    b.addEventListener("click", function () { setCantidad(vItems().length + Number(b.getAttribute("data-step"))); });
  });
  $("viajero-add").addEventListener("click", function () {
    setCantidad(vItems().length + 1);
    var items = vItems(), last = items[items.length - 1];
    var first = last && last.querySelector("input[data-key='nombre']");
    if (first) { try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); } last.scrollIntoView({ behavior: "smooth", block: "center" }); }
  });
  vList.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-viajero-remove]");
    if (!btn) return;
    var item = btn.closest("[data-viajero]");
    if (vItems().length < 2) return;
    item.remove();
    refreshViajeros();
    $("viajero-add").focus();
  });
  form.elements.viaje_cantidad.addEventListener("input", function () {
    var v = parseInt(this.value, 10);
    if (v > MAX_VIAJEROS) this.value = MAX_VIAJEROS;
    if (v >= 1) renderViajeros();
  });
  form.elements.viaje_cantidad.addEventListener("change", function () {
    if (!(parseInt(this.value, 10) >= 1)) this.value = vItems().length || 1;
    renderViajeros();
  });
  $("v-salida").min = todayISO();
  $("v-regreso").min = todayISO();
  $("v-salida").addEventListener("change", function () { $("v-regreso").min = this.value || todayISO(); });

  /* ---------- Validación ---------- */
  function checkValue(el, v) {
    var type = el.getAttribute("data-type");
    var d = digits(v);
    if (type === "dni" && !/^\d{7,8}$/.test(d)) return "Ingresá un DNI válido (7 u 8 números).";
    if (type === "dnicuit" && !(/^\d{7,8}$/.test(d) || /^\d{11}$/.test(d))) return "Ingresá un DNI (7 u 8 números) o un CUIT (11 números).";
    if (type === "phone" && d.length < 8) return "Ingresá un teléfono válido, con código de área.";
    if (type === "plate" && !/^[A-Z0-9]{5,8}$/.test(normPlate(v))) return "Ingresá una patente válida (ej.: AB123CD o ABC123).";
    if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return "Revisá el correo electrónico.";
    if (type === "int" && !/^\d{1,6}$/.test(v.replace(/\./g, "")) ) return "Ingresá un número.";
    if (type === "int" && parseInt(v.replace(/\./g, ""), 10) < 1) return "Tiene que ser 1 o más.";
    return "";
  }
  function validate() {
    var first = null;
    function fail(el, msg) { setError(el, msg); if (msg && !first) first = el; }

    form.querySelectorAll("fieldset.choice[data-choice]").forEach(function (fs) {
      var any = fs.querySelector("input");
      if (isHidden(fs)) return setError(any, "");
      fail(any, val(fs.getAttribute("data-choice")) ? "" : "Elegí una opción.");
    });
    form.querySelectorAll("input[name], select[name], textarea[name]").forEach(function (el) {
      if (el.type === "radio" || el.type === "checkbox" || el.name === "sitio_web") return;
      if (isHidden(el)) return setError(el, "");
      var v = String(el.value || "").trim();
      if (!v) return fail(el, el.hasAttribute("data-req") ? (el.tagName === "SELECT" ? "Elegí una opción." : "Completá este campo.") : "");
      fail(el, checkValue(el, v));
    });
    if (val("tipo") === "viajero") {
      var s = $("v-salida"), r = $("v-regreso");
      if (s.value && s.value < todayISO()) fail(s, "La fecha de salida no puede ser anterior a hoy.");
      if (s.value && r.value && r.value < s.value) fail(r, "La fecha de regreso tiene que ser igual o posterior a la de salida.");
      vItems().forEach(function (item) {
        ["nombre", "dni", "domicilio"].forEach(function (k) {
          var el = item.querySelector("[data-key='" + k + "']");
          var v = el.value.trim();
          fail(el, v ? checkValue(el, v) : "Completá este campo.");
        });
        var dato = item.querySelector("[data-key='dato']:checked");
        var radio = item.querySelector("[data-key='dato']");
        fail(radio, dato ? "" : "Elegí una opción.");
        if (dato) {
          var nac = item.querySelector("[data-key='nacimiento']");
          var edad = item.querySelector("[data-key='edad']");
          if (dato.value === "nacimiento") {
            setError(edad, "");
            fail(nac, !nac.value ? "Completá este campo." : (nac.value > todayISO() || nac.value < "1900-01-01") ? "Revisá la fecha de nacimiento." : "");
          } else {
            setError(nac, "");
            var e = edad.value.trim();
            fail(edad, !e ? "Completá este campo." : (!/^\d{1,3}$/.test(e) || +e > 120) ? "Ingresá una edad válida." : "");
          }
        }
      });
    }
    return first;
  }

  /* ---------- Datos a enviar ---------- */
  function collect() {
    var data = { tipo: val("tipo"), idem: idemKey, sitio_web: val("sitio_web") };
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || isHidden(el) || el.name === "tipo" || el.name === "sitio_web" || /^v\d+_/.test(el.name)) return;
      if (el.type === "radio" && !el.checked) return;
      if (el.type === "checkbox") { if (el.checked) data[el.name] = el.value; return; }
      var v = String(el.value || "").trim();
      if (v) data[el.name] = el.getAttribute("data-type") === "plate" ? normPlate(v) : v;
    });
    if (data.tipo === "viajero") {
      data.viajeros = vItems().map(function (item) {
        var g = function (k) { var el = item.querySelector("[data-key='" + k + "']"); return el ? el.value.trim() : ""; };
        var dato = item.querySelector("[data-key='dato']:checked");
        var v = { nombre: g("nombre"), dni: g("dni"), domicilio: g("domicilio") };
        if (dato && dato.value === "nacimiento") v.nacimiento = g("nacimiento");
        if (dato && dato.value === "edad") v.edad = g("edad");
        return v;
      });
    }
    return data;
  }

  /* Resumen para WhatsApp: sin DNI, CUIT, domicilios ni fechas de nacimiento */
  function ageFrom(iso) {
    if (!iso) return "";
    var b = new Date(iso + "T12:00:00"), t = new Date();
    var a = t.getFullYear() - b.getFullYear();
    if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
    return a >= 0 ? String(a) : "";
  }
  function waSummary(d, ref) {
    var L = ["Nueva cotización · " + TIPOS[d.tipo]];
    if (ref) L.push("Solicitud " + ref);
    function sec(t, rows) {
      var lines = rows.filter(function (r) { return r[1] !== undefined && r[1] !== ""; });
      if (!lines.length) return;
      L.push("");
      L.push(t);
      lines.forEach(function (r) { L.push(r[0] + ": " + r[1]); });
    }
    var siNo = function (v) { return v === "si" ? "Sí" : v === "no" ? "No" : ""; };
    if (d.tipo === "auto") {
      sec("Datos personales", [["Nombre y apellido", d.auto_nombre], ["Localidad", d.auto_localidad]]);
      sec("Datos del vehículo", [["Marca", d.auto_marca], ["Modelo", d.auto_modelo], ["Patente", d.auto_patente], ["¿Tiene GNC?", siNo(d.auto_gnc)]]);
      var rows = [["Forma de pago preferida", COBERTURA[d.auto_pago]], ["¿Actualmente tiene seguro?", siNo(d.auto_tiene_seguro)]];
      if (d.auto_tiene_seguro === "si") rows.push(["Compañía actual", d.auto_cia_actual], ["Tipo de cobertura actual", d.auto_cobertura_actual], ["Cuota actual", d.auto_cuota_actual ? "$ " + d.auto_cuota_actual : ""]);
      rows.push(["¿Siniestro en los últimos 15 días?", siNo(d.auto_siniestro)]);
      sec("Pago y cobertura actual", rows);
    } else if (d.tipo === "hogar") {
      sec("Datos personales", [["Nombre y apellido", d.hogar_nombre], ["Localidad", d.hogar_localidad]]);
      sec("Datos de la propiedad", [["Tipo de propiedad", d.hogar_tipo === "casa" ? "Casa" : d.hogar_tipo === "departamento" ? "Departamento" : ""], ["Metros cuadrados", d.hogar_m2],
        ["Qué le interesa cubrir", d.hogar_basica === "si" ? "Quiere una cobertura básica para empezar" : d.hogar_cubrir]]);
    } else if (d.tipo === "ap") {
      sec("Datos del seguro", [["Nombre completo o razón social", d.ap_nombre], ["Actividad", d.ap_actividad], ["Cantidad de personas", d.ap_cantidad], ["Suma asegurada solicitada", d.ap_suma], ["Días de cobertura", d.ap_dias]]);
    } else if (d.tipo === "viajero") {
      sec("Datos del viaje", [["Destino", d.viaje_destino], ["Fecha de salida", dmy(d.viaje_salida)], ["Fecha de regreso", dmy(d.viaje_regreso)], ["Cantidad de viajeros", String((d.viajeros || []).length)]]);
      (d.viajeros || []).forEach(function (v, i) {
        var edad = v.edad || ageFrom(v.nacimiento);
        sec("Viajero " + (i + 1), [["Nombre y apellido", v.nombre], ["Edad", edad ? edad + " años" : ""]]);
      });
    } else if (d.tipo === "otro") {
      sec("Consulta", [["Seguro", OTROS[d.otro_tipo]], ["Nombre y apellido", d.otro_nombre], ["Detalle", d.otro_detalle]]);
    }
    sec("Contacto", [["Teléfono / WhatsApp", d.telefono], ["Correo", d.email]]);
    var hayReservados = d.tipo !== "otro";
    if (hayReservados) {
      L.push("");
      L.push(ref ? "DNI, domicilio y demás datos completos: en el correo de la solicitud " + ref + "."
                 : "DNI, domicilio y demás datos: se los paso por este chat si los necesitan.");
    }
    return L.join("\n");
  }

  var lastData = null;
  function waUrl() {
    var d = lastData || collect();
    return "https://wa.me/" + WHATSAPP + "?text=" + encodeURIComponent(lastSummary || waSummary(d, lastRef));
  }
  function trackWa(ubicacion) {
    var d = lastData || {};
    if (typeof window.gtag === "function") window.gtag("event", "click_whatsapp", { ubicacion: ubicacion, tipo_seguro: d.tipo });
  }
  function openWhatsApp() {
    var url = waUrl();
    trackWa("cotizar_resumen");
    var w = window.open(url, "_blank", "noopener");
    if (!w) window.location.href = url;
  }
  document.querySelectorAll("[data-wa-send]").forEach(function (b) { b.addEventListener("click", openWhatsApp); });

  /* Apertura automática de WhatsApp: la pestaña se abre en el mismo toque de
     «Enviar solicitud» (si se abriera después de la respuesta del servidor, los
     celulares la bloquean) y recién se dirige a WhatsApp cuando el correo salió.
     Si el envío falla, se cierra. */
  var waWin = null;
  function preOpenWa() {
    waWin = null;
    try {
      var w = window.open("", "_blank");
      if (!w) return;
      try { w.opener = null; } catch (e) {}
      try {
        w.document.title = "Abriendo WhatsApp…";
        w.document.body.style.cssText = "font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#334;";
        w.document.body.textContent = "Enviando tu solicitud… En unos segundos se abre WhatsApp.";
      } catch (e) {}
      waWin = w;
    } catch (e) { waWin = null; }
  }
  function finishWa(ok) {
    var w = waWin;
    waWin = null;
    if (!w) return false;
    try {
      if (ok) { w.location.href = waUrl(); trackWa("cotizar_auto"); return true; }
      w.close();
    } catch (e) {}
    return false;
  }

  /* ---------- Envío ---------- */
  function setSending(on) {
    sending = on;
    submitBtn.disabled = on;
    submitBtn.querySelector(".btn-text").textContent = on ? "Enviando solicitud…" : "Enviar solicitud";
    form.setAttribute("aria-busy", on ? "true" : "false");
  }
  function applyServerErrors(errors) {
    var first = null;
    Object.keys(errors || {}).forEach(function (name) {
      var el = form.elements[name];
      var m = /^viajero(\d+)_(\w+)$/.exec(name);
      if (m) {
        var item = vItems()[Number(m[1]) - 1];
        el = item && item.querySelector("[data-key='" + m[2] + "']");
      }
      if (el && el.length && !el.tagName) el = el[0];
      if (el) { setError(el, errors[name]); if (!first) first = el; }
    });
    return first;
  }
  function focusError(el) {
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    (el.closest(".field, .choice") || el).scrollIntoView({ behavior: "smooth", block: "center" });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (sending) return; // evita el doble envío
    clearStatus();
    waAlt.hidden = true;
    var bad = validate();
    if (bad) {
      showStatus("Revisá los campos marcados en rojo antes de enviar.");
      focusError(bad);
      return;
    }
    var data = collect();
    lastData = data;
    lastRef = "";
    lastSummary = "";
    setSending(true);
    preOpenWa();
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl && setTimeout(function () { ctrl.abort(); }, 30000);
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(data),
      signal: ctrl && ctrl.signal
    })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (b) { return { res: res, body: b }; }); })
      .then(function (r) {
        if (r.res.ok && r.body && r.body.ok) {
          lastRef = r.body.ref || "";
          lastSummary = r.body.resumen || "";
          if (lastRef) { $("cotizar-ref").querySelector("strong").textContent = lastRef; $("cotizar-ref").hidden = false; }
          $("ok-texto").textContent = "Tu solicitud de " + TIPOS[data.tipo].toLowerCase() + " nos llegó. Te vamos a responder al " + data.telefono + " de lunes a viernes, de 9 a 18.";
          var abierto = finishWa(true);
          $("wa-ok-titulo").textContent = abierto
            ? "Se abrió WhatsApp con tu solicitud lista. Tocá Enviar para enviárnosla."
            : "Último paso: enviala también por WhatsApp.";
          $("wa-ok-btn-text").textContent = abierto ? "¿No se abrió? Abrir WhatsApp" : "Enviar solicitud por WhatsApp";
          $("wa-ok-nota").hidden = abierto;
          form.hidden = true;
          okPanel.hidden = false;
          okPanel.focus();
          okPanel.scrollIntoView({ behavior: "smooth", block: "start" });
          if (typeof window.gtag === "function") window.gtag("event", "generate_lead", { formulario: "cotizacion", tipo_seguro: data.tipo });
          idemKey = newKey();
          return;
        }
        finishWa(false);
        var first = applyServerErrors(r.body && r.body.errors);
        if (first) {
          showStatus((r.body && r.body.message) || "Revisá los campos marcados en rojo.");
          focusError(first);
          return;
        }
        showStatus("No pudimos enviar la solicitud en este momento. Tus datos siguen cargados: podés volver a intentar o mandárnosla por WhatsApp.");
        waAlt.hidden = false;
        statusBox.focus();
      })
      .catch(function () {
        finishWa(false);
        showStatus("No pudimos enviar la solicitud por un problema de conexión. Tus datos siguen cargados: podés volver a intentar o mandárnosla por WhatsApp.");
        waAlt.hidden = false;
        statusBox.focus();
      })
      .then(function () {
        if (timer) clearTimeout(timer);
        setSending(false);
      });
  });

  form.addEventListener("input", function (e) {
    var f = fieldOf(e.target);
    if (f && f.classList.contains("has-error")) setError(e.target, "");
  });
  form.addEventListener("change", function (e) {
    if (e.target.name === "tipo") { setTipoInUrl(e.target.value); clearStatus(); waAlt.hidden = true; }
    if (e.target.type === "radio" || e.target.type === "checkbox") { sync(); setError(e.target, ""); }
  });

  $("cotizar-otra").addEventListener("click", function () {
    form.reset();
    vList.innerHTML = "";
    lastData = null;
    lastRef = "";
    lastSummary = "";
    $("cotizar-ref").hidden = true;
    $("wa-ok-nota").hidden = false;
    okPanel.hidden = true;
    form.hidden = false;
    sync();
    form.querySelector("input[name='tipo']").focus();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  /* ---------- Preselección desde el enlace (?seguro=auto, moto, hogar…) ---------- */
  (function () {
    var p = new URLSearchParams(window.location.search).get("seguro");
    var map = { auto: "auto", hogar: "hogar", ap: "ap", accidentes: "ap", viajero: "viajero", viaje: "viajero", otro: "otro", moto: "otro", vida: "otro", retiro: "otro", comercio: "otro" };
    var tipo = map[p];
    if (tipo) {
      var r = form.querySelector("input[name='tipo'][value='" + tipo + "']");
      if (r) r.checked = true;
      if (tipo === "otro" && OTROS[p]) form.elements.otro_tipo.value = p;
    }
  })();
  sync();
})();
