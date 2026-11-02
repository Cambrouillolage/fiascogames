// Modale "Comment débloquer ce commerce ?" ouverte depuis la fiche d'un
// commerce verrouillé : explique le mécanisme (le commerce doit confirmer
// vendre/stocker GAV), renvoie vers /gav/ pour en savoir plus sur le jeu, et
// donne les liens pour contacter les auteurs. Même pattern "bottom sheet +
// fond cliquable pour fermer" que bottomSheet.ts/merchantCard.ts.

const AUTHORS_SOCIAL = {
  facebook: 'https://www.facebook.com/profile.php?id=61595698121296',
  instagram: 'https://www.instagram.com/gav_jeu/',
};

let sheetEl: HTMLDivElement;
let backdropEl: HTMLDivElement;

function ensureSheet() {
  if (sheetEl) return;
  backdropEl = document.createElement('div');
  backdropEl.id = 'unlock-info-backdrop';
  backdropEl.className = 'sheetBackdrop';
  backdropEl.addEventListener('click', hideUnlockInfo);
  document.body.appendChild(backdropEl);

  sheetEl = document.createElement('div');
  sheetEl.id = 'unlock-info-sheet';
  sheetEl.innerHTML = `
    <button type="button" class="unlockInfoClose" aria-label="Fermer">×</button>
    <div class="unlockInfoHandle"></div>
    <h2 class="unlockInfoTitle">Comment débloquer ce commerce ?</h2>
    <p class="unlockInfoText">
      Ce commerce est déverrouillé dès qu'il confirme vendre le jeu de
      société GAV. S'il a déjà la boîte en rayon, signalez-le-nous : il sera
      débloqué dès que son stock sera confirmé.
    </p>
    <div class="unlockInfoBox">
      <img class="unlockInfoBoxImg" src="/assets/box_GAV.png" alt="Boîte du jeu GAV" />
      <a class="unlockInfoBoxLink" href="/gav/" target="_blank" rel="noopener">En savoir plus sur GAV →</a>
    </div>
    <div class="unlockInfoSocial">
      <span class="unlockInfoSocialLabel">Contactez-nous sur Facebook ou Instagram</span>
      <div class="unlockInfoSocialLinks">
        <a class="unlockInfoSocialLink" data-social="facebook" href="#" target="_blank" rel="noopener" hidden>Facebook</a>
        <a class="unlockInfoSocialLink" data-social="instagram" href="#" target="_blank" rel="noopener" hidden>Instagram</a>
      </div>
    </div>
  `;
  document.body.appendChild(sheetEl);
  sheetEl.querySelector('.unlockInfoClose')!.addEventListener('click', hideUnlockInfo);

  const fbLink = sheetEl.querySelector<HTMLAnchorElement>('[data-social="facebook"]')!;
  if (AUTHORS_SOCIAL.facebook) {
    fbLink.href = AUTHORS_SOCIAL.facebook;
    fbLink.hidden = false;
  }
  const igLink = sheetEl.querySelector<HTMLAnchorElement>('[data-social="instagram"]')!;
  if (AUTHORS_SOCIAL.instagram) {
    igLink.href = AUTHORS_SOCIAL.instagram;
    igLink.hidden = false;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideUnlockInfo();
  });
}

export function showUnlockInfo() {
  ensureSheet();
  sheetEl.classList.add('isOpen');
  backdropEl.classList.add('isOpen');
}

export function hideUnlockInfo() {
  if (sheetEl) sheetEl.classList.remove('isOpen');
  if (backdropEl) backdropEl.classList.remove('isOpen');
}
