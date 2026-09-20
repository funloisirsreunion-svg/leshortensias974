// Mesure d'audience Google Analytics 4, soumise au consentement (RGPD / CNIL).
// - Ne fait rien tant que GA_MEASUREMENT_ID n'est pas configuré côté Vercel
//   (aucun bandeau, aucune requête, aucune erreur).
// - Une fois configuré : un bandeau "Accepter / Refuser" s'affiche ; Google Analytics
//   n'est chargé (et aucun cookie n'est déposé) qu'après un accord explicite.
// - Le choix est mémorisé dans le navigateur ; il peut être modifié à tout moment
//   via mentions-legales.html#cookies.
// Expose window.trackEvent(name, params), sans effet tant que l'accord n'est pas donné.
(function () {
  var KEY = 'hortensias_cookie_consent';

  window.trackEvent = function (name, params) {
    if (window.gtag) window.gtag('event', name, params || {});
  };

  // Clic téléphone / WhatsApp : délégation globale, fonctionne sur toutes les pages.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (href.indexOf('tel:') === 0) {
      window.trackEvent('click_telephone', { link_url: href });
    } else if (href.indexOf('wa.me') !== -1 || href.indexOf('whatsapp') !== -1) {
      window.trackEvent('click_whatsapp', { link_url: href });
    }
  });

  function getChoice() {
    try { return window.localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function setChoice(value) {
    try { window.localStorage.setItem(KEY, value); } catch (e) { /* stockage indisponible */ }
  }

  function loadGA(id) {
    if (window.gtag) return;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', id, { anonymize_ip: true });
  }

  // Refus (ou retrait d'un accord) : supprime les cookies de mesure éventuellement présents.
  function clearGaCookies() {
    var host = window.location.hostname;
    var domains = ['', host, '.' + host, '.' + host.replace(/^www\./, '')];
    document.cookie.split(';').forEach(function (c) {
      var name = c.split('=')[0].trim();
      if (name.indexOf('_ga') !== 0) return;
      domains.forEach(function (d) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (d ? '; domain=' + d : '');
      });
    });
    window.gtag = undefined;
  }

  function removeBanner() {
    var el = document.getElementById('cookie-banner');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function showBanner(id) {
    if (document.getElementById('cookie-banner')) return;
    var box = document.createElement('div');
    box.id = 'cookie-banner';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Gestion des cookies');
    box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;max-width:640px;margin:0 auto;' +
      'background:#fff;color:#2b2b2b;border:2px solid #2d5a27;border-radius:12px;padding:16px 18px;' +
      'box-shadow:0 8px 30px rgba(0,0,0,.25);font:15px/1.5 Lato,Arial,sans-serif;';
    box.innerHTML =
      '<p style="margin:0 0 12px;">Nous utilisons Google Analytics pour mesurer l’audience du site, uniquement avec votre accord. ' +
      'Aucun cookie de mesure n’est déposé si vous refusez. ' +
      '<a href="mentions-legales.html#cookies" style="color:#2d5a27;">En savoir plus</a></p>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
      '<button type="button" id="cookie-refuse" style="flex:1;min-width:120px;padding:10px 16px;border-radius:8px;border:2px solid #2d5a27;background:#fff;color:#2d5a27;font-weight:700;cursor:pointer;font-size:15px;">Refuser</button>' +
      '<button type="button" id="cookie-accept" style="flex:1;min-width:120px;padding:10px 16px;border-radius:8px;border:2px solid #2d5a27;background:#2d5a27;color:#fff;font-weight:700;cursor:pointer;font-size:15px;">Accepter</button>' +
      '</div>';
    document.body.appendChild(box);
    document.getElementById('cookie-accept').addEventListener('click', function () {
      setChoice('granted'); removeBanner(); loadGA(id);
    });
    document.getElementById('cookie-refuse').addEventListener('click', function () {
      setChoice('denied'); removeBanner(); clearGaCookies();
    });
  }

  fetch('/api/public-config')
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      var id = cfg && cfg.gaMeasurementId;
      if (!id) return;
      var choice = getChoice();
      if (choice === 'granted') loadGA(id);
      if (choice === null || window.location.hash === '#cookies') showBanner(id);
    })
    .catch(function () { /* mesure d'audience non critique : jamais bloquante */ });
})();
