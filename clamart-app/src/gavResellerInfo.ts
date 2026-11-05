// Modale "Revendeur GAV" ouverte depuis le badge/tag "Revendeur GAV · En
// savoir plus" (fiche commerce, ligne de la liste de filtres, encart
// d'en-tête) — explique le badge et invite les boutiques intéressées à
// nous contacter, plutôt que de renvoyer directement vers /gav/.
import { createInfoSheet } from './infoSheet.ts';
import { CONTACT_EMAIL, AUTHORS_SOCIAL } from './contactInfo.ts';

let sheet: ReturnType<typeof createInfoSheet> | null = null;

function ensureSheet() {
  if (sheet) return sheet;
  sheet = createInfoSheet('gav-reseller-sheet');
  sheet.setContent(`
    <h2 class="infoSheetTitle">Revendeur GAV</h2>
    <p class="infoSheetText">
      Ces commerçants nous soutiennent et revendent nos GAV ! Si tu veux
      que ta boutique préférée l'ait aussi, elle peut nous contacter.
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

export function showGavResellerInfo() {
  ensureSheet().show();
}

export function hideGavResellerInfo() {
  sheet?.hide();
}
