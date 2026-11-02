import type { Category, Merchant } from './merchants.ts';
import { googleMapsDirectionsUrl, latLonToLocalMeters } from './merchants.ts';
import type { IsoCameraRig } from './cameraRig.ts';
import { badgesParId, BADGE_DEFAULT_ID } from './data/badgesClamart.ts';
import { applyCategoryFilter, type MerchantPin } from './merchantPins.ts';
import { showUnlockInfo } from './unlockInfo.ts';

// Bottom sheet "Filtres" : catégories (tri alphabétique, multi-sélection),
// compteurs déverrouillé/verrouillé, liste de résultats, bouton sticky
// "Voir sur la carte (N)". Indépendante du texte de la barre de recherche du
// haut (mapTopBar.ts) — ses propres filtres sont uniquement les catégories ;
// "Réinitialiser" efface aussi la recherche du haut via onResetSearch, pour
// repartir d'un état propre des deux côtés.

export interface FiltersSheetDeps {
  categories: Category[];
  merchants: Merchant[];
  merchantPins: MerchantPin[];
  rig: IsoCameraRig;
  center: { lat: number; lon: number };
  onSelectMerchant: (merchant: Merchant) => void;
  onFilterCountChange: (n: number) => void;
  onResetSearch: () => void;
  /** Appelé une fois l'animation de la caméra terminée (voir rig.flyToBounds) — recalcule les clusters (main.ts), qui ne bougent pas seuls pendant un vol programmatique. */
  onCameraSettled: () => void;
}

export interface FiltersSheet {
  root: HTMLElement;
  stickyBtn: HTMLElement;
  open(): void;
  getActiveCategories(): Set<string> | null;
}

function categoryLabel(categories: Category[], id: string | null): string {
  if (!id) return '';
  const c = categories.find((cat) => cat.id === id);
  return c?.label ?? id;
}

function badgeFor(merchant: Merchant) {
  return (merchant.badge_id && badgesParId[merchant.badge_id]) || badgesParId[BADGE_DEFAULT_ID];
}

export function setupFiltersSheet(deps: FiltersSheetDeps): FiltersSheet {
  const {
    categories,
    merchants,
    merchantPins,
    rig,
    center,
    onSelectMerchant,
    onFilterCountChange,
    onResetSearch,
    onCameraSettled,
  } = deps;

  // Seulement les catégories qui ont au moins un commerce : la taxonomie en
  // base contient encore d'anciennes catégories orphelines (ex. "Éducation
  // & enfance" existait déjà avant l'import de la vraie taxonomie, qui a sa
  // propre catégorie du même nom) — sans ce filtre elles apparaîtraient
  // comme des chips vides/dupliquées pour l'utilisateur public.
  const categoryIdsInUse = new Set(merchants.map((m) => m.category_id));
  const mainCats = categories
    .filter((c) => !c.parent_id && categoryIdsInUse.has(c.id))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));

  const backdrop = document.createElement('div');
  backdrop.id = 'filters-sheet-backdrop';
  backdrop.className = 'sheetBackdrop';
  document.body.appendChild(backdrop);

  const root = document.createElement('div');
  root.id = 'filters-sheet';
  root.innerHTML = `
    <div class="filtersSheetHandle"></div>
    <div class="filtersSheetHeader">
      <h2>Filtres <span class="filtersCategoryCount" id="filtersCategoryCount"></span></h2>
      <div class="filtersSheetHeaderActions">
        <button type="button" id="filtersResetBtn" class="filtersResetBtn">Réinitialiser</button>
        <button type="button" id="filtersCloseBtn" class="filtersCloseBtn" aria-label="Fermer">×</button>
      </div>
    </div>
    <div class="filtersCounters">
      <span class="filtersCounter filtersCounter--unlocked" id="filtersCountUnlocked"></span>
      <span class="filtersCounter filtersCounter--locked" id="filtersCountLocked"></span>
    </div>
    <div class="filtersChipsSlider">
      <div class="filtersChips" id="filtersChips"></div>
    </div>
    <div class="filtersResultsList" id="filtersResultsList"></div>
  `;
  document.body.appendChild(root);

  const chipsEl = root.querySelector<HTMLDivElement>('#filtersChips')!;
  const listEl = root.querySelector<HTMLDivElement>('#filtersResultsList')!;
  const countUnlockedEl = root.querySelector<HTMLElement>('#filtersCountUnlocked')!;
  const countLockedEl = root.querySelector<HTMLElement>('#filtersCountLocked')!;
  const categoryCountEl = root.querySelector<HTMLElement>('#filtersCategoryCount')!;
  const closeBtn = root.querySelector<HTMLButtonElement>('#filtersCloseBtn')!;
  const resetBtn = root.querySelector<HTMLButtonElement>('#filtersResetBtn')!;

  const stickyBtn = document.createElement('button');
  stickyBtn.type = 'button';
  stickyBtn.id = 'map-sticky-btn';
  document.body.appendChild(stickyBtn);

  let active: Set<string> | null = null;
  let isOpen = false;

  function filteredMerchants(): Merchant[] {
    // Débloqués en priorité (règle produit : les commerces débloqués sont
    // affichés en premier dans la liste), tri stable donc l'ordre de la base
    // est conservé à l'intérieur de chaque groupe.
    return merchants
      .filter((m) => !active || active.has(m.category_id))
      .sort((a, b) => Number(a.is_locked) - Number(b.is_locked));
  }

  function renderChips() {
    chipsEl.innerHTML =
      '<button type="button" class="catChip isAll" data-all="true">Toutes</button>' +
      mainCats
        .map(
          (c) =>
            `<button type="button" class="catChip" data-id="${c.id}" style="--chip-color:${c.color}">${c.emoji} ${c.label}</button>`
        )
        .join('');
    updateChipStates();
  }

  function updateChipStates() {
    chipsEl.querySelectorAll<HTMLButtonElement>('.catChip').forEach((el) => {
      if (el.dataset.all) el.classList.toggle('isActive', active === null);
      else el.classList.toggle('isActive', active !== null && active.has(el.dataset.id!));
    });
    categoryCountEl.textContent = `(${active ? active.size : 0}/${mainCats.length})`;
    applyCategoryFilter(merchantPins, active);
  }

  function renderRow(m: Merchant): string {
    const badge = badgeFor(m);
    const badgeSrc = `${import.meta.env.BASE_URL}${badge.webp}`;
    const label = categoryLabel(categories, m.subcategory_id) || categoryLabel(categories, m.category_id);

    if (m.is_locked) {
      return `
        <div class="resultRow resultRow--locked" data-id="${m.id}">
          <span class="resultRowBadgeWrap">
            <img class="resultRowBadge isLockedBadge" src="${badgeSrc}" alt="" />
            <span class="resultRowLock">🔒</span>
          </span>
          <span class="resultRowBody">
            <span class="resultRowName">${m.name}</span>
            <span class="resultRowMeta">${label}</span>
            <span class="resultRowStatus resultRowStatus--locked">Commerce verrouillé</span>
            <button type="button" class="resultRowUnlockBtn" data-unlock-id="${m.id}">Déverrouiller ce commerce</button>
          </span>
        </div>`;
    }

    const url = googleMapsDirectionsUrl(m);
    return `
      <div class="resultRow resultRow--unlocked" data-id="${m.id}">
        <img class="resultRowBadge" src="${badgeSrc}" alt="" />
        <span class="resultRowBody">
          <span class="resultRowName">${m.name}</span>
          <span class="resultRowMeta">${label}${m.address ? ' · ' + m.address : ''}</span>
          ${m.gav_stock_quantity != null ? `<span class="resultRowStock">📦 ${m.gav_stock_quantity} GAV</span>` : ''}
          <span class="resultRowCtas">
            ${m.website ? `<a class="resultRowCta" href="${m.website}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Voir sur internet</a>` : ''}
            ${url ? `<a class="resultRowCta resultRowCta--primary" href="${url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Voir l'itinéraire</a>` : ''}
          </span>
        </span>
      </div>`;
  }

  function render() {
    const filtered = filteredMerchants();
    const unlockedCount = filtered.filter((m) => !m.is_locked).length;
    const lockedCount = filtered.length - unlockedCount;
    countUnlockedEl.textContent = `${unlockedCount} débloqué${unlockedCount > 1 ? 's' : ''}`;
    countLockedEl.textContent = `${lockedCount} verrouillé${lockedCount > 1 ? 's' : ''}`;

    listEl.innerHTML = filtered.length
      ? filtered.map(renderRow).join('')
      : '<div class="filtersResultsEmpty">Aucun commerce pour ces filtres.</div>';

    listEl.querySelectorAll<HTMLElement>('.resultRow').forEach((rowEl) => {
      rowEl.addEventListener('click', () => {
        const merchant = merchants.find((m) => m.id === rowEl.dataset.id);
        if (merchant) {
          onSelectMerchant(merchant);
          close();
        }
      });
    });
    listEl.querySelectorAll<HTMLButtonElement>('.resultRowUnlockBtn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        showUnlockInfo();
      });
    });

    if (filtered.length && isOpen) {
      stickyBtn.textContent = `Voir sur la carte (${filtered.length})`;
      stickyBtn.hidden = false;
    } else {
      stickyBtn.hidden = true;
    }

    const activeCount = active ? active.size : 0;
    onFilterCountChange(activeCount);
  }

  chipsEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.catChip');
    if (!btn) return;
    if (btn.dataset.all) {
      active = null;
    } else {
      const id = btn.dataset.id!;
      const next = new Set(active ?? []);
      if (active === null) {
        next.clear();
        next.add(id);
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      active = next.size ? next : null;
    }
    updateChipStates();
    render();
  });

  function open() {
    root.classList.add('isOpen');
    backdrop.classList.add('isOpen');
    isOpen = true;
    render();
  }
  function close() {
    root.classList.remove('isOpen');
    backdrop.classList.remove('isOpen');
    isOpen = false;
    stickyBtn.hidden = true;
  }

  backdrop.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  resetBtn.addEventListener('click', () => {
    active = null;
    onResetSearch();
    updateChipStates();
    render();
  });

  stickyBtn.addEventListener('click', () => {
    close();
    const points = filteredMerchants()
      .filter((m) => m.lat != null && m.lon != null)
      .map((m) => {
        const [x, y] = latLonToLocalMeters(m.lat!, m.lon!, center);
        return { x, z: -y };
      });
    rig.flyToBounds(points, 700, onCameraSettled);
  });

  renderChips();
  render();

  return { root, stickyBtn, open, getActiveCategories: () => active };
}
