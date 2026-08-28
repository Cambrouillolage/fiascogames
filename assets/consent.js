// assets/consent.js — bandeau de cookies (bannière de consentement).
//
// Chargé UNIQUEMENT sur les pages qui doivent afficher le bandeau (pas
// sur /gav/, à la demande de Florian — voir le README). Suppose que
// assets/analytics.js a déjà défini window.gtag/dataLayer et poussé le
// consentement par défaut : ce fichier doit donc être inclus APRÈS
// analytics.js, et après
// assets/vendor/cookieconsent/cookieconsent.umd.js (qui définit
// window.CookieConsent).
//
// Configure et lance le bandeau (vanilla-cookieconsent), et répercute le
// choix du visiteur vers gtag('consent', 'update', ...).

function pushConsentUpdate() {
  var analyticsGranted =
    window.CookieConsent && CookieConsent.acceptedCategory('analytics');
  gtag('consent', 'update', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: analyticsGranted ? 'granted' : 'denied',
  });
}

// IMPORTANT : ce fichier est chargé dans <head>, avant que <body> n'existe.
// CookieConsent.run() a besoin de document.body pour y insérer la bannière
// — l'appeler trop tôt échoue silencieusement (aucune bannière, aucune
// erreur visible). On attend donc DOMContentLoaded avant de l'appeler.
function initCookieConsent() {
  CookieConsent.run({
    categories: {
      necessary: { enabled: true, readOnly: true },
      analytics: {
        autoClear: {
          cookies: [{ name: /^_ga/ }],
        },
      },
    },
    guiOptions: {
      consentModal: {
        layout: 'box',
        position: 'bottom left',
        equalWeightButtons: true,
        flipButtons: false,
      },
      preferencesModal: {
        layout: 'box',
        equalWeightButtons: true,
        flipButtons: false,
      },
    },
    language: {
      default: 'fr',
      translations: {
        fr: {
          consentModal: {
            title: 'On utilise des cookies 🍪',
            description:
              "Ce site utilise des cookies de mesure d'audience (Google Analytics) pour comprendre comment il est utilisé. Vous pouvez accepter ou refuser librement, et changer d'avis à tout moment.",
            acceptAllBtn: 'Accepter',
            acceptNecessaryBtn: 'Refuser',
            showPreferencesBtn: 'Personnaliser',
            footer:
              '<a href="/politique-confidentialite.html#cookies">Politique de confidentialité</a>',
          },
          preferencesModal: {
            title: 'Préférences de cookies',
            acceptAllBtn: 'Tout accepter',
            acceptNecessaryBtn: 'Tout refuser',
            savePreferencesBtn: 'Enregistrer mes choix',
            closeIconLabel: 'Fermer',
            sections: [
              {
                title: 'Utilisation des cookies',
                description:
                  "Nous utilisons des cookies pour mesurer la fréquentation du site. Vous pouvez changer d'avis à tout moment depuis le lien « Gérer les cookies » en bas de page.",
              },
              {
                title: 'Cookies nécessaires',
                description:
                  "Aucun cookie strictement nécessaire n'est déposé à ce jour.",
                linkedCategory: 'necessary',
              },
              {
                title: "Mesure d'audience (Google Analytics)",
                description:
                  'Nous aide à comprendre quelles pages sont consultées et comment elles sont utilisées, de façon anonyme.',
                linkedCategory: 'analytics',
              },
            ],
          },
        },
      },
    },
    onFirstConsent: pushConsentUpdate,
    onConsent: pushConsentUpdate,
    onChange: pushConsentUpdate,
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCookieConsent);
} else {
  initCookieConsent();
}

// Permet à un lien "Gérer les cookies" en pied de page de rouvrir le
// panneau de préférences : <a href="#" class="js-manage-cookies">.
document.addEventListener('click', function (e) {
  var el = e.target.closest('.js-manage-cookies');
  if (!el) return;
  e.preventDefault();
  CookieConsent.showPreferences();
});
