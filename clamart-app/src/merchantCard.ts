import type { Category, Merchant } from './merchants.ts';
import { googleMapsDirectionsUrl, merchantSearchUrl } from './merchants.ts';
import { badgesParId, BADGE_DEFAULT_ID } from './data/badgesClamart.ts';
import { showUnlockInfo } from './unlockInfo.ts';

// Catégories pour résoudre le libellé de "spécialité" (sous-catégorie, ou à
// défaut catégorie) — jamais masquée par la vue Supabase même verrouillé
// (seuls name/description/address/... le sont, voir migration 0010), donc
// toujours affichable. Reçues une fois via initMerchantCard plutôt que
// passées à chaque showMerchantCard, pour ne pas changer la signature de
// tous ses appelants (clic direct sur un pin, recherche, liste de filtres…).
let categoriesRef: Category[] = [];
export function initMerchantCard(categories: Category[]) {
  categoriesRef = categories;
}

function categoryLabel(id: string | null): string {
  if (!id) return '';
  const c = categoriesRef.find((cat) => cat.id === id);
  return c?.label ?? id;
}

// Fiche commerçant au clic sur un pin : bottom sheet sur mobile, encart
// flottant près du pointeur sur desktop (seuil identique à celui déjà
// utilisé par le reste du site pour distinguer mobile/desktop : 700px,
// voir IsoCameraRig / Emulation mobile flag dans les scripts de test).
const DESKTOP_BREAKPOINT = 700;

let cardEl: HTMLDivElement;
let backdropEl: HTMLDivElement;

function ensureCard() {
  if (cardEl) return;
  backdropEl = document.createElement('div');
  backdropEl.id = 'merchant-card-backdrop';
  backdropEl.className = 'sheetBackdrop';
  backdropEl.addEventListener('click', hideMerchantCard);
  document.body.appendChild(backdropEl);

  cardEl = document.createElement('div');
  cardEl.id = 'merchant-card';
  cardEl.innerHTML = `
    <button type="button" class="merchantCardClose" aria-label="Fermer">×</button>
    <div class="merchantCardHandle"></div>
    <img class="merchantCardPhoto" alt="" hidden />
    <div class="merchantCardHeader">
      <img class="merchantCardBadge" alt="" />
      <div class="merchantCardTitleWrap">
        <div class="merchantCardTitle"></div>
        <div class="merchantCardSpecialty"></div>
        <div class="merchantCardStatus"></div>
        <div class="merchantCardStock"></div>
        <div class="merchantCardDesc"></div>
      </div>
    </div>
    <div class="merchantCardAddress"></div>
    <div class="merchantCardActions">
      <a class="merchantCardWeb" target="_blank" rel="noopener"></a>
      <a class="merchantCardGo" target="_blank" rel="noopener">S'y rendre</a>
      <button type="button" class="merchantCardUnlockBtn">🔓 Déverrouiller ce commerce</button>
    </div>
  `;
  document.body.appendChild(cardEl);
  cardEl.querySelector('.merchantCardClose')!.addEventListener('click', hideMerchantCard);
  cardEl.querySelector('.merchantCardUnlockBtn')!.addEventListener('click', showUnlockInfo);
}

export function showMerchantCard(merchant: Merchant, screenPos: { x: number; y: number }) {
  ensureCard();
  const photoEl = cardEl.querySelector('.merchantCardPhoto') as HTMLImageElement;
  if (merchant.photo_url) {
    photoEl.src = merchant.photo_url;
    photoEl.hidden = false;
  } else {
    photoEl.hidden = true;
  }
  const badge = (merchant.badge_id && badgesParId[merchant.badge_id]) || badgesParId[BADGE_DEFAULT_ID];
  const badgeEl = cardEl.querySelector('.merchantCardBadge') as HTMLImageElement;
  badgeEl.src = `${import.meta.env.BASE_URL}${badge.png}`;
  badgeEl.alt = badge.nom;

  cardEl.querySelector('.merchantCardTitle')!.textContent = merchant.name;

  const specialtyEl = cardEl.querySelector('.merchantCardSpecialty') as HTMLElement;
  const specialty = categoryLabel(merchant.subcategory_id) || categoryLabel(merchant.category_id);
  specialtyEl.textContent = specialty;
  specialtyEl.hidden = !specialty;

  const statusEl = cardEl.querySelector('.merchantCardStatus') as HTMLElement;
  statusEl.textContent = merchant.is_locked ? '🔒 Commerce à débloquer' : '✅ Revendeur GAV';
  statusEl.classList.toggle('isLocked', merchant.is_locked);
  statusEl.classList.toggle('isUnlocked', !merchant.is_locked);

  const stockEl = cardEl.querySelector('.merchantCardStock') as HTMLElement;
  if (!merchant.is_locked && merchant.gav_stock_quantity != null) {
    stockEl.textContent = `📦 ${merchant.gav_stock_quantity} GAV en stock`;
    stockEl.hidden = false;
  } else {
    stockEl.hidden = true;
  }

  const unlockBtn = cardEl.querySelector('.merchantCardUnlockBtn') as HTMLButtonElement;
  unlockBtn.hidden = !merchant.is_locked;

  cardEl.querySelector('.merchantCardDesc')!.textContent = merchant.description ?? '';
  (cardEl.querySelector('.merchantCardDesc') as HTMLElement).hidden = !merchant.description;

  const addressParts = [merchant.address, [merchant.postal_code, merchant.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  cardEl.querySelector('.merchantCardAddress')!.textContent = addressParts;
  (cardEl.querySelector('.merchantCardAddress') as HTMLElement).hidden = !addressParts;

  const goLink = cardEl.querySelector('.merchantCardGo') as HTMLAnchorElement;
  const url = googleMapsDirectionsUrl(merchant);
  if (url) {
    goLink.href = url;
    goLink.hidden = false;
  } else {
    goLink.hidden = true;
  }

  // Le nom n'est plus jamais masqué (migration 0015), donc ce CTA reste
  // pertinent même verrouillé — seuls les CTA qui dépendent de champs
  // encore masqués pour un commerce verrouillé (site officiel réel,
  // adresse) ne s'affichent pas ici par eux-mêmes : `merchantSearchUrl`
  // retombe sur nom + ville quand l'adresse est masquée.
  const webLink = cardEl.querySelector('.merchantCardWeb') as HTMLAnchorElement;
  webLink.href = merchant.website || merchantSearchUrl(merchant);
  webLink.textContent = merchant.website ? 'Voir le site' : 'Voir sur internet';
  webLink.hidden = false;

  const isDesktop = window.innerWidth >= DESKTOP_BREAKPOINT;
  cardEl.classList.toggle('isDesktop', isDesktop);
  cardEl.classList.toggle('isMobile', !isDesktop);

  if (isDesktop) {
    const margin = 16;
    const cardWidth = 280;
    const cardHeightEstimate = 220;
    let left = screenPos.x + 20;
    let top = screenPos.y - cardHeightEstimate / 2;
    left = Math.min(Math.max(margin, left), window.innerWidth - cardWidth - margin);
    top = Math.min(Math.max(margin, top), window.innerHeight - cardHeightEstimate - margin);
    cardEl.style.left = `${left}px`;
    cardEl.style.top = `${top}px`;
  }

  cardEl.classList.add('isOpen');
  backdropEl.classList.add('isOpen');
}

export function hideMerchantCard() {
  if (cardEl) cardEl.classList.remove('isOpen');
  if (backdropEl) backdropEl.classList.remove('isOpen');
  onCloseCallback?.();
}

let onCloseCallback: (() => void) | null = null;
export function onMerchantCardClose(cb: () => void) {
  onCloseCallback = cb;
}
