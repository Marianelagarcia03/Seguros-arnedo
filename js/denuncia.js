/* ==========================================================================
   JMA Seguros — Formulario «Denuncia de siniestro» (pages/denuncia.html)
   - Muestra los datos del conductor solo si el asegurado no conducía
   - Terceros dinámicos (Tercero 1, 2, 3…), con «No lo sé» por campo
   - Fotos del carnet: validación de formato y tamaño, vista previa y
     compresión en el navegador para que el envío sea liviano
   - Envío a /api/denuncia (Netlify Function) sin abrir el correo del cliente.
     Si falla, los datos quedan cargados para reintentar.
   ========================================================================== */
(function () {
  "use strict";

  var form = document.getElementById("denuncia-form");
  if (!form) return;

  var ENDPOINT = form.getAttribute("action") || "/api/denuncia";
  var MAX_TERCEROS = 10;
  var MAX_INPUT_BYTES = 10 * 1024 * 1024;   // lo que puede elegir la persona
  var MAX_SEND_BYTES = 1.9 * 1024 * 1024;    // por foto, después de comprimir
  var MAX_TOTAL_BYTES = 4 * 1024 * 1024;     // límite seguro del envío completo
  var MAX_SIDE = 1800;                        // px del lado mayor al comprimir
  var OK_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
  var OK_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;

  var statusBox = document.getElementById("denuncia-status");
  var submitBtn = document.getElementById("denuncia-submit");
  var okPanel = document.getElementById("denuncia-ok");
  var conductorBox = document.getElementById("conductor-otro");
  var tercerosBox = document.getElementById("terceros");
  var tercerosList = document.getElementById("terceros-list");
  var addBtn = document.getElementById("tercero-add");
  var tpl = document.getElementById("tercero-template");
  var uid = 0;

  /* ---------- Utilidades ---------- */
  function todayISO() {
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function digits(v) { return String(v || "").replace(/\D/g, ""); }
  function normPlate(v) { return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  function fieldOf(el) { return el.closest(".field, .choice"); }
  function setError(el, msg) {
    var f = fieldOf(el);
    if (!f) return;
    f.classList.toggle("has-error", !!msg);
    var e = f.querySelector(".field-error");
    if (e) e.textContent = msg || "";
    if (el.setAttribute) el.setAttribute("aria-invalid", msg ? "true" : "false");
  }
  function showStatus(type, html) {
    statusBox.className = "form-status is-visible " + (type === "ok" ? "is-success" : "is-error");
    statusBox.innerHTML = html;
  }
  function clearStatus() {
    statusBox.className = "form-status";
    statusBox.innerHTML = "";
  }
  function formatSize(b) { return (b / 1024 / 1024).toFixed(1).replace(".", ",") + " MB"; }

  document.getElementById("d-fecha").max = todayISO();
  document.getElementById("d-c-nacimiento").max = todayISO();

  /* ---------- Preguntas Sí / No ---------- */
  function radioValue(name) {
    var r = form.querySelector("input[name='" + name + "']:checked");
    return r ? r.value : "";
  }
  function syncConductor() {
    var show = radioValue("asegurado_conducia") === "no";
    conductorBox.hidden = !show;
  }
  function syncTerceros() {
    var show = radioValue("hubo_terceros") === "si";
    tercerosBox.hidden = !show;
    if (show && !tercerosList.children.length) addTercero(false);
  }
  form.addEventListener("change", function (e) {
    var t = e.target;
    if (t.name === "asegurado_conducia") { syncConductor(); setError(t, ""); }
    if (t.name === "hubo_terceros") { syncTerceros(); setError(t, ""); }
  });

  /* ---------- Terceros ---------- */
  function buildField(slot) {
    var id = "t" + (++uid) + "-" + slot.getAttribute("data-key");
    var label = slot.getAttribute("data-label");
    var isArea = slot.hasAttribute("data-textarea");
    var input = document.createElement(isArea ? "textarea" : "input");
    input.id = id;
    input.setAttribute("data-key", slot.getAttribute("data-key"));
    input.maxLength = Number(slot.getAttribute("data-max") || 200);
    if (isArea) input.rows = 3;
    else {
      input.type = slot.getAttribute("data-input") || "text";
      input.autocomplete = "off";
    }
    if (slot.getAttribute("data-inputmode")) input.inputMode = slot.getAttribute("data-inputmode");
    if (slot.getAttribute("data-type")) input.setAttribute("data-type", slot.getAttribute("data-type"));
    if (slot.getAttribute("data-type") === "plate") input.setAttribute("autocapitalize", "characters");

    var top = document.createElement("div");
    top.className = "field-top";
    var lab = document.createElement("label");
    lab.htmlFor = id;
    lab.innerHTML = label + ' <span class="req" aria-hidden="true">*</span>';
    var unk = document.createElement("label");
    unk.className = "unknown";
    unk.innerHTML = '<input type="checkbox" data-unknown> No lo sé';
    unk.querySelector("input").setAttribute("aria-label", label + ": no lo sé");
    top.appendChild(lab);
    top.appendChild(unk);

    var err = document.createElement("span");
    err.className = "field-error";
    err.setAttribute("aria-live", "polite");
    slot.appendChild(top);
    slot.appendChild(input);
    slot.appendChild(err);
  }

  function renumber() {
    var items = tercerosList.querySelectorAll("[data-tercero]");
    items.forEach(function (item, i) {
      item.querySelector(".tercero-title").textContent = "Tercero " + (i + 1);
      var rm = item.querySelector(".tercero-remove");
      rm.hidden = i === 0;
      rm.setAttribute("aria-label", "Quitar tercero " + (i + 1));
    });
    addBtn.hidden = items.length >= MAX_TERCEROS;
  }

  function addTercero(focus) {
    if (tercerosList.children.length >= MAX_TERCEROS) return;
    var node = tpl.content.firstElementChild.cloneNode(true);
    node.querySelectorAll(".field[data-key]").forEach(buildField);
    node.querySelector(".tercero-remove").addEventListener("click", function () {
      node.remove();
      renumber();
      addBtn.focus();
    });
    tercerosList.appendChild(node);
    renumber();
    if (focus) node.querySelector("input, textarea").focus();
  }
  addBtn.addEventListener("click", function () { addTercero(true); });

  tercerosList.addEventListener("change", function (e) {
    if (!e.target.hasAttribute("data-unknown")) return;
    var field = e.target.closest(".field");
    var input = field.querySelector("input[data-key], textarea[data-key]");
    input.disabled = e.target.checked;
    if (e.target.checked) { input.value = ""; setError(input, ""); }
  });

  /* ---------- Fotos ---------- */
  var processed = {}; // nombre del campo -> { blob, name } listo para enviar

  function extFor(type) {
    return { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" }[type] || "jpg";
  }

  function isHeic(file) {
    return /hei[cf]/i.test(file.type || "") || /\.(heic|heif)$/i.test(file.name || "");
  }
  function isHeicSignature(file) {
    return file.slice(0, 12).arrayBuffer().then(function (buf) {
      var s = String.fromCharCode.apply(null, new Uint8Array(buf));
      return s.slice(4, 8) === "ftyp" && /^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(s.slice(8, 12));
    }).catch(function () { return false; });
  }

  function decode(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: "from-image" }).catch(function () {
        return createImageBitmap(file);
      });
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
      var w = img.width, h = img.height;
      var scale = Math.min(1, MAX_SIDE / Math.max(w, h));
      var canvas = document.createElement("canvas");
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      if (img.close) img.close();
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) { resolve(blob); }, "image/jpeg", 0.82);
      });
    });
  }

  function handleFile(input) {
    var key = input.name;
    var field = input.closest(".file-field");
    var empty = field.querySelector(".file-empty");
    var preview = field.querySelector(".file-preview");
    var file = input.files && input.files[0];
    delete processed[key];
    preview.hidden = true;
    empty.hidden = false;
    setError(input, "");
    if (!file) return Promise.resolve();

    var typeOk = OK_TYPES.indexOf((file.type || "").toLowerCase()) > -1 || (!file.type && OK_EXT.test(file.name)) || OK_EXT.test(file.name);
    if (!typeOk) {
      input.value = "";
      setError(input, "Formato no admitido. Usá una foto JPG, PNG, WEBP o HEIC.");
      return Promise.resolve();
    }
    if (file.size > MAX_INPUT_BYTES) {
      input.value = "";
      setError(input, "La foto pesa " + formatSize(file.size) + ". El máximo es 10 MB.");
      return Promise.resolve();
    }

    field.classList.add("is-loading");
    return compress(file)
      .then(function (blob) {
        if (!blob) throw new Error("blob");
        // Si la compresión no ayuda (foto ya liviana), se envía la original.
        var useOriginal = blob.size >= file.size && /jpe?g|png|webp/.test(file.type) && file.size <= MAX_SEND_BYTES;
        return useOriginal ? { blob: file, name: key + "." + extFor(file.type) } : { blob: blob, name: key + ".jpg" };
      })
      .catch(function () {
        // El navegador no pudo leerla. Solo se acepta tal cual si es una foto HEIC
        // real (iPhone en navegadores que no la muestran) y el tamaño lo permite.
        if (!isHeic(file) || file.size > MAX_SEND_BYTES) throw new Error("decode");
        return isHeicSignature(file).then(function (yes) {
          if (!yes) throw new Error("decode");
          return { blob: file, name: key + ".heic", raw: true };
        });
      })
      .then(function (res) {
        if (res.blob.size > MAX_SEND_BYTES) throw new Error("heavy");
        processed[key] = res;
        preview.querySelector(".file-name").textContent = file.name + " · " + formatSize(res.blob.size);
        var img = preview.querySelector("img");
        if (res.raw) { img.hidden = true; } else {
          img.hidden = false;
          if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
          img.dataset.url = URL.createObjectURL(res.blob);
          img.src = img.dataset.url;
        }
        preview.hidden = false;
        empty.hidden = true;
      })
      .catch(function () {
        input.value = "";
        setError(input, "No pudimos procesar esta foto. Probá sacarla de nuevo o elegí una en formato JPG.");
      })
      .then(function () { field.classList.remove("is-loading"); });
  }

  var pending = {};
  form.querySelectorAll("input[type='file']").forEach(function (input) {
    input.addEventListener("change", function () { pending[input.name] = handleFile(input); });
  });

  /* ---------- Validación ---------- */
  function checkValue(el, value) {
    var type = el.getAttribute("data-type");
    if (!value) return "Completá este campo.";
    if (type === "dni" && !/^\d{7,8}$/.test(digits(value))) return "Ingresá un DNI válido (7 u 8 números).";
    if (type === "phone" && digits(value).length < 8) return "Ingresá un teléfono válido, con código de área.";
    if (type === "plate" && !/^[A-Z0-9]{5,8}$/.test(normPlate(value))) return "Ingresá una patente válida (ej.: AB123CD o ABC123).";
    if (type === "birthdate" && (value > todayISO() || value < "1900-01-01")) return "Revisá la fecha de nacimiento.";
    return "";
  }

  function validate() {
    var first = null;
    function fail(el, msg) { setError(el, msg); if (msg && !first) first = el; }

    ["fecha", "hora", "direccion", "relato", "patente", "danios"].forEach(function (n) {
      var el = form.elements[n];
      fail(el, checkValue(el, el.value.trim()));
    });
    var fecha = form.elements.fecha;
    if (fecha.value && fecha.value > todayISO()) fail(fecha, "La fecha no puede ser posterior a hoy.");

    ["asegurado_conducia", "hubo_terceros"].forEach(function (n) {
      var any = form.querySelector("input[name='" + n + "']");
      fail(any, radioValue(n) ? "" : "Elegí una opción.");
    });

    if (radioValue("asegurado_conducia") === "no") {
      conductorBox.querySelectorAll("[data-req-when='conductor']").forEach(function (el) {
        fail(el, checkValue(el, el.value.trim()));
      });
    }

    if (radioValue("hubo_terceros") === "si") {
      tercerosList.querySelectorAll("[data-tercero] input[data-key], [data-tercero] textarea[data-key]").forEach(function (el) {
        if (el.disabled) return setError(el, "");
        var v = el.value.trim();
        fail(el, v ? checkValue(el, v) : "Completá este dato o marcá «No lo sé».");
      });
    }

    ["carnet_frente", "carnet_dorso"].forEach(function (n) {
      var el = form.elements[n];
      var f = el.closest(".file-field");
      var current = f.querySelector(".field-error").textContent;
      if (!processed[n]) fail(el, current || ("Subí la foto del " + (n === "carnet_frente" ? "frente" : "dorso") + " del carnet."));
    });
    var total = (processed.carnet_frente ? processed.carnet_frente.blob.size : 0) + (processed.carnet_dorso ? processed.carnet_dorso.blob.size : 0);
    if (total > MAX_TOTAL_BYTES) fail(form.elements.carnet_dorso, "Las fotos son muy pesadas. Probá sacarlas de nuevo con menos resolución.");

    var consent = form.elements.consentimiento;
    fail(consent, consent.checked ? "" : "Necesitamos tu autorización para gestionar la denuncia.");
    return first;
  }

  // Limpia el error de un campo apenas la persona lo corrige
  form.addEventListener("input", function (e) {
    var f = fieldOf(e.target);
    if (f && f.classList.contains("has-error")) setError(e.target, "");
  });

  /* ---------- Envío ---------- */
  function buildData() {
    var fd = new FormData();
    function add(name, value) { fd.append(name, value == null ? "" : String(value).trim()); }
    add("sitio_web", form.elements.sitio_web.value);
    add("fecha", form.elements.fecha.value);
    add("hora", form.elements.hora.value);
    add("direccion", form.elements.direccion.value);
    add("relato", form.elements.relato.value);
    add("asegurado_conducia", radioValue("asegurado_conducia"));
    if (radioValue("asegurado_conducia") === "no") {
      ["conductor_nombre", "conductor_dni", "conductor_nacimiento", "conductor_telefono", "conductor_domicilio"].forEach(function (n) {
        add(n, form.elements[n].value);
      });
    }
    add("patente", normPlate(form.elements.patente.value));
    add("danios", form.elements.danios.value);
    add("hubo_terceros", radioValue("hubo_terceros"));
    if (radioValue("hubo_terceros") === "si") {
      var items = tercerosList.querySelectorAll("[data-tercero]");
      add("terceros_cantidad", items.length);
      items.forEach(function (item, i) {
        item.querySelectorAll("input[data-key], textarea[data-key]").forEach(function (el) {
          var key = "t" + (i + 1) + "_" + el.getAttribute("data-key");
          if (el.disabled) add(key + "_nolose", "1");
          else add(key, el.getAttribute("data-type") === "plate" ? normPlate(el.value) : el.value);
        });
      });
    }
    add("consentimiento", form.elements.consentimiento.checked ? "si" : "");
    fd.append("carnet_frente", processed.carnet_frente.blob, processed.carnet_frente.name);
    fd.append("carnet_dorso", processed.carnet_dorso.blob, processed.carnet_dorso.name);
    return fd;
  }

  function setSending(on) {
    submitBtn.disabled = on;
    submitBtn.querySelector(".btn-text").textContent = on ? "Enviando denuncia…" : "Enviar denuncia";
    form.setAttribute("aria-busy", on ? "true" : "false");
  }

  function applyServerErrors(errors) {
    var first = null;
    Object.keys(errors || {}).forEach(function (name) {
      var el = form.elements[name];
      var m = /^t(\d+)_(\w+)$/.exec(name);
      if (m) {
        var item = tercerosList.querySelectorAll("[data-tercero]")[Number(m[1]) - 1];
        el = item && item.querySelector("input[data-key='" + m[2] + "'], textarea[data-key='" + m[2] + "']");
      }
      if (el && el.length && !el.tagName) el = el[0];
      if (el) { setError(el, errors[name]); if (!first) first = el; }
    });
    return first;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    clearStatus();
    var waits = Object.keys(pending).map(function (k) { return pending[k]; });
    Promise.all(waits).then(function () {
      var bad = validate();
      if (bad) {
        showStatus("error", "Revisá los campos marcados en rojo antes de enviar.");
        bad.focus({ preventScroll: true });
        (bad.closest(".field, .choice") || bad).scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      setSending(true);
      var controller = window.AbortController ? new AbortController() : null;
      var timer = controller && setTimeout(function () { controller.abort(); }, 45000);
      fetch(ENDPOINT, { method: "POST", body: buildData(), headers: { Accept: "application/json" }, signal: controller && controller.signal })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) { return { res: res, data: data }; });
        })
        .then(function (r) {
          if (r.res.ok && r.data && r.data.ok) {
            form.hidden = true;
            okPanel.hidden = false;
            okPanel.focus();
            okPanel.scrollIntoView({ behavior: "smooth", block: "start" });
            if (typeof window.gtag === "function") window.gtag("event", "generate_lead", { formulario: "denuncia_siniestro" });
            return;
          }
          var first = applyServerErrors(r.data && r.data.errors);
          showStatus("error", (r.data && r.data.message ? r.data.message : "No pudimos enviar la denuncia.") +
            " Tus datos siguen cargados: revisalos y volvé a intentar. Si el problema sigue, escribinos por <a href=\"https://wa.me/5493515161257\" target=\"_blank\" rel=\"noopener\">WhatsApp</a>.");
          (first || statusBox).focus();
        })
        .catch(function () {
          showStatus("error", "No pudimos enviar la denuncia por un problema de conexión. Tus datos siguen cargados: revisá tu conexión y volvé a intentar. Si el problema sigue, escribinos por <a href=\"https://wa.me/5493515161257\" target=\"_blank\" rel=\"noopener\">WhatsApp</a>.");
          statusBox.focus();
        })
        .then(function () {
          if (timer) clearTimeout(timer);
          setSending(false);
        });
    });
  });

  // Estado inicial (por si el navegador recuerda selecciones al volver atrás)
  syncConductor();
  syncTerceros();
})();
