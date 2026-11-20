/* --------------------------------------------------------------------------
   SegurosArnedo.com — Organización de Productores
   (pages/organizacion-de-productores.html)
   - Tres opciones: productor nuevo, productor activo y pedido de información.
     Cada una muestra solo los campos que le corresponden.
   - La lista de aseguradoras viene del servidor (/api/productores), así se
     puede actualizar desde el panel sin tocar la página.
   - Adjuntos opcionales (hasta 3, PDF o fotos). Las fotos grandes se achican
     en el navegador antes de enviarlas.
   - «Recibimos tu solicitud» se muestra solo si el servidor la acepta.
   -------------------------------------------------------------------------- */
(function () {
  "use strict";

  var form = document.getElementById("org-form");
  if (!form) return;

  var ENDPOINT = form.getAttribute("action") || "/api/productores";
  var MAX_FILES = 3;
  var MAX_INPUT_BYTES = 15 * 1024 * 1024;
  var MAX_FILE_BYTES = 4 * 1024 * 1024;
  var MAX_TOTAL_BYTES = 4.2 * 1024 * 1024;
  var IMG = { side: 1800, quality: 0.82, threshold: 1.2 * 1024 * 1024 };
  var ASEGURADORAS = [
    { id: "zurich", nombre: "Zurich" }, { id: "lasegunda", nombre: "La Segunda" },
    { id: "federacion", nombre: "Federación Patronal" }, { id: "sancristobal", nombre: "San Cristóbal" },
    { id: "sancor", nombre: "Sancor Seguros" }, { id: "galicia", nombre: "Galicia Seguros" },
    { id: "mercantil", nombre: "La Mercantil Andina" }
  ];
  var LEADS = {
    nuevo: "Completá tus datos y te contactamos para acompañarte en la apertura de tus primeros códigos.",
    activo: "Contanos con qué compañías trabajás hoy y cuáles querés sumar.",
    info: "Dejanos tus datos y te contamos cómo funciona la organización."
  };

  var $ = function (id) { return document.getElementById(id); };
  var statusBox = $("org-status");
  var submitBtn = $("org-submit");
  var okPanel = $("org-ok");
  var fileInput = $("o-archivos");
  var fileList = $("org-file-list");
  var fileField = $("org-files-field");
  var lead = $("org-form-lead");
  var files = [];
  var sending = false;
  var abierto = Date.now();
  var idem = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(36).slice(2, 10);

  /* ---------- Utilidades ---------- */
  function digits(v) { return String(v || "").replace(/\D/g, ""); }
  function todayISO() {
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function isHidden(el) { return !!el.closest("[hidden]"); }
  function formatSize(b) { return b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + " KB" : (b / 1024 / 1024).toFixed(1).replace(".", ",") + " MB"; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function radioValue(name) {
    var el = form.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : "";
  }
  function tipo() { return radioValue("tipo"); }

  function cuitValido(v) {
    var d = digits(v);
    if (!/^(20|23|24|25|26|27|30|33|34)\d{9}$/.test(d)) return false;
    var p = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2], s = 0;
    for (var i = 0; i < 10; i++) s += p[i] * Number(d[i]);
    var dv = 11 - (s % 11);
    if (dv === 11) dv = 0;
    if (dv === 10) dv = 9;
    return dv === Number(d[10]);
  }

  /* ---------- Errores ---------- */
  function holderOf(name) {
    if (name === "archivos") return fileField;
    var choice = form.querySelector('[data-choice="' + name + '"]');
    if (choice) return choice;
    var f = form.querySelector('[data-field="' + name + '"]');
    if (f) return f;
    var el = form.elements[name];
    return el && el.closest ? el.closest(".field") : null;
  }
  function setError(name, msg) {
    var h = holderOf(name);
    if (!h) return;
    h.classList.toggle("has-error", !!msg);
    var box = h.querySelector(".field-error");
    if (box) box.textContent = msg || "";
    var input = h.querySelector("input, select, textarea");
    if (input && input.type !== "radio") input.setAttribute("aria-invalid", msg ? "true" : "false");
  }
  function clearErrors() {
    form.querySelectorAll(".has-error").forEach(function (el) {
      el.classList.remove("has-error");
      var box = el.querySelector(".field-error");
      if (box) box.textContent = "";
    });
  }
  function showStatus(html, ok) {
    statusBox.className = "form-status is-visible " + (ok ? "is-success" : "is-error");
    statusBox.innerHTML = html;
  }
  function clearStatus() { statusBox.className = "form-status"; statusBox.innerHTML = ""; }

  /* ---------- Mostrar lo que corresponde a cada opción ---------- */
  function sync() {
    var t = tipo();
    form.querySelectorAll("[data-when]").forEach(function (el) {
      el.hidden = el.getAttribute("data-when").split(" ").indexOf(t) === -1;
    });
    form.querySelectorAll("[data-show]").forEach(function (el) {
      var parts = el.getAttribute("data-show").split(":");
      el.hidden = parts[1].split(",").indexOf(radioValue(parts[0])) === -1;
    });
    document.querySelectorAll("#org-submit [data-when]").forEach(function (el) {
      el.hidden = el.getAttribute("data-when") !== t;
    });
    if (lead) lead.textContent = LEADS[t] || "Elegí una opción para ver el formulario que corresponde.";
  }

  function elegir(t, scroll) {
    var input = form.querySelector('input[name="tipo"][value="' + t + '"]');
    if (!input) return;
    input.checked = true;
    setError("tipo", "");
    sync();
    if (scroll) {
      var target = $("solicitud");
      var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      var first = form.querySelector('[data-when~="' + t + '"] input:not([type="hidden"])');
      if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, reduce ? 0 : 450);
    }
  }

  document.querySelectorAll("[data-org-tipo]").forEach(function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      var t = a.getAttribute("data-org-tipo");
      if (history.replaceState) history.replaceState(null, "", "#" + t);
      okPanel.hidden = true;
      form.hidden = false;
      elegir(t, true);
    });
  });

  form.addEventListener("change", function (e) {
    if (e.target.name === "tipo" && history.replaceState) history.replaceState(null, "", "#" + e.target.value);
    if (e.target.type === "radio" || e.target.type === "checkbox") {
      var name = e.target.name === "companias" ? "companias" : e.target.name;
      setError(name, "");
    }
    sync();
  });
  form.addEventListener("input", function (e) {
    if (e.target.name && e.target.type !== "file") setError(e.target.name, "");
  });

  /* ---------- Aseguradoras ---------- */
  function renderCompanias(lista) {
    var box = $("org-companias");
    var marcadas = {};
    box.querySelectorAll("input:checked").forEach(function (i) { marcadas[i.value] = true; });
    box.innerHTML = lista.map(function (a) {
      return '<label class="choice-option choice-option--card"><input type="checkbox" name="companias" value="' + esc(a.id) + '"' + (marcadas[a.id] ? " checked" : "") + "><span>" + esc(a.nombre) + "</span></label>";
    }).join("");
  }
  renderCompanias(ASEGURADORAS);

  fetch(ENDPOINT, { headers: { accept: "application/json" } })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (j && Array.isArray(j.aseguradoras) && j.aseguradoras.length) renderCompanias(j.aseguradoras);
      if (j && j.configurado === false) {
        $("org-off").hidden = false;
        submitBtn.disabled = true;
      }
    })
    .catch(function () { /* se usa la lista de la página */ });

  /* ---------- Adjuntos ---------- */
  function decode(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: "from-image" }).catch(function () { return createImageBitmap(file); });
    }
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("decode")); };
      img.src = url;
    });
  }
  function compress(file) {
    return decode(file).then(function (img) {
      var w = img.width, h = img.height, k = Math.min(1, IMG.side / Math.max(w, h));
      var c = document.createElement("canvas");
      c.width = Math.round(w * k);
      c.height = Math.round(h * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return new Promise(function (resolve) { c.toBlob(resolve, "image/jpeg", IMG.quality); });
    }).then(function (blob) {
      if (!blob) throw new Error("compress");
      return new File([blob], file.name.replace(/\.[^.]*$/, "") + ".jpg", { type: "image/jpeg" });
    });
  }
  function prepare(file) {
    var isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    var isImg = /^image\/(jpeg|png|webp)$/.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
    if (!isPdf && !isImg) return Promise.reject(new Error("«" + file.name + "» no es un PDF ni una foto JPG, PNG o WEBP."));
    if (file.size > MAX_INPUT_BYTES) return Promise.reject(new Error("«" + file.name + "» pesa " + formatSize(file.size) + ". El máximo es 4 MB."));
    if (isPdf) {
      return file.size > MAX_FILE_BYTES ? Promise.reject(new Error("«" + file.name + "» pesa " + formatSize(file.size) + ". El máximo es 4 MB por archivo.")) : Promise.resolve(file);
    }
    if (file.size <= IMG.threshold) return Promise.resolve(file);
    return compress(file).catch(function () {
      if (file.size <= MAX_FILE_BYTES) return file;
      throw new Error("No pudimos procesar «" + file.name + "». Probá con otra foto o un PDF.");
    });
  }
  function totalBytes() { return files.reduce(function (s, f) { return s + f.size; }, 0); }
  function renderFiles() {
    fileList.innerHTML = files.map(function (f, i) {
      return "<li><span>" + esc(f.name) + " <small>(" + formatSize(f.size) + ")</small></span>" +
        '<button class="org-file-remove" type="button" data-i="' + i + '" aria-label="Quitar ' + esc(f.name) + '">Quitar</button></li>';
    }).join("");
  }
  fileList.addEventListener("click", function (e) {
    var b = e.target.closest(".org-file-remove");
    if (!b) return;
    files.splice(Number(b.getAttribute("data-i")), 1);
    setError("archivos", "");
    renderFiles();
  });
  fileInput.addEventListener("change", function () {
    var elegidos = Array.prototype.slice.call(fileInput.files || []);
    fileInput.value = "";
    if (!elegidos.length) return;
    setError("archivos", "");
    if (files.length + elegidos.length > MAX_FILES) {
      setError("archivos", "Podés adjuntar hasta " + MAX_FILES + " archivos.");
      elegidos = elegidos.slice(0, Math.max(0, MAX_FILES - files.length));
    }
    Promise.all(elegidos.map(function (f) {
      return prepare(f).then(function (ok) { return { ok: ok }; }, function (err) { return { err: err.message }; });
    })).then(function (res) {
      var errores = [];
      res.forEach(function (r) {
        if (r.err) { errores.push(r.err); return; }
        if (totalBytes() + r.ok.size > MAX_TOTAL_BYTES) { errores.push("Entre todos los archivos superan el máximo permitido. Quitá alguno o mandalo después por WhatsApp."); return; }
        files.push(r.ok);
      });
      if (errores.length) setError("archivos", errores[0]);
      renderFiles();
    });
  });

  /* ---------- Validación ---------- */
  function valueOf(name) {
    var el = form.elements[name];
    return el && typeof el.value === "string" ? el.value.trim() : "";
  }
  function validate() {
    var t = tipo();
    var errs = {};
    if (!t) { errs.tipo = "Elegí una opción."; return errs; }
    form.querySelectorAll("input[required], select[required], textarea[required]").forEach(function (el) {
      if (isHidden(el) || el.type === "checkbox" || el.type === "radio") return;
      var v = el.value.trim();
      var type = el.getAttribute("data-type");
      var msg = "";
      if (!v) msg = "Completá este campo.";
      else if (type === "dni" && !/^\d{7,8}$/.test(digits(v))) msg = "Ingresá un DNI válido (7 u 8 números).";
      else if (type === "cuit" && !cuitValido(v)) msg = "Revisá el CUIT (11 números).";
      else if (type === "phone" && (digits(v).length < 8 || digits(v).length > 15)) msg = "Ingresá un teléfono válido, con código de área.";
      else if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) msg = "Revisá el correo electrónico.";
      else if (type === "matricula" && !/^\d{1,7}$/.test(digits(v))) msg = "Ingresá el número de matrícula (solo números).";
      else if (el.type === "date" && (v > todayISO() || v < "1950-01-01")) msg = "Revisá la fecha de matriculación.";
      if (msg) errs[el.name] = msg;
    });
    if (!errs.dni && !errs.cuit && (t === "nuevo" || t === "activo")) {
      var dni = digits(valueOf("dni")); var cuit = digits(valueOf("cuit"));
      if (cuit.slice(2, 10) !== ("00000000" + dni).slice(-8)) errs.cuit = "El CUIT no coincide con el DNI. Revisá los dos.";
    }
    form.querySelectorAll("[data-choice]").forEach(function (fs) {
      if (isHidden(fs)) return;
      var name = fs.getAttribute("data-choice");
      if (name === "companias") {
        if (!form.querySelector('input[name="companias"]:checked')) errs.companias = "Elegí al menos una compañía.";
      } else if (!radioValue(name)) {
        errs[name] = "Elegí una opción.";
      }
    });
    if (!form.elements.consentimiento.checked) errs.consentimiento = "Necesitamos tu conformidad para usar estos datos en la gestión.";
    return errs;
  }

  function collect() {
    var t = tipo();
    var d = { tipo: t, idem: idem + "-" + t, abierto: abierto, sitio_web: valueOf("sitio_web"), consentimiento: form.elements.consentimiento.checked ? "si" : "" };
    form.querySelectorAll("input, select, textarea").forEach(function (el) {
      if (!el.name || el.name === "tipo" || el.name === "sitio_web" || el.name === "consentimiento" || el.type === "file" || isHidden(el)) return;
      if (el.type === "checkbox") {
        if (el.name === "companias") { d.companias = d.companias || []; if (el.checked) d.companias.push(el.value); }
        return;
      }
      if (el.type === "radio") { if (el.checked) d[el.name] = el.value; return; }
      d[el.name] = el.value.trim();
    });
    return d;
  }

  function focusFirstError() {
    var first = form.querySelector(".has-error");
    if (!first) return;
    first.scrollIntoView({ behavior: "smooth", block: "center" });
    var input = first.querySelector("input:not([type=hidden]), select, textarea");
    if (input) setTimeout(function () { input.focus({ preventScroll: true }); }, 350);
  }

  /* ---------- Envío ---------- */
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (sending) return;
    clearErrors();
    clearStatus();
    var errs = validate();
    var keys = Object.keys(errs);
    if (keys.length) {
      keys.forEach(function (k) { setError(k, errs[k]); });
      showStatus("Revisá los campos marcados en rojo.");
      focusFirstError();
      return;
    }
    var t = tipo();
    var fd = new FormData();
    fd.append("datos", JSON.stringify(collect()));
    if (t !== "info") files.forEach(function (f) { fd.append("archivos", f, f.name); });

    sending = true;
    submitBtn.disabled = true;
    submitBtn.setAttribute("aria-busy", "true");
    showStatus("Enviando tu solicitud…", true);

    fetch(ENDPOINT, { method: "POST", body: fd, headers: { accept: "application/json" } })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (res) {
        if (res.status === 200 && res.j.ok) return success(res.j);
        if (res.status === 422 && res.j.errors) {
          Object.keys(res.j.errors).forEach(function (k) { setError(k, res.j.errors[k]); });
          showStatus(esc(res.j.message || "Revisá los campos marcados en rojo."));
          focusFirstError();
          return;
        }
        showStatus(esc(res.j.message || "No pudimos enviar la solicitud en este momento.") + ' Si preferís, escribinos por <a href="https://wa.me/5493515161257" target="_blank" rel="noopener">WhatsApp</a>.');
      })
      .catch(function () {
        showStatus('No pudimos conectarnos. Revisá tu conexión y probá de nuevo, o escribinos por <a href="https://wa.me/5493515161257" target="_blank" rel="noopener">WhatsApp</a>.');
      })
      .then(function () {
        sending = false;
        submitBtn.disabled = false;
        submitBtn.removeAttribute("aria-busy");
      });
  });

  function success(j) {
    var t = tipo();
    var partes = String(j.mensaje || "").replace(/([.!])\s+/g, "$1\n").split("\n");
    var titulo = partes.shift() || "¡Gracias!";
    $("org-ok-title").textContent = titulo;
    $("org-ok-text").innerHTML = partes.map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("");
    var refBox = $("org-ref");
    if (j.ref) {
      refBox.hidden = false;
      refBox.querySelector("strong").textContent = j.ref;
      var msg = "Hola Juan Manuel, te escribo por la Organización de Productores. Mi número de solicitud es " + j.ref + ".";
      $("org-wa").href = "https://wa.me/5493515161257?text=" + encodeURIComponent(msg);
    } else {
      refBox.hidden = true;
    }
    if (window.gtag) window.gtag("event", "generate_lead", { form: "productores", tipo: t });
    form.reset();
    files = [];
    renderFiles();
    clearStatus();
    form.hidden = true;
    okPanel.hidden = false;
    $("solicitud").scrollIntoView({ block: "start" });
    okPanel.focus({ preventScroll: true });
    idem = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
    abierto = Date.now();
  }

  /* ---------- Inicio ---------- */
  var inicial = (location.hash || "").slice(1);
  if (inicial === "nuevo" || inicial === "activo" || inicial === "info") elegir(inicial, false);
  sync();
})();
