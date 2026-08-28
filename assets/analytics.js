// assets/analytics.js
//
// Fichier autonome (ne dépend pas de assets/consent.js) — inclus sur
// TOUTES les pages suivies, y compris /gav/ qui n'affiche pas le bandeau
// de cookies (voir assets/consent.js pour le pourquoi).
//
// - Définit dataLayer/gtag et pousse les valeurs par défaut de Google
//   Consent Mode v2 (tout refusé), AVANT de charger gtag.js.
// - Charge gtag.js et configure la propriété GA4. Tant qu'aucun
//   consentement n'est accordé (pages /gav/, ou visiteur qui n'a pas
//   encore répondu ailleurs), aucun cookie _ga n'est posé — seules des
//   requêtes anonymisées/agrégées sont envoyées (comportement standard de
//   Consent Mode v2 en mode "denied").
// - Suivi générique des clics : tout élément portant un attribut
//   data-ga-id="..." envoie un événement "cta_click" au clic (et, pour
//   un <details>, à l'ouverture). Ajouter du suivi à un nouveau bouton =
//   ajouter cet attribut dans le HTML, sans toucher à ce fichier.

window.dataLayer = window.dataLayer || [];
function gtag() {
  dataLayer.push(arguments);
}
window.gtag = gtag;

gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
  wait_for_update: 500,
});

(function () {
  var GA_MEASUREMENT_ID = 'G-K4ZG29HP07';

  var script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID;
  document.head.appendChild(script);

  gtag('js', new Date());
  gtag('config', GA_MEASUREMENT_ID);
})();

function trackCta(el) {
  gtag('event', 'cta_click', {
    cta_id: el.dataset.gaId,
    cta_label: el.dataset.gaLabel || el.textContent.trim().slice(0, 100),
    cta_page: location.pathname,
  });
}

document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-ga-id]');
  if (!el) return;
  trackCta(el);
});

// Le clic ne suffit pas pour un <details> (ouverture/fermeture native) :
// on écoute "toggle" en phase de capture, car cet événement ne remonte
// pas (bubble) dans le DOM.
document.addEventListener(
  'toggle',
  function (e) {
    var el = e.target;
    if (!el.matches || !el.matches('[data-ga-id]')) return;
    if (!el.open) return; // ne compte que l'ouverture, pas la fermeture
    trackCta(el);
  },
  true
);
