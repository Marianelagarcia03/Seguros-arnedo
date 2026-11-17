/* ==========================================================================
   JMA Seguros — interacciones del sitio (JavaScript sin dependencias)
   - Menú responsive (cierra al elegir opción, con Escape o tocando afuera)
   - Encabezado fijo con estado al desplazarse
   - Enlaces de WhatsApp con mensajes personalizados por producto
   - Formulario de cotización → WhatsApp o correo con los datos cargados
   - Formulario de contacto → envío real a Formspree con manejo de errores
   - Animaciones de aparición discretas
   ========================================================================== */
(function () {
  "use strict";

  var CONFIG = {
    whatsapp: "5493515161257", // +54 9 351 516-1257
    email: "juanmanuelarnedo@gmail.com",
    defaultMessage: "Hola Juan Manuel, quisiera hacer una consulta.",
    // Google Analytics 4: pegá acá el ID de medición (ej. "G-ABC123XYZ").
    // Vacío = la medición queda desactivada y no se carga ningún script de Google.
    ga4Id: ""
  };

  /* ---------- Medición (GA4) ---------- */
  function track(name, params) {
    if (typeof window.gtag === "function") window.gtag("event", name, params || {});
  }
  if (CONFIG.ga4Id) {
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(CONFIG.ga4Id);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", CONFIG.ga4Id);
  }
  // Clics en WhatsApp, teléfono e Instagram (se registran en toda la web)
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href");
    var place = a.className.indexOf("wa-float") > -1 ? "boton_flotante" : (document.body.getAttribute("data-page") || "web");
    if (href.indexOf("wa.me/" + CONFIG.whatsapp) > -1) {
      track("click_whatsapp", { ubicacion: place, mensaje: decodeURIComponent((href.split("text=")[1] || "")).slice(0, 90) });
    } else if (href.indexOf("wa.me/") > -1) {
      track("click_whatsapp_aseguradora", { destino: href });
    } else if (href.indexOf("tel:") === 0) {
      track("click_telefono", { numero: href.slice(4), ubicacion: place });
    } else if (href.indexOf("instagram.com") > -1) {
      track("click_instagram", { ubicacion: place });
    }
  });

  // Mensajes sugeridos por tipo de seguro (se usan en botones y en el formulario)
  var PRODUCTS = {
    auto: "Seguro de Auto",
    moto: "Seguro de Moto",
    hogar: "Seguro de Hogar",
    vida: "Vida y Accidentes Personales",
    retiro: "Seguro de Retiro",
    comercio: "Integral de Comercio",
    otro: "Otro seguro"
  };

  document.documentElement.classList.add("js");

  function waUrl(message) {
    return "https://wa.me/" + CONFIG.whatsapp + "?text=" + encodeURIComponent(message || CONFIG.defaultMessage);
  }

  /* ---------- Año del footer ---------- */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  /* ---------- Encabezado y menú ---------- */
  var header = document.querySelector(".site-header");
  var toggle = document.querySelector(".nav-toggle");
  var menu = document.getElementById("nav-menu");

  function onScroll() {
    if (header) header.classList.toggle("is-scrolled", window.scrollY > 12);
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  function setMenu(open) {
    if (!toggle || !menu) return;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
    menu.classList.toggle("is-open", open);
    header.classList.toggle("is-open", open);
    document.body.classList.toggle("no-scroll", open);
  }

  if (toggle && menu) {
    toggle.addEventListener("click", function () {
      setMenu(toggle.getAttribute("aria-expanded") !== "true");
    });
    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) setMenu(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        setMenu(false);
        toggle.focus();
      }
    });
    document.addEventListener("click", function (e) {
      if (toggle.getAttribute("aria-expanded") === "true" && !header.contains(e.target)) setMenu(false);
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 960) setMenu(false);
    });
  }

  /* ---------- WhatsApp: enlaces con mensaje personalizado ----------
     Los enlaces ya traen su href completo en el HTML (funcionan sin JS).
     Con data-wa-msg se puede redefinir el texto desde un solo lugar. */
  document.querySelectorAll("a[data-wa-msg]").forEach(function (a) {
    a.href = waUrl(a.getAttribute("data-wa-msg"));
  });

  /* ---------- Preselección de producto en el formulario ----------
     Enlaces con data-quote="auto" llevan a #cotizar con el seguro elegido. */
  var quoteForm = document.getElementById("quote-form");
  function preselect(key) {
    if (!quoteForm || !key || !PRODUCTS[key]) return;
    var select = quoteForm.querySelector("[name='seguro']");
    if (select) select.value = key;
  }
  document.querySelectorAll("[data-quote]").forEach(function (a) {
    a.addEventListener("click", function () {
      preselect(a.getAttribute("data-quote"));
    });
  });
  var params = new URLSearchParams(window.location.search);
  preselect(params.get("seguro"));

  /* ---------- Validación simple y accesible ---------- */
  function validate(form) {
    var ok = true;
    var first = null;
    form.querySelectorAll("[required], [type='email'], [type='tel']").forEach(function (input) {
      var field = input.closest(".field");
      var error = field ? field.querySelector(".field-error") : null;
      var msg = "";
      var value = input.value.trim();
      if (input.hasAttribute("required") && !value) {
        msg = "Este dato es necesario.";
      } else if (value && input.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
        msg = "Revisá el correo electrónico.";
      } else if (value && input.type === "tel" && value.replace(/\D/g, "").length < 8) {
        msg = "Ingresá un teléfono con código de área.";
      }
      if (field) field.classList.toggle("has-error", !!msg);
      if (error) error.textContent = msg;
      input.setAttribute("aria-invalid", msg ? "true" : "false");
      if (msg) {
        ok = false;
        if (!first) first = input;
      }
    });
    if (first) first.focus();
    return ok;
  }

  function status(form, type, html) {
    var box = form.querySelector(".form-status");
    if (!box) return;
    box.className = "form-status is-visible " + (type === "ok" ? "is-success" : "is-error");
    box.innerHTML = html;
  }

  /* ---------- Formulario de cotización → WhatsApp / correo ---------- */
  if (quoteForm) {
    var buildMessage = function () {
      var data = new FormData(quoteForm);
      var key = data.get("seguro");
      var lines = [
        "Hola Juan Manuel, quiero solicitar una cotización.",
        "",
        "• Seguro: " + (PRODUCTS[key] || key || "-"),
        "• Nombre: " + (data.get("nombre") || "").toString().trim(),
        "• Teléfono: " + (data.get("telefono") || "").toString().trim()
      ];
      var email = (data.get("email") || "").toString().trim();
      var consulta = (data.get("consulta") || "").toString().trim();
      if (email) lines.push("• Email: " + email);
      if (consulta) lines.push("• Consulta: " + consulta);
      return lines.join("\n");
    };

    quoteForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!validate(quoteForm)) return;
      var via = (e.submitter && e.submitter.value) || "whatsapp";
      var message = buildMessage();
      track("generate_lead", { formulario: "cotizacion", tipo_seguro: quoteForm.seguro.value, via: via });
      if (via === "email") {
        window.location.href =
          "mailto:" + CONFIG.email +
          "?subject=" + encodeURIComponent("Solicitud de cotización - " + (PRODUCTS[quoteForm.seguro.value] || "Seguro")) +
          "&body=" + encodeURIComponent(message);
        status(quoteForm, "ok", "Abrimos tu aplicación de correo con la consulta lista. Solo falta que la envíes desde ahí.");
      } else {
        var win = window.open(waUrl(message), "_blank", "noopener");
        if (!win) window.location.href = waUrl(message);
        status(quoteForm, "ok", "Abrimos WhatsApp con tu consulta lista. Solo falta tocar <strong>Enviar</strong> en el chat.");
      }
    });
  }

  /* ---------- Formulario de contacto → Formspree ---------- */
  var contactForm = document.getElementById("contact-form");
  if (contactForm) {
    contactForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!validate(contactForm)) return;
      var btn = contactForm.querySelector("[type='submit']");
      var label = btn ? btn.innerHTML : "";
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Enviando…";
      }
      fetch(contactForm.action, {
        method: "POST",
        body: new FormData(contactForm),
        headers: { Accept: "application/json" }
      })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          track("generate_lead", { formulario: "contacto", motivo: contactForm.motivo ? contactForm.motivo.value : "" });
          contactForm.reset();
          status(contactForm, "ok", "¡Gracias! Recibimos tu mensaje y te vamos a responder a la brevedad.");
        })
        .catch(function () {
          status(
            contactForm,
            "error",
            'No pudimos enviar el mensaje en este momento. Escribinos por <a href="' +
              waUrl(CONFIG.defaultMessage) +
              '" target="_blank" rel="noopener">WhatsApp</a> o a <a href="mailto:' +
              CONFIG.email + '">' + CONFIG.email + "</a>."
          );
        })
        .then(function () {
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = label;
          }
        });
    });
  }

  /* ---------- Chips de productos: resalta la sección visible ---------- */
  var chips = document.querySelectorAll(".chip[href^='#']");
  if (chips.length && "IntersectionObserver" in window) {
    var byId = {};
    chips.forEach(function (c) {
      byId[c.getAttribute("href").slice(1)] = c;
    });
    var spy = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && byId[entry.target.id]) {
            chips.forEach(function (c) { c.classList.remove("is-active"); });
            byId[entry.target.id].classList.add("is-active");
          }
        });
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );
    Object.keys(byId).forEach(function (id) {
      var section = document.getElementById(id);
      if (section) spy.observe(section);
    });
  }

  /* ---------- Animaciones de aparición ---------- */
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("is-visible"); });
  }
})();
