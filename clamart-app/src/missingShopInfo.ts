// Modale "Il manque une boutique ?" ouverte depuis la bottom sheet de
// filtres : un commerce absent de la carte peut être signalé par email ou
// réseaux sociaux. Même pattern "bottom sheet + fond cliquable pour
// fermer" que bottomSheet.ts/merchantCard.ts.

const CONTACT_EMAIL = 'contact@fiascogames.fr';
const AUTHORS_SOCIAL = {
  facebook: 'https://www.facebook.com/profile.php?id=61595698121296',
  instagram: 'https://www.instagram.com/gav_jeu/',
};

let sheetEl: HTMLDivElement;
let backdropEl: HTMLDivElement;

function ensureSheet() {
  if (sheetEl) return;
  backdropEl = document.createElement('div');
  backdropEl.id = 'missing-shop-backdrop';
  backdropEl.className = 'sheetBackdrop';
  backdropEl.addEventListener('click', hideMissingShopInfo);
  document.body.appendChild(backdropEl);

  sheetEl = document.createElement('div');
  sheetEl.id = 'missing-shop-sheet';
  sheetEl.innerHTML = `
    <button type="button" class="missingShopClose" aria-label="Fermer">×</button>
    <div class="missingShopHandle"></div>
    <h2 class="missingShopTitle">Il manque une boutique ?</h2>
    <p class="missingShopText">
      Si un commerce de Clamart n'apparaît pas sur la carte, dites-le-nous :
      on l'ajoutera dès que possible.
    </p>
    <a class="missingShopEmail" href="mailto:${CONTACT_EMAIL}">✉️ ${CONTACT_EMAIL}</a>
    <div class="missingShopSocial">
      <span class="missingShopSocialLabel">Ou contactez-nous sur Facebook / Instagram</span>
      <div class="missingShopSocialLinks">
        <a class="missingShopSocialLink" href="${AUTHORS_SOCIAL.facebook}" target="_blank" rel="noopener">Facebook</a>
        <a class="missingShopSocialLink" href="${AUTHORS_SOCIAL.instagram}" target="_blank" rel="noopener">Instagram</a>
      </div>
    </div>
  `;
  document.body.appendChild(sheetEl);
  sheetEl.querySelector('.missingShopClose')!.addEventListener('click', hideMissingShopInfo);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideMissingShopInfo();
  });
}

export function showMissingShopInfo() {
  ensureSheet();
  sheetEl.classList.add('isOpen');
  backdropEl.classList.add('isOpen');
}

export function hideMissingShopInfo() {
  if (sheetEl) sheetEl.classList.remove('isOpen');
  if (backdropEl) backdropEl.classList.remove('isOpen');
}
