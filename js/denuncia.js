/* ==========================================================================
   SegurosArnedo.com — Formulario «Denuncia de siniestro» (pages/denuncia.html)
   - Secciones según el tipo de siniestro y preguntas Sí / No
   - Terceros dinámicos (Tercero 1, 2, 3…) con «No lo sé» y fotos de sus papeles
   - Fotos: carnet (frente y dorso), daños y papeles del tercero. Se validan,
     se muestran en miniatura y se comprimen en el navegador antes de enviar
   - Borrador automático en el dispositivo (sin fotos)
   - Plazo legal de 3 días calculado desde la fecha del hecho
   - Envío a /api/denuncia (Netlify Function). Si falla, los datos quedan cargados
   ========================================================================== */
(function () {
  "use strict";

  var form = document.getElementById("denuncia-form");
  if (!form) return;

  var ENDPOINT = form.getAttribute("action") || "/api/denuncia";
  var DRAFT_KEY = "jma-denuncia-borrador-v2";
  var DRAFT_DAYS = 3;
  var MAX_TERCEROS = 10;
  var MAX_INPUT_BYTES = 10 * 1024 * 1024;   // lo que puede elegir la persona
  var CARNET = { side: 1800, quality: 0.82, max: 1.9 * 1024 * 1024 };
  var EXTRA = { side: 1400, quality: 0.72, max: 1.2 * 1024 * 1024 };
  var MAX_TOTAL_BYTES = 4.2 * 1024 * 1024;   // margen bajo el límite de Netlify
  var OK_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
  var OK_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;

  var $ = function (id) { return document.getElementById(id); };
  var statusBox = $("denuncia-status");
  var submitBtn = $("denuncia-submit");
  var okPanel = $("denuncia-ok");
  var tercerosList = $("terceros-list");
  var addBtn = $("tercero-add");
  var tpl = $("tercero-template");
  var draftBanner = $("draft-banner");
  var uid = 0;
  var restoring = false;

  /* ---------- Utilidades ---------- */
  function todayISO() {
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function addDays(iso, n) {
    var d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + n);
    return d;
  }
  function dmy(d) { return ("0" + d.getDate()).slice(-2) + "/" + ("0" + (d.getMonth() + 1)).slice(-2) + "/" + d.getFullYear(); }
  function digits(v) { return String(v || "").replace(/\D/g, ""); }
  function normPlate(v) { return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  function isHidden(el) { return !!el.closest("[hidden]"); }
  function fieldOf(el) { return el.closest(".field, .choice"); }
  function setError(el, msg) {
    var f = fieldOf(el);
    if (!f) return;
    f.classList.toggle("has-error", !!msg);
    var e = f.querySelector(".field-error");
    if (e) e.textContent = msg || "";
    if (el.setAttribute && el.type !== "file") el.setAttribute("aria-invalid", msg ? "true" : "false");
  }
  function showStatus(html) {
    statusBox.className = "form-status is-visible is-error";
    statusBox.innerHTML = html;
  }
  function clearStatus() { statusBox.className = "form-status"; statusBox.innerHTML = ""; }
  function formatSize(b) { return (b / 1024 / 1024).toFixed(1).replace(".", ",") + " MB"; }
  function radioValue(name) {
    var r = form.querySelector("input[name='" + name + "']:checked");
    return r ? r.value : "";
  }
  var WA_LINK = '<a href="https://wa.me/5493515161257" target="_blank" rel="noopener">WhatsApp</a>';

  $("d-fecha").max = todayISO();
  $("d-c-nacimiento").max = todayISO();

  /* ---------- Visibilidad según respuestas ---------- */
  function sync() {
    var tipo = radioValue("tipo");
    form.querySelectorAll("[data-when]").forEach(function (el) {
      el.hidden = !tipo || el.getAttribute("data-when").split(" ").indexOf(tipo) === -1;
    });
    form.querySelectorAll("[data-show]").forEach(function (el) {
      var parts = el.getAttribute("data-show").split(":");
      el.hidden = radioValue(parts[0]) !== (parts[1] || "si");
    });
    if (radioValue("hubo_terceros") === "si" && !tercerosList.children.length && !restoring) addTercero(false);
  }

  /* ---------- Plazo legal ---------- */
  function updateDeadline() {
    var v = $("d-fecha").value;
    var boxes = [$("plazo"), $("plazo-ok")];
    if (!v || v > todayISO()) { boxes.forEach(function (b) { b.hidden = true; }); return; }
    var limit = addDays(v, 3);
    var today = new Date(todayISO() + "T12:00:00");
    var html = limit >= today
      ? "<strong>Plazo para avisar a la compañía:</strong> la Ley de Seguros (17.418) fija 3 días desde que conocés el siniestro. Si te enteraste ese mismo día, vence el <strong>" + dmy(limit) + "</strong>."
      : "<strong>Atención:</strong> el plazo de 3 días que fija la Ley de Seguros (17.418) venció el " + dmy(limit) + " si te enteraste ese mismo día. Enviá igual la denuncia: Juan Manuel te va a indicar cómo seguir.";
    boxes.forEach(function (b) { b.innerHTML = html; b.hidden = false; });
  }
  $("d-fecha").addEventListener("change", updateDeadline);
  $("d-fecha").addEventListener("input", updateDeadline);

  /* ---------- Fotos: lectura, validación y compresión ---------- */
  function isHeic(file) { return /hei[cf]/i.test(file.type || "") || /\.(heic|heif)$/i.test(file.name || ""); }
  function isHeicSignature(file) {
    return file.slice(0, 12).arrayBuffer().then(function (buf) {
      var s = String.fromCharCode.apply(null, new Uint8Array(buf));
      return s.slice(4, 8) === "ftyp" && /^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(s.slice(8, 12));
    }).catch(function () { return false; });
  }
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
  function compress(file, o) {
    return decode(file).then(function (img) {
      var scale = Math.min(1, o.side / Math.max(img.width, img.height));
      var c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      var ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      if (img.close) img.close();
      return new Promise(function (resolve) { c.toBlob(resolve, "image/jpeg", o.quality); });
    });
  }
  // Devuelve { blob, raw } o rechaza con un mensaje para mostrar
  function processFile(file, o) {
    var typeOk = OK_TYPES.indexOf((file.type || "").toLowerCase()) > -1 || OK_EXT.test(file.name || "");
    if (!typeOk) return Promise.reject(new Error("«" + file.name + "»: formato no admitido. Usá una foto JPG, PNG, WEBP o HEIC."));
    if (file.size > MAX_INPUT_BYTES) return Promise.reject(new Error("«" + file.name + "» pesa " + formatSize(file.size) + ". El máximo es 10 MB."));
    return compress(file, o)
      .then(function (blob) {
        if (!blob) throw new Error("decode");
        return { blob: blob };
      })
      .catch(function () {
        // El navegador no pudo leerla: solo se acepta tal cual si es una foto HEIC real (iPhone).
        if (!isHeic(file) || file.size > o.max) throw new Error("decode");
        return isHeicSignature(file).then(function (yes) {
          if (!yes) throw new Error("decode");
          return { blob: file, raw: true };
        });
      })
      .then(function (res) {
        if (res.blob.size > o.max) throw new Error("decode");
        return res;
      })
      .catch(function (e) {
        if (e && e.message && e.message.indexOf("«") === 0) throw e;
        throw new Error("No pudimos procesar «" + file.name + "». Probá sacarla de nuevo o elegí una foto en formato JPG.");
      });
  }
  function ext(res) { return res.raw ? "heic" : "jpg"; }

  /* Carnet: un archivo por campo */
  var carnet = {};
  var pending = [];
  form.querySelectorAll(".file-field input[type='file']").forEach(function (input) {
    input.addEventListener("change", function () {
      var field = input.closest(".file-field");
      var empty = field.querySelector(".file-empty");
      var preview = field.querySelector(".file-preview");
      var file = input.files && input.files[0];
      delete carnet[input.name];
      preview.hidden = true;
      empty.hidden = false;
      setError(input, "");
      if (!file) return;
      var p = processFile(file, CARNET).then(function (res) {
        carnet[input.name] = res;
        preview.querySelector(".file-name").textContent = file.name + " · " + formatSize(res.blob.size);
        var img = preview.querySelector("img");
        img.hidden = !!res.raw;
        if (!res.raw) {
          if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
          img.dataset.url = URL.createObjectURL(res.blob);
          img.src = img.dataset.url;
        }
        preview.hidden = false;
        empty.hidden = true;
      }).catch(function (e) {
        input.value = "";
        setError(input, e.message);
      });
      pending.push(p);
    });
  });

  /* Selector de varias fotos (daños y papeles del tercero) */
  function initPicker(box) {
    box._items = [];
    var input = box.querySelector("input[type='file']");
    var list = box.querySelector(".picker-list");
    var max = Number(box.getAttribute("data-max") || 4);
    var addLabel = box.querySelector(".picker-add");
    if (!input.id) { input.id = "pk-" + (++uid); addLabel.htmlFor = input.id; }

    function refresh() { addLabel.hidden = box._items.length >= max; }
    function render(item) {
      var li = document.createElement("li");
      li.className = "picker-item";
      var img = document.createElement("img");
      img.alt = "Foto " + box._items.length;
      if (!item.raw) img.src = item.url = URL.createObjectURL(item.blob);
      else img.alt = "Foto HEIC (sin vista previa)";
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "picker-remove";
      rm.setAttribute("aria-label", "Quitar foto");
      rm.innerHTML = "&times;";
      rm.addEventListener("click", function () {
        box._items.splice(box._items.indexOf(item), 1);
        if (item.url) URL.revokeObjectURL(item.url);
        li.remove();
        refresh();
        setError(input, "");
        input.focus();
      });
      li.appendChild(img);
      li.appendChild(rm);
      list.appendChild(li);
    }
    input.addEventListener("change", function () {
      var files = Array.prototype.slice.call(input.files || []);
      input.value = "";
      setError(input, "");
      var room = max - box._items.length;
      var msgs = [];
      if (files.length > room) msgs.push("Podés agregar hasta " + max + " fotos. Tomamos las primeras " + room + ".");
      var jobs = files.slice(0, Math.max(0, room)).map(function (f) {
        return processFile(f, EXTRA).then(function (res) {
          if (box._items.length >= max) return;
          var item = { blob: res.blob, raw: res.raw };
          box._items.push(item);
          render(item);
          refresh();
        }).catch(function (e) { msgs.push(e.message); });
      });
      pending.push(Promise.all(jobs).then(function () { if (msgs.length) setError(input, msgs.join(" ")); }));
    });
    refresh();
  }
  initPicker($("d-fotos-danios").closest(".photo-picker"));

  /* ---------- Terceros ---------- */
  function buildField(slot) {
    var key = slot.getAttribute("data-key");
    var id = "t" + (++uid) + "-" + key;
    var label = slot.getAttribute("data-label");
    var isArea = slot.hasAttribute("data-textarea");
    var input = document.createElement(isArea ? "textarea" : "input");
    input.id = id;
    input.setAttribute("data-key", key);
    input.maxLength = Number(slot.getAttribute("data-max") || 200);
    if (isArea) input.rows = 3;
    else { input.type = slot.getAttribute("data-input") || "text"; input.autocomplete = "off"; }
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
  function tercerosItems() { return Array.prototype.slice.call(tercerosList.querySelectorAll("[data-tercero]")); }
  function tInputs(item) { return item.querySelectorAll("input[data-key], textarea[data-key]"); }
  function renumber() {
    tercerosItems().forEach(function (item, i) {
      item.querySelector(".tercero-title").textContent = "Tercero " + (i + 1);
      var rm = item.querySelector(".tercero-remove");
      rm.hidden = i === 0;
      rm.setAttribute("aria-label", "Quitar tercero " + (i + 1));
    });
    addBtn.hidden = tercerosItems().length >= MAX_TERCEROS;
  }
  function addTercero(focus) {
    if (tercerosItems().length >= MAX_TERCEROS) return null;
    var node = tpl.content.firstElementChild.cloneNode(true);
    node.querySelectorAll(".field[data-key]").forEach(buildField);
    node.querySelector(".tercero-remove").addEventListener("click", function () {
      node.remove();
      renumber();
      saveDraft();
      addBtn.focus();
    });
    tercerosList.appendChild(node);
    initPicker(node.querySelector(".photo-picker"));
    renumber();
    if (focus) node.querySelector("input[data-key]").focus();
    return node;
  }
  addBtn.addEventListener("click", function () { addTercero(true); saveDraft(); });
  tercerosList.addEventListener("change", function (e) {
    if (!e.target.hasAttribute("data-unknown")) return;
    var input = e.target.closest(".field").querySelector("input[data-key], textarea[data-key]");
    input.disabled = e.target.checked;
    if (e.target.checked) { input.value = ""; setError(input, ""); }
  });

  /* ---------- Borrador automático (sin fotos) ---------- */
  function collectDraft() {
    var fields = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.type === "file" || el.name === "sitio_web") return;
      if (el.type === "radio") { if (el.checked) fields[el.name] = el.value; }
      else if (el.type === "checkbox") fields[el.name] = el.checked;
      else fields[el.name] = el.value;
    });
    var terceros = tercerosItems().map(function (item) {
      var t = {};
      tInputs(item).forEach(function (el) { t[el.getAttribute("data-key")] = el.disabled ? null : el.value; });
      return t;
    });
    return { v: 2, t: Date.now(), fields: fields, terceros: terceros };
  }
  var saveTimer;
  function saveDraft() {
    if (restoring) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(collectDraft())); } catch (e) { /* sin almacenamiento */ }
    }, 300);
  }
  function clearDraft() {
    clearTimeout(saveTimer);
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* nada */ }
  }
  function restoreDraft() {
    var d;
    try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (e) { d = null; }
    if (!d || d.v !== 2 || Date.now() - d.t > DRAFT_DAYS * 864e5) { clearDraft(); return; }
    var hasContent = Object.keys(d.fields).some(function (k) { return d.fields[k] && k !== "consentimiento"; });
    if (!hasContent) return;
    restoring = true;
    Object.keys(d.fields).forEach(function (name) {
      var el = form.elements[name];
      if (!el) return;
      var v = d.fields[name];
      if (el.length && !el.tagName) Array.prototype.forEach.call(el, function (r) { r.checked = r.value === v; });
      else if (el.type === "checkbox") el.checked = !!v;
      else el.value = v;
    });
    (d.terceros || []).forEach(function (t) {
      var node = addTercero(false);
      if (!node) return;
      tInputs(node).forEach(function (el) {
        var v = t[el.getAttribute("data-key")];
        if (v === null) {
          el.disabled = true;
          el.closest(".field").querySelector("[data-unknown]").checked = true;
        } else el.value = v || "";
      });
    });
    restoring = false;
    sync();
    updateDeadline();
    draftBanner.hidden = false;
  }
  $("draft-clear").addEventListener("click", function () {
    clearDraft();
    form.reset();
    tercerosList.innerHTML = "";
    var pk = $("d-fotos-danios").closest(".photo-picker");
    pk._items = [];
    pk.querySelector(".picker-list").innerHTML = "";
    pk.querySelector(".picker-add").hidden = false;
    Object.keys(carnet).forEach(function (k) { delete carnet[k]; });
    form.querySelectorAll(".file-preview").forEach(function (p) { p.hidden = true; });
    form.querySelectorAll(".file-empty").forEach(function (p) { p.hidden = false; });
    form.querySelectorAll(".has-error").forEach(function (f) { f.classList.remove("has-error"); });
    form.querySelectorAll(".field-error").forEach(function (f) { f.textContent = ""; });
    clearStatus();
    draftBanner.hidden = true;
    sync();
    updateDeadline();
    form.querySelector("input[name='tipo']").focus();
  });

  /* ---------- Validación ---------- */
  function checkValue(el, value) {
    var type = el.getAttribute("data-type");
    if (!value) return "Completá este campo.";
    if (type === "dni" && !/^\d{7,8}$/.test(digits(value))) return "Ingresá un DNI válido (7 u 8 números).";
    if (type === "phone" && digits(value).length < 8) return "Ingresá un teléfono válido, con código de área.";
    if (type === "plate" && !/^[A-Z0-9]{5,8}$/.test(normPlate(value))) return "Ingresá una patente válida (ej.: AB123CD o ABC123).";
    if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return "Revisá el correo electrónico.";
    if (type === "birthdate" && (value > todayISO() || value < "1900-01-01")) return "Revisá la fecha de nacimiento.";
    return "";
  }
  function totalBytes() {
    var t = 0;
    if (!isHidden($("d-frente"))) Object.keys(carnet).forEach(function (k) { t += carnet[k].blob.size; });
    form.querySelectorAll(".photo-picker").forEach(function (b) {
      if (isHidden(b)) return;
      (b._items || []).forEach(function (i) { t += i.blob.size; });
    });
    return t;
  }
  function validate() {
    var first = null;
    function fail(el, msg) { setError(el, msg); if (msg && !first) first = el; }

    form.querySelectorAll("fieldset.choice").forEach(function (fs) {
      var any = fs.querySelector("input");
      if (isHidden(fs)) return setError(any, "");
      fail(any, radioValue(fs.getAttribute("data-choice")) ? "" : "Elegí una opción.");
    });
    form.querySelectorAll("input[name], select[name], textarea[name]").forEach(function (el) {
      if (el.type === "radio" || el.type === "file" || el.type === "checkbox" || el.name === "sitio_web") return;
      if (isHidden(el)) return setError(el, "");
      var v = el.value.trim();
      var req = el.hasAttribute("required") || el.hasAttribute("data-req-when");
      if (!v) return fail(el, req ? (el.tagName === "SELECT" ? "Elegí una opción." : "Completá este campo.") : "");
      fail(el, checkValue(el, v));
    });
    var fecha = $("d-fecha");
    if (fecha.value && fecha.value > todayISO()) fail(fecha, "La fecha no puede ser posterior a hoy.");

    if (!isHidden($("terceros"))) {
      tercerosItems().forEach(function (item) {
        tInputs(item).forEach(function (el) {
          if (el.disabled) return setError(el, "");
          var v = el.value.trim();
          fail(el, v ? checkValue(el, v) : "Completá este dato o marcá «No lo sé».");
        });
      });
    }
    if (!isHidden($("d-frente"))) {
      ["carnet_frente", "carnet_dorso"].forEach(function (n) {
        var el = form.elements[n];
        var current = el.closest(".file-field").querySelector(".field-error").textContent;
        if (!carnet[n]) fail(el, current || ("Subí la foto del " + (n === "carnet_frente" ? "frente" : "dorso") + " del carnet."));
      });
    }
    if (totalBytes() > MAX_TOTAL_BYTES) {
      fail($("d-fotos-danios"), "Entre todas, las fotos superan el tamaño que podemos enviar (" + formatSize(totalBytes()) + " de " + formatSize(MAX_TOTAL_BYTES) + "). Quitá alguna foto de daños o de los papeles del tercero.");
    }
    var consent = form.elements.consentimiento;
    fail(consent, consent.checked ? "" : "Necesitamos tu autorización para gestionar la denuncia.");
    return first;
  }

  form.addEventListener("input", function (e) {
    var f = fieldOf(e.target);
    if (f && f.classList.contains("has-error") && e.target.type !== "file") setError(e.target, "");
    if (e.target.type !== "file") saveDraft();
  });
  form.addEventListener("change", function (e) {
    var t = e.target;
    if (t.type === "radio") { sync(); setError(t, ""); }
    if (t.type !== "file") saveDraft();
  });

  /* ---------- Envío ---------- */
  function buildData() {
    var fd = new FormData();
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.type === "file" || isHidden(el)) return;
      if (el.type === "radio" && !el.checked) return;
      if (el.type === "checkbox") { if (el.checked) fd.append(el.name, el.value); return; }
      fd.append(el.name, el.getAttribute("data-type") === "plate" ? normPlate(el.value) : el.value.trim());
    });
    if (!isHidden($("terceros"))) {
      var items = tercerosItems();
      fd.append("terceros_cantidad", items.length);
      items.forEach(function (item, i) {
        var pre = "t" + (i + 1) + "_";
        tInputs(item).forEach(function (el) {
          var key = pre + el.getAttribute("data-key");
          if (el.disabled) fd.append(key + "_nolose", "1");
          else fd.append(key, el.getAttribute("data-type") === "plate" ? normPlate(el.value) : el.value.trim());
        });
        item.querySelector(".photo-picker")._items.forEach(function (it, j) {
          fd.append(pre + "doc", it.blob, pre + "doc-" + (j + 1) + "." + ext(it));
        });
      });
    }
    if (!isHidden($("d-frente"))) {
      fd.append("carnet_frente", carnet.carnet_frente.blob, "frente." + ext(carnet.carnet_frente));
      fd.append("carnet_dorso", carnet.carnet_dorso.blob, "dorso." + ext(carnet.carnet_dorso));
    }
    $("d-fotos-danios").closest(".photo-picker")._items.forEach(function (it, j) {
      fd.append("foto_danio", it.blob, "danio-" + (j + 1) + "." + ext(it));
    });
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
      var m = /^t(\d+)_([a-z]+)$/.exec(name);
      if (m) {
        var item = tercerosItems()[Number(m[1]) - 1];
        el = item && (item.querySelector("input[data-key='" + m[2] + "'], textarea[data-key='" + m[2] + "']") || item.querySelector(".photo-picker input"));
      }
      if (name === "foto_danio") el = $("d-fotos-danios");
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
    if (submitBtn.disabled) return;
    clearStatus();
    Promise.all(pending).then(function () {
      var bad = validate();
      if (bad) {
        showStatus("Revisá los campos marcados en rojo antes de enviar.");
        focusError(bad);
        return;
      }
      setSending(true);
      var controller = window.AbortController ? new AbortController() : null;
      var timer = controller && setTimeout(function () { controller.abort(); }, 60000);
      fetch(ENDPOINT, { method: "POST", body: buildData(), headers: { Accept: "application/json" }, signal: controller && controller.signal })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) { return { res: res, data: data }; });
        })
        .then(function (r) {
          if (r.res.ok && r.data && r.data.ok) {
            clearDraft();
            if (r.data.ref) {
              var ref = $("denuncia-ref");
              ref.querySelector("strong").textContent = r.data.ref;
              ref.hidden = false;
              $("ok-wa").href = "https://wa.me/5493515161257?text=" + encodeURIComponent("Hola Juan Manuel, acabo de enviar la denuncia de siniestro " + r.data.ref + " desde la web.");
            }
            form.hidden = true;
            draftBanner.hidden = true;
            okPanel.hidden = false;
            okPanel.focus();
            okPanel.scrollIntoView({ behavior: "smooth", block: "start" });
            if (typeof window.gtag === "function") window.gtag("event", "generate_lead", { formulario: "denuncia_siniestro", tipo: radioValue("tipo") });
            return;
          }
          var first = applyServerErrors(r.data && r.data.errors);
          showStatus((r.data && r.data.message ? r.data.message : "No pudimos enviar la denuncia.") +
            " Tus datos siguen cargados: revisalos y volvé a intentar. Si el problema sigue, escribinos por " + WA_LINK + ".");
          if (first) focusError(first); else statusBox.focus();
        })
        .catch(function () {
          showStatus("No pudimos enviar la denuncia por un problema de conexión. Tus datos siguen cargados: revisá tu conexión y volvé a intentar. Si el problema sigue, escribinos por " + WA_LINK + ".");
          statusBox.focus();
        })
        .then(function () {
          if (timer) clearTimeout(timer);
          setSending(false);
        });
    });
  });

  /* ---------- ¿El envío está habilitado? ---------- */
  fetch(ENDPOINT, { headers: { Accept: "application/json" } })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && d.configurado === false) {
        $("denuncia-off").classList.add("is-visible");
        submitBtn.disabled = true;
        submitBtn.querySelector(".btn-text").textContent = "Envío no disponible";
      }
    })
    .catch(function () { /* si no se puede consultar, se intenta igual al enviar */ });

  /* ---------- Estado inicial ---------- */
  restoreDraft();
  sync();
  updateDeadline();
})();
