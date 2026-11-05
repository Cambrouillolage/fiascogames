// Modale "Il manque une boutique ?" ouverte depuis la bottom sheet de
// filtres : contact (erreur sur la carte, commerce manquant, envie de
// vendre/trouver du GAV) par email ou réseaux sociaux. Coquille partagée
// avec les autres modales d'info, voir src/infoSheet.ts.
import { createInfoSheet } from './infoSheet.ts';
import { CONTACT_EMAIL, AUTHORS_SOCIAL } from './contactInfo.ts';

let sheet: ReturnType<typeof createInfoSheet> | null = null;

function ensureSheet() {
  if (sheet) return sheet;
  sheet = createInfoSheet('missing-shop-sheet');
  sheet.setContent(`
    <h2 class="infoSheetTitle">Il manque une boutique ?</h2>
    <p class="infoSheetText">
      Une erreur sur la carte, une boutique qui manque, envie d'avoir des
      GAV ? Contactez-nous.
    </p>
    <a class="infoSheetEmail" href="mailto:${CONTACT_EMAIL}">✉️ ${CONTACT_EMAIL}</a>
    <div class="infoSheetSocial">
      <span class="infoSheetSocialLabel">Ou contactez-nous sur Facebook / Instagram</span>
      <div class="infoSheetSocialLinks">
        <a class="infoSheetSocialLink" href="${AUTHORS_SOCIAL.facebook}" target="_blank" rel="noopener">Facebook</a>
        <a class="infoSheetSocialLink" href="${AUTHORS_SOCIAL.instagram}" target="_blank" rel="noopener">Instagram</a>
      </div>
    </div>
  `);
  return sheet;
}

export function showMissingShopInfo() {
  ensureSheet().show();
}

export function hideMissingShopInfo() {
  sheet?.hide();
}
