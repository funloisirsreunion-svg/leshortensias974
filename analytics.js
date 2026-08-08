// Chargement conditionnel de Google Analytics 4 : ne fait rien tant que
// GA_MEASUREMENT_ID n'est pas configuré côté Vercel (aucune requête réseau,
// aucune erreur). Expose window.trackEvent(name, params) pour les événements
// de conversion, utilisable partout même si GA n'est pas encore actif.
(function () {
  window.trackEvent = function (name, params) {
    if (window.gtag) window.gtag('event', name, params || {});
  };

  // Clic téléphone / WhatsApp : délégation globale, fonctionne sur toutes les
  // pages sans modifier chaque lien individuellement.
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

  fetch('/api/public-config')
    .then((r) => r.json())
    .then((cfg) => {
      if (!cfg || !cfg.gaMeasurementId) return;
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(cfg.gaMeasurementId);
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
      window.gtag('config', cfg.gaMeasurementId, { anonymize_ip: true });
    })
    .catch(function () { /* GA non critique : jamais bloquant */ });
})();
