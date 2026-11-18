/* Formularios para clientes (segurosarnedo.com/f/<enlace>).
   Arma el formulario que definió el productor en el panel, lo muestra por
   pasos, sube las fotos de a una (achicadas en el celular) y envía los datos.
   No usa analíticas ni guarda nada en el navegador. */
(function () {
  "use strict";

  var slug = (location.pathname.split("/f/")[1] || "").split("/")[0];
  var API = "/api/f/" + encodeURIComponent(slug);
  var $ = function (id) { return document.getElementById(id); };
  var form = $("fx-form"), stepsBox = $("fx-steps"), statusBox = $("fx-status");
  var def = null, token = "", step = 0, sending = false, dirty = false;
  var uploads = {}; // campo -> [{ id, name, url, pending }]
  var PHOTO = { side: 1700, quality: 0.8 };
  var MAX_BYTES = 4 * 1024 * 1024;

  var ICON = {
    camera: '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>',
    file: '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    x: '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    warn: '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    info: '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
  };

  // Dibujos de referencia para las fotos del vehículo.
  var CAR_SIDE = '<path d="M8 41v-8c0-3 3-5 8-5.5l16-1.5 12-10c2.5-2 5-3 9-3h22c4 0 6.5 1.2 9 3.8l8.5 9.2 11 1.6c3.6.6 5.5 2.6 5.5 6V41z"/><path d="M46 26l9-9h20l8.5 9z"/><path d="M67 17v9"/><circle cx="31" cy="42" r="7"/><circle cx="93" cy="42" r="7"/>';
  var DRAW = {
    izquierdo: '<svg viewBox="0 0 124 56" aria-hidden="true"><g transform="translate(124 0) scale(-1 1)">' + CAR_SIDE + '</g></svg>',
    derecho: '<svg viewBox="0 0 124 56" aria-hidden="true">' + CAR_SIDE + '</svg>',
    frente: '<svg viewBox="0 0 124 56" aria-hidden="true"><path d="M26 46V31c0-5 3-9 9-10l8-10h38l8 10c6 1 9 5 9 10v15z"/><path d="M45 20l5-6h24l5 6z"/><rect x="31" y="27" width="13" height="6" rx="2"/><rect x="80" y="27" width="13" height="6" rx="2"/><rect x="51" y="31" width="22" height="7" rx="2"/><path d="M30 46v6h10v-6M84 46v6h10v-6"/></svg>',
    trasera: '<svg viewBox="0 0 124 56" aria-hidden="true"><path d="M26 46V31c0-5 3-9 9-10l8-10h38l8 10c6 1 9 5 9 10v15z"/><path d="M45 20l5-6h24l5 6z"/><path d="M30 28h12v7H30zM82 28h12v7H82z"/><rect x="52" y="34" width="20" height="7" rx="1.5"/><path d="M30 46v6h10v-6M84 46v6h10v-6"/></svg>',
    cedula: '<svg viewBox="0 0 124 56" aria-hidden="true"><rect x="22" y="6" width="80" height="46" rx="5"/><path d="M30 16h28M30 24h40M30 32h34M30 40h22"/><rect x="76" y="14" width="18" height="14" rx="2"/></svg>'
  };
  var ILUS_TXT = { frente: "De frente, con todo el auto en la foto", trasera: "Desde atrás, con la patente visible", izquierdo: "Del lado izquierdo, de punta a punta", derecho: "Del lado derecho, de punta a punta", cedula: "Que se lean todos los datos" };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function digits(v) { return String(v || "").replace(/\D/g, ""); }
  function allFields() { return def.sections.reduce(function (a, s) { return a.concat(s.fields); }, []); }
  function fieldById(id) { return allFields().filter(function (f) { return f.id === id; })[0]; }

  // ---------- Validadores (los mismos que en el servidor) ----------
  function cbuValido(v) {
    var d = digits(v); if (d.length !== 22) return false;
    var n = d.split("").map(Number), w1 = [7, 1, 3, 9, 7, 1, 3], w2 = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3], s1 = 0, s2 = 0, i;
    for (i = 0; i < 7; i++) s1 += w1[i] * n[i];
    for (i = 0; i < 13; i++) s2 += w2[i] * n[8 + i];
    return (10 - (s1 % 10)) % 10 === n[7] && (10 - (s2 % 10)) % 10 === n[21];
  }
  function luhn(d) { var s = 0; for (var i = 0; i < d.length; i++) { var x = +d[d.length - 1 - i]; if (i % 2) { x *= 2; if (x > 9) x -= 9; } s += x; } return d.length > 0 && s % 10 === 0; }
  function tarjetaValida(v) { var d = digits(v); return d.length >= 15 && d.length <= 16 && (d.indexOf("589562") === 0 || luhn(d)); }

  // ---------- Armado ----------
  function inputAttrs(f) {
    var a = { text: 'type="text" autocomplete="' + (f.role === "nombre" ? "name" : /domicilio|direcc/i.test(f.label) ? "street-address" : /localidad|ciudad/i.test(f.label) ? "address-level2" : /provincia/i.test(f.label) ? "address-level1" : "off") + '" maxlength="200"',
      number: 'type="text" inputmode="decimal" autocomplete="off" maxlength="20"',
      dni: 'type="text" inputmode="numeric" autocomplete="off" maxlength="12"',
      tel: 'type="tel" inputmode="tel" autocomplete="tel" maxlength="30"',
      email: 'type="email" inputmode="email" autocomplete="email" maxlength="120" autocapitalize="off" spellcheck="false"',
      date: 'type="date"',
      cbu: 'type="text" inputmode="numeric" autocomplete="off" maxlength="30" spellcheck="false"',
      card: 'type="text" inputmode="numeric" autocomplete="cc-number" maxlength="23" spellcheck="false"' };
    return a[f.type] || 'type="text"';
  }

  function label(f, forId) {
    var req = f.required ? ' <span class="req" aria-hidden="true">*</span>' : ' <span class="opt">(opcional)</span>';
    return forId ? '<label for="' + forId + '">' + esc(f.label) + req + "</label>" : '<span class="file-label">' + esc(f.label) + req + "</span>";
  }

  function renderField(f) {
    var id = "c-" + f.id, help = f.help ? '<span class="form-hint fx-help">' + esc(f.help) + "</span>" : "";
    var wrap = function (cls, inner) {
      return '<div class="field fx-field ' + cls + (f.width === "half" ? " fx-half" : "") + '" data-field="' + f.id + '"' + (f.show ? ' data-show-field="' + esc(f.show.field) + '" data-show-value="' + esc(f.show.value) + '"' : "") + ">" + inner + '<span class="field-error" aria-live="polite"></span></div>';
    };
    switch (f.type) {
      case "note":
        return '<div class="fx-note fx-note--' + (f.variant || "info") + '" data-field="' + f.id + '"' + (f.show ? ' data-show-field="' + esc(f.show.field) + '" data-show-value="' + esc(f.show.value) + '"' : "") + ">" + (f.variant === "warning" ? ICON.warn : ICON.info) + "<p>" + esc(f.label) + "</p></div>";
      case "textarea":
        return wrap("", label(f, id) + '<textarea id="' + id + '" name="' + f.id + '" rows="4" maxlength="2000" placeholder="' + esc(f.placeholder || "") + '"></textarea>' + help);
      case "select":
        if (f.options.length <= 6) {
          return wrap("choice fx-choice", '<span class="file-label" id="' + id + '-l">' + esc(f.label) + (f.required ? ' <span class="req" aria-hidden="true">*</span>' : ' <span class="opt">(opcional)</span>') + '</span><div class="choice-options" role="radiogroup" aria-labelledby="' + id + '-l">' +
            f.options.map(function (o) { return '<label class="choice-option"><input type="radio" name="' + f.id + '" value="' + esc(o) + '"><span>' + esc(o) + "</span></label>"; }).join("") + "</div>" + help);
        }
        return wrap("", label(f, id) + '<select id="' + id + '" name="' + f.id + '"><option value="">Elegí una opción</option>' + f.options.map(function (o) { return '<option value="' + esc(o) + '">' + esc(o) + "</option>"; }).join("") + "</select>" + help);
      case "consent":
        var txt = esc(f.label).replace(/pol[ií]tica de privacidad/i, function (m) { return '<a href="' + esc(f.link || "/pages/privacidad.html") + '" target="_blank" rel="noopener">' + m + "</a>"; });
        return wrap("fx-consent", '<label class="check"><input type="checkbox" id="' + id + '" name="' + f.id + '"><span>' + txt + (f.required ? ' <span class="req" aria-hidden="true">*</span>' : "") + "</span></label>");
      case "photo":
      case "document":
        var draw = f.illustration && DRAW[f.illustration];
        var accept = f.type === "photo" ? "image/*,.heic,.heif" : "application/pdf,image/*,.heic,.heif";
        var empty = draw
          ? '<span class="file-empty fx-ilus">' + draw + "<b>" + ICON.camera + " Sacar foto o elegir</b><small>" + esc(ILUS_TXT[f.illustration] || "") + "</small></span>"
          : '<span class="file-empty">' + (f.type === "photo" ? ICON.camera : ICON.file) + "<b>" + (f.type === "photo" ? "Sacar foto o elegir" : "Elegir archivo (PDF o foto)") + "</b>" + (f.max > 1 ? "<small>Hasta " + f.max + " archivos</small>" : "") + "</span>";
        return wrap("file-field fx-file", label(f, null) +
          '<label class="file-drop" for="' + id + '"><input id="' + id + '" type="file" accept="' + accept + '"' + (f.max > 1 ? " multiple" : "") + ' aria-describedby="' + id + '-h">' + empty + "</label>" +
          '<ul class="fx-files" role="list"></ul>' + (f.help ? '<span class="form-hint fx-help" id="' + id + '-h">' + esc(f.help) + "</span>" : '<span id="' + id + '-h" hidden></span>'));
      default:
        return wrap(f.type === "cbu" || f.type === "card" ? "fx-sensitive" : "", label(f, id) + "<input id=\"" + id + "\" name=\"" + f.id + "\" " + inputAttrs(f) + ' placeholder="' + esc(f.placeholder || "") + '">' +
          (f.type === "cbu" ? '<span class="fx-count" aria-live="polite"></span>' : "") + help);
    }
  }

  function build() {
    $("fx-ramo").textContent = def.ramo || "";
    $("fx-title").textContent = def.title;
    document.title = def.title + " | JMA Seguros";
    $("fx-desc").textContent = def.description || "";
    $("fx-desc").hidden = !def.description;
    $("fx-submit").textContent = def.submitLabel || "Enviar información";
    stepsBox.innerHTML = def.sections.map(function (s, i) {
      return '<section class="fx-step" data-step="' + i + '"' + (i ? " hidden" : "") + ' aria-labelledby="fx-s' + i + '"><h2 class="fx-step-title" id="fx-s' + i + '">' + esc(s.title) + "</h2>" +
        (s.description ? '<p class="fx-muted">' + esc(s.description) + "</p>" : "") + '<div class="fx-grid">' + s.fields.map(renderField).join("") + "</div></section>";
    }).join("");
    wire();
    sync();
    go(0, true);
  }

  // ---------- Condiciones (mostrar campos según una opción) ----------
  function value(f) {
    if (f.type === "select") {
      if (f.options.length <= 6) { var r = form.querySelector('input[name="' + f.id + '"]:checked'); return r ? r.value : ""; }
      return form.elements[f.id].value;
    }
    if (f.type === "consent") return $("c-" + f.id).checked;
    if (f.type === "photo" || f.type === "document") return (uploads[f.id] || []).filter(function (u) { return u.id; }).map(function (u) { return u.id; });
    var el = form.elements[f.id];
    if (!el) return "";
    return f.type === "cbu" || f.type === "card" ? digits(el.value) : el.value.trim();
  }
  function isVisible(el) {
    var fid = el.getAttribute("data-show-field");
    if (!fid) return true;
    var ref = fieldById(fid);
    return ref && value(ref) === el.getAttribute("data-show-value");
  }
  function sync() {
    stepsBox.querySelectorAll("[data-show-field]").forEach(function (el) { el.hidden = !isVisible(el); });
  }

  // ---------- Errores ----------
  function boxOf(fid) { return stepsBox.querySelector('[data-field="' + fid + '"]'); }
  function setError(fid, msg) {
    var box = boxOf(fid); if (!box) return;
    box.classList.toggle("has-error", !!msg);
    var e = box.querySelector(".field-error"); if (e) e.textContent = msg || "";
    var input = box.querySelector("input:not([type=radio]):not([type=file]), select, textarea");
    if (input) { if (msg) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid"); }
  }
  function showStatus(html, ok) { statusBox.innerHTML = html; statusBox.className = "form-status is-visible " + (ok ? "is-success" : "is-error"); }
  function clearStatus() { statusBox.className = "form-status"; statusBox.innerHTML = ""; }

  function check(f) {
    var box = boxOf(f.id);
    if (!box || box.hidden || f.type === "note") return "";
    var v = value(f);
    var empty = v === "" || v === false || (Array.isArray(v) && !v.length);
    if (f.type === "photo" || f.type === "document") {
      if ((uploads[f.id] || []).some(function (u) { return u.pending; })) return "Esperá a que termine de subir.";
    }
    if (empty) return f.required ? (f.type === "consent" ? "Tenés que aceptar para continuar." : (f.type === "photo" || f.type === "document") ? "Falta este archivo." : f.type === "select" ? "Elegí una opción." : "Completá este dato.") : "";
    switch (f.type) {
      case "dni": var d = digits(v); return d.length < 7 || d.length > 8 ? "Ingresá un DNI válido (7 u 8 números, sin puntos)." : "";
      case "tel": var t = digits(v); return t.length < 8 || t.length > 15 ? "Ingresá el teléfono con código de área." : "";
      case "email": return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? "" : "Revisá el correo electrónico.";
      case "number":
        var n = Number(String(v).replace(/\./g, "").replace(",", "."));
        if (!isFinite(n)) return "Ingresá un número.";
        if (f.min != null && n < f.min) return "Tiene que ser " + f.min + " o más.";
        if (f.max != null && n > f.max) return "Tiene que ser " + f.max + " o menos.";
        return "";
      case "cbu": return v.length !== 22 ? "El CBU tiene 22 números (tenés " + v.length + ")." : cbuValido(v) ? "" : "El CBU no es válido. Revisá los números.";
      case "card": return v.length < 15 || v.length > 16 ? "El número de tarjeta tiene 16 números." : tarjetaValida(v) ? "" : "El número de tarjeta no es válido. Revisalo.";
      default: return "";
    }
  }
  function validateStep(i) {
    var first = null;
    def.sections[i].fields.forEach(function (f) {
      var msg = check(f);
      setError(f.id, msg);
      if (msg && !first) first = f.id;
    });
    return first;
  }
  function focusField(fid) {
    var box = boxOf(fid); if (!box) return;
    box.scrollIntoView({ behavior: "smooth", block: "center" });
    var el = box.querySelector("input:not([type=hidden]), select, textarea");
    if (el) try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  }

  // ---------- Pasos ----------
  function go(i, initial) {
    step = i;
    var total = def.sections.length;
    stepsBox.querySelectorAll(".fx-step").forEach(function (s) { s.hidden = +s.getAttribute("data-step") !== i; });
    $("fx-prev").hidden = i === 0;
    $("fx-next").hidden = i === total - 1;
    $("fx-submit").hidden = i !== total - 1;
    $("fx-bar").style.width = Math.round(((i + 1) / total) * 100) + "%";
    $("fx-step-label").textContent = total > 1 ? "Paso " + (i + 1) + " de " + total + " · " + def.sections[i].title : "";
    form.querySelector(".fx-progress").hidden = total < 2;
    clearStatus();
    if (!initial) {
      form.scrollIntoView({ behavior: "smooth", block: "start" });
      var h = stepsBox.querySelector('[data-step="' + i + '"] .fx-step-title');
      if (h) { h.setAttribute("tabindex", "-1"); try { h.focus({ preventScroll: true }); } catch (e) {} }
    }
  }

  // ---------- Archivos ----------
  function isHeic(file) { return /hei[cf]/i.test(file.type || "") || /\.(heic|heif)$/i.test(file.name || ""); }
  function decode(file) {
    if (window.createImageBitmap) return createImageBitmap(file, { imageOrientation: "from-image" }).catch(function () { return createImageBitmap(file); });
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("decode")); };
      img.src = url;
    });
  }
  function compress(file) {
    return decode(file).then(function (img) {
      var w = img.width, h = img.height, k = Math.min(1, PHOTO.side / Math.max(w, h));
      var c = document.createElement("canvas");
      c.width = Math.round(w * k); c.height = Math.round(h * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return new Promise(function (resolve) { c.toBlob(resolve, "image/jpeg", PHOTO.quality); });
    });
  }
  function prepare(file, f) {
    var isPdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);
    if (isPdf) {
      if (f.type !== "document") return Promise.reject(new Error("Elegí una foto (no un PDF)."));
      return file.size > MAX_BYTES ? Promise.reject(new Error("El PDF pesa más de 4 MB. Probá con uno más liviano.")) : Promise.resolve(file);
    }
    return compress(file).then(function (blob) {
      if (!blob) throw new Error("decode");
      return blob;
    }).catch(function () {
      if (isHeic(file) && file.size <= MAX_BYTES) return file; // el navegador no la puede abrir: se sube tal cual
      throw new Error(isHeic(file) ? "No pudimos procesar esa foto. Probá sacarla de nuevo o elegir otra." : "Ese archivo no es una foto válida.");
    });
  }
  function upload(f, blob) {
    return fetch(API + "/archivo?campo=" + encodeURIComponent(f.id), {
      method: "POST", body: blob, headers: { "x-borrador": token, "content-type": blob.type || "application/octet-stream" }
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo subir el archivo. Revisá tu conexión y probá de nuevo.");
        return j.id;
      });
    });
  }
  var queue = Promise.resolve();
  function addFiles(f, files) {
    var list = uploads[f.id] = uploads[f.id] || [];
    var room = f.max - list.length;
    var chosen = Array.prototype.slice.call(files, 0, f.max === 1 ? 1 : Math.max(0, room));
    if (f.max === 1) { list.length = 0; }
    if (!chosen.length) { setError(f.id, "Ya cargaste el máximo de " + f.max + " archivos."); return; }
    setError(f.id, "");
    chosen.forEach(function (file) {
      var item = { id: "", name: file.name || "foto.jpg", url: "", pending: true, pdf: /pdf/i.test(file.type) || /\.pdf$/i.test(file.name || "") };
      list.push(item);
      renderFiles(f);
      queue = queue.then(function () {
        return prepare(file, f).then(function (blob) {
          if (!item.pdf && blob.type === "image/jpeg") item.url = URL.createObjectURL(blob);
          renderFiles(f);
          return upload(f, blob);
        }).then(function (id) {
          item.id = id; item.pending = false; dirty = true; renderFiles(f); sync();
        }).catch(function (err) {
          var i = list.indexOf(item); if (i >= 0) list.splice(i, 1);
          renderFiles(f);
          setError(f.id, err.message || "No se pudo cargar el archivo.");
        });
      });
    });
  }
  function renderFiles(f) {
    var box = boxOf(f.id); if (!box) return;
    var list = uploads[f.id] || [];
    var ul = box.querySelector(".fx-files"), drop = box.querySelector(".file-drop");
    ul.innerHTML = list.map(function (u, i) {
      return '<li class="fx-file-item' + (u.pending ? " is-pending" : "") + '">' +
        (u.url ? '<img src="' + u.url + '" alt="">' : '<span class="fx-file-icon">' + (u.pdf ? ICON.file : ICON.camera) + "</span>") +
        '<span class="fx-file-name">' + (u.pending ? "Subiendo…" : "Cargada") + "</span>" +
        (u.pending ? "" : '<button type="button" class="fx-file-remove" data-remove="' + i + '" aria-label="Quitar archivo">' + ICON.x + "</button>") + "</li>";
    }).join("");
    drop.hidden = list.length >= f.max;
    box.classList.toggle("is-loaded", list.length > 0);
  }

  // ---------- Eventos ----------
  function wire() {
    allFields().forEach(function (f) {
      var box = boxOf(f.id); if (!box || f.type === "note") return;
      if (f.type === "photo" || f.type === "document") {
        var input = box.querySelector("input[type=file]");
        input.addEventListener("change", function () { if (input.files && input.files.length) addFiles(f, input.files); input.value = ""; });
        box.querySelector(".fx-files").addEventListener("click", function (e) {
          var b = e.target.closest("[data-remove]"); if (!b) return;
          var list = uploads[f.id] || []; var u = list.splice(+b.getAttribute("data-remove"), 1)[0];
          if (u && u.url) URL.revokeObjectURL(u.url);
          renderFiles(f);
        });
        return;
      }
      box.addEventListener("input", function (e) {
        dirty = true;
        if (f.type === "card") {
          var d = digits(e.target.value).slice(0, 16);
          e.target.value = d.replace(/(\d{4})(?=\d)/g, "$1 ");
        }
        if (f.type === "cbu") {
          var c = digits(e.target.value).slice(0, 22);
          e.target.value = c;
          box.querySelector(".fx-count").textContent = c.length ? c.length + " de 22 números" : "";
        }
        if (f.type === "dni") e.target.value = digits(e.target.value).slice(0, 8);
        if (box.classList.contains("has-error")) setError(f.id, check(f));
      });
      box.addEventListener("change", function () {
        dirty = true;
        if (f.type === "select") sync();
        if (box.classList.contains("has-error") || f.type === "select" || f.type === "consent") setError(f.id, check(f));
      });
      box.addEventListener("focusout", function (e) {
        if (f.type === "select" || f.type === "consent") return;
        if (e.target.value && e.target.value.trim()) setError(f.id, check(f));
      });
    });
  }

  $("fx-next").addEventListener("click", function () {
    var bad = validateStep(step);
    if (bad) { focusField(bad); return; }
    go(step + 1);
  });
  $("fx-prev").addEventListener("click", function () { go(step - 1); });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (sending) return;
    for (var i = 0; i < def.sections.length; i++) {
      var bad = validateStep(i);
      if (bad) { if (i !== step) go(i); setTimeout(function () { focusField(bad); }, 50); return; }
    }
    var valores = {};
    allFields().forEach(function (f) {
      if (f.type === "note") return;
      var box = boxOf(f.id); if (!box || box.hidden) return;
      valores[f.id] = value(f);
    });
    sending = true;
    var btn = $("fx-submit");
    btn.disabled = true; btn.textContent = "Enviando…";
    clearStatus();
    fetch(API + "/enviar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ borrador: token, valores: valores, website: $("fx-website").value })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; });
    }).then(function (r) {
      if (r.body.ok) {
        dirty = false;
        form.hidden = true;
        $("fx-done-text").textContent = r.body.mensaje || "¡Muchas gracias! Recibimos tu información.";
        $("fx-ref").textContent = r.body.ref || "";
        $("fx-ref").parentNode.hidden = !r.body.ref;
        $("fx-done").hidden = false;
        $("fx-done").focus();
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      if (r.body.errors) {
        var firstStep = null, firstField = null;
        Object.keys(r.body.errors).forEach(function (fid) {
          setError(fid, r.body.errors[fid]);
          def.sections.forEach(function (s, i) { if (firstStep === null && s.fields.some(function (f) { return f.id === fid; })) { firstStep = i; firstField = fid; } });
        });
        if (firstStep !== null) { go(firstStep); setTimeout(function () { focusField(firstField); }, 50); }
        showStatus("Revisá los datos marcados.");
        return;
      }
      showStatus(esc(r.body.error || "No pudimos enviar el formulario. Probá de nuevo en unos minutos.") + ' Si sigue fallando, <a href="https://wa.me/5493515161257" target="_blank" rel="noopener">escribinos por WhatsApp</a>.');
    }).catch(function () {
      showStatus('No pudimos enviar el formulario. Revisá tu conexión y probá de nuevo. Tus datos siguen cargados.');
    }).then(function () {
      sending = false;
      btn.disabled = false;
      btn.textContent = def.submitLabel || "Enviar información";
    });
  });

  window.addEventListener("beforeunload", function (e) {
    if (dirty && !sending) { e.preventDefault(); e.returnValue = ""; }
  });

  // ---------- Inicio ----------
  function fail(msg) {
    $("fx-loading").hidden = true;
    $("fx-error-text").textContent = msg;
    $("fx-error").hidden = false;
  }
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(slug)) { fail("El enlace no es válido. Pedile a tu productor que te lo envíe de nuevo."); return; }
  fetch(API, { headers: { accept: "application/json" } }).then(function (r) {
    return r.json().catch(function () { return {}; });
  }).then(function (j) {
    if (!j.ok) { fail(j.error || "Este formulario no está disponible."); return; }
    def = j.form; token = j.borrador;
    $("fx-loading").hidden = true;
    form.hidden = false;
    build();
  }).catch(function () { fail("No pudimos cargar el formulario. Revisá tu conexión y recargá la página."); });
})();
