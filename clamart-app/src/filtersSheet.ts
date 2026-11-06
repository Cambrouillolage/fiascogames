import type { Category, Merchant } from './merchants.ts';
import { googleMapsDirectionsUrl, merchantSearchUrl, latLonToLocalMeters } from './merchants.ts';
import type { IsoCameraRig } from './cameraRig.ts';
import { badgesParId, BADGE_DEFAULT_ID } from './data/badgesClamart.ts';
import { applyCategoryFilter, type MerchantPin } from './merchantPins.ts';
import type { QuartierFeature } from './quartiersData.ts';
import { quartierIdForLatLon } from './quartiers.ts';
import { showMissingShopInfo } from './missingShopInfo.ts';
import { showGavResellerInfo } from './gavResellerInfo.ts';
import { showEventInfo } from './eventInfo.ts';

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
  quartiers: QuartierFeature[];
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
  /** Commerces respectant le quartier + la sous-catégorie actuellement sélectionnés (voir applyQuartierMode, main.ts), ou `null` si aucun des deux n'est restreint. */
  getExtraFilterMerchantIds(): Set<string> | null;
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
    quartiers,
    onSelectMerchant,
    onFilterCountChange,
    onResetSearch,
    onCameraSettled,
  } = deps;

  // Un commerce n'a pas de champ "quartier" en base (voir merchants.ts) :
  // son quartier est déterminé une seule fois ici par test géométrique
  // (point dans le polygone du quartier, voir quartiers.ts), pas recalculé
  // à chaque rendu — ni les commerces ni les polygones de quartier ne
  // changent après le chargement initial.
  const merchantQuartierId = new Map<string, string | null>(
    merchants.map((m) => [
      m.id,
      m.lat != null && m.lon != null ? quartierIdForLatLon(m.lat, m.lon, quartiers, center) : null,
    ])
  );
  const quartiersSorted = [...quartiers].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const quartierNameById = new Map(quartiers.map((q) => [q.id, q.name]));

  // Seulement les catégories qui ont au moins un commerce : la taxonomie en
  // base contient encore d'anciennes catégories orphelines (ex. "Éducation
  // & enfance" existait déjà avant l'import de la vraie taxonomie, qui a sa
  // propre catégorie du même nom) — sans ce filtre elles apparaîtraient
  // comme des chips vides/dupliquées pour l'utilisateur public.
  const categoryIdsInUse = new Set(merchants.map((m) => m.category_id));
  const mainCats = categories
    .filter((c) => !c.parent_id && categoryIdsInUse.has(c.id))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));

  // Sous-catégories ("familles", ex. Caviste/Boulangerie sous Alimentation),
  // regroupées par parent — même filtre "au moins un commerce" que les
  // catégories principales.
  const subcategoryIdsInUse = new Set(merchants.map((m) => m.subcategory_id).filter((id): id is string => !!id));
  const subCatsByParent = new Map<string, Category[]>();
  for (const c of categories) {
    if (!c.parent_id || !subcategoryIdsInUse.has(c.id)) continue;
    const list = subCatsByParent.get(c.parent_id) ?? [];
    list.push(c);
    subCatsByParent.set(c.parent_id, list);
  }
  for (const list of subCatsByParent.values()) list.sort((a, b) => a.label.localeCompare(b.label, 'fr'));

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
    <div class="filtersEventsBanner" id="filtersEventsBanner" hidden></div>
    <div class="filtersCounters">
      <button type="button" class="filtersGavTag" id="filtersGavTag">
        <span class="filtersGavTagMain"><span id="filtersGavCount"></span> revendeurs</span>
        <span class="filtersGavTagMore">Détails ›</span>
      </button>
      <button type="button" class="filtersMissingShopTag" id="filtersMissingShopTag">Boutique manquante ?</button>
      <select class="filtersQuartierSelect" id="filtersQuartierSelect" aria-label="Filtrer par quartier">
        <option value="">Quartier</option>
        ${quartiersSorted.map((q) => `<option value="${q.id}">${q.name}</option>`).join('')}
      </select>
    </div>
    <div class="filtersChipsSlider">
      <div class="filtersChips" id="filtersChips"></div>
    </div>
    <div class="filtersSubChipsSlider" id="filtersSubChipsSlider" hidden>
      <div class="filtersChips filtersSubChips" id="filtersSubChips"></div>
    </div>
    <div class="filtersResultsList" id="filtersResultsList"></div>
  `;
  document.body.appendChild(root);

  const chipsEl = root.querySelector<HTMLDivElement>('#filtersChips')!;
  const subChipsSliderEl = root.querySelector<HTMLDivElement>('#filtersSubChipsSlider')!;
  const subChipsEl = root.querySelector<HTMLDivElement>('#filtersSubChips')!;
  const listEl = root.querySelector<HTMLDivElement>('#filtersResultsList')!;
  const eventsBannerEl = root.querySelector<HTMLDivElement>('#filtersEventsBanner')!;
  const gavCountEl = root.querySelector<HTMLElement>('#filtersGavCount')!;
  root.querySelector<HTMLButtonElement>('#filtersMissingShopTag')!.addEventListener('click', showMissingShopInfo);
  root.querySelector<HTMLButtonElement>('#filtersGavTag')!.addEventListener('click', showGavResellerInfo);
  const quartierSelectEl = root.querySelector<HTMLSelectElement>('#filtersQuartierSelect')!;
  const categoryCountEl = root.querySelector<HTMLElement>('#filtersCategoryCount')!;
  const closeBtn = root.querySelector<HTMLButtonElement>('#filtersCloseBtn')!;
  const resetBtn = root.querySelector<HTMLButtonElement>('#filtersResetBtn')!;

  const stickyBtn = document.createElement('button');
  stickyBtn.type = 'button';
  stickyBtn.id = 'map-sticky-btn';
  document.body.appendChild(stickyBtn);

  let active: Set<string> | null = null;
  let activeSub: Set<string> | null = null;
  let activeQuartierId: string | null = null;
  let isOpen = false;

  function activeQuartierMerchantIds(): Set<string> | null {
    if (!activeQuartierId) return null;
    const ids = new Set<string>();
    for (const [id, qId] of merchantQuartierId) if (qId === activeQuartierId) ids.add(id);
    return ids;
  }

  // Combine quartier + sous-catégorie en un seul allowlist de commerces (voir
  // applyCategoryFilter dans merchantPins.ts, qui n'accepte qu'un seul filtre
  // additionnel "par id" en plus du filtre catégorie) : `null` = aucune
  // restriction sur ces deux filtres-là.
  function extraFilterMerchantIds(): Set<string> | null {
    const quartierIds = activeQuartierMerchantIds();
    const subIds = activeSub ? merchants.filter((m) => m.subcategory_id && activeSub!.has(m.subcategory_id)).map((m) => m.id) : null;
    if (!quartierIds && !subIds) return null;
    if (!quartierIds) return new Set(subIds);
    if (!subIds) return quartierIds;
    const subIdSet = new Set(subIds);
    const out = new Set<string>();
    for (const id of quartierIds) if (subIdSet.has(id)) out.add(id);
    return out;
  }

  function filteredMerchants(): Merchant[] {
    // Débloqués en priorité (règle produit : les commerces débloqués sont
    // affichés en premier dans la liste), tri stable donc l'ordre de la base
    // est conservé à l'intérieur de chaque groupe.
    return merchants
      .filter(
        (m) =>
          (!active || active.has(m.category_id)) &&
          (!activeSub || (m.subcategory_id != null && activeSub.has(m.subcategory_id))) &&
          (!activeQuartierId || merchantQuartierId.get(m.id) === activeQuartierId)
      )
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
    applyCategoryFilter(merchantPins, active, extraFilterMerchantIds());
  }

  // Sous-menu de familles (ex. Caviste/Boulangerie sous "Alimentation") :
  // seulement pertinent avec 1 ou 2 catégories actives à la fois — au-delà,
  // ce serait trop de familles mélangées pour rester lisible, et à 0 il n'y
  // a rien à détailler ("Toutes" catégories confondues).
  function renderSubChips() {
    const parents = active && active.size >= 1 && active.size <= 2 ? [...active] : [];
    const subs = parents.flatMap((p) => subCatsByParent.get(p) ?? []).sort((a, b) => a.label.localeCompare(b.label, 'fr'));

    // Les sous-catégories sélectionnées ne survivent que si leur catégorie
    // parente est toujours active ; sinon on repart de "Toutes" les familles.
    if (activeSub) {
      const stillValid = new Set([...activeSub].filter((id) => subs.some((s) => s.id === id)));
      activeSub = stillValid.size ? stillValid : null;
    }

    if (!subs.length) {
      subChipsSliderEl.hidden = true;
      subChipsEl.innerHTML = '';
      return;
    }
    subChipsSliderEl.hidden = false;
    subChipsEl.innerHTML =
      '<button type="button" class="catChip subChip isAll" data-all="true">Toutes les familles</button>' +
      subs
        .map(
          (c) =>
            `<button type="button" class="catChip subChip" data-id="${c.id}" style="--chip-color:${c.color}">${c.emoji} ${c.label}</button>`
        )
        .join('');
    updateSubChipStates();
  }

  function updateSubChipStates() {
    subChipsEl.querySelectorAll<HTMLButtonElement>('.subChip').forEach((el) => {
      if (el.dataset.all) el.classList.toggle('isActive', activeSub === null);
      else el.classList.toggle('isActive', activeSub !== null && activeSub.has(el.dataset.id!));
    });
    applyCategoryFilter(merchantPins, active, extraFilterMerchantIds());
  }

  function renderRow(m: Merchant): string {
    const badge = badgeFor(m);
    const badgeSrc = `${import.meta.env.BASE_URL}${badge.webp}`;
    const label = categoryLabel(categories, m.subcategory_id) || categoryLabel(categories, m.category_id);
    const quartierName = quartierNameById.get(merchantQuartierId.get(m.id) ?? '') ?? null;
    // La catégorie est affichée à côté du titre (demande explicite, vue
    // mobile) plutôt que répétée sur la ligne meta avec l'adresse/le quartier.
    const metaParts = [m.address, quartierName].filter(Boolean);
    const titleRow = `
          <span class="resultRowTitleRow">
            <span class="resultRowName">${m.name}</span>
            ${label ? `<span class="resultRowCategoryTag">${label}</span>` : ''}
          </span>`;
    // Site connu -> lien direct ("Voir le site") ; sinon on ne laisse jamais
    // ce CTA absent, on lance plutôt une recherche ("Voir sur internet").
    // Le nom n'est plus jamais masqué (migration 0015), donc ce CTA reste
    // pertinent même pour un commerce verrouillé.
    const webHref = m.website || merchantSearchUrl(m);
    const webLabel = m.website ? 'Voir le site' : 'Voir sur internet';

    // Plus aucune mention de verrouillage/déverrouillage ici (demande
    // explicite) : seuls les revendeurs GAV (non verrouillés) affichent une
    // information, avec un lien vers la page GAV pour en savoir plus.
    const url = googleMapsDirectionsUrl(m);
    if (m.is_locked) {
      return `
        <div class="resultRow resultRow--locked" data-id="${m.id}">
          <img class="resultRowBadge" src="${badgeSrc}" alt="" />
          <span class="resultRowBody">${titleRow}
            <span class="resultRowMeta">${metaParts.join(' · ')}</span>
            <span class="resultRowCtas">
              <a class="resultRowCta" href="${webHref}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${webLabel}</a>
              ${url ? `<a class="resultRowCta resultRowCta--primary" href="${url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Voir l'itinéraire</a>` : ''}
            </span>
          </span>
        </div>`;
    }

    return `
      <div class="resultRow resultRow--unlocked" data-id="${m.id}">
        <img class="resultRowBadge" src="${badgeSrc}" alt="" />
        <span class="resultRowBody">${titleRow}
          <span class="resultRowMeta">${metaParts.join(' · ')}</span>
          <button type="button" class="resultRowStatus resultRowStatus--unlocked resultRowGavInfoBtn" onclick="event.stopPropagation()">
            <span class="resultRowStatusMain">✅ Revendeur GAV</span>
            <span class="resultRowStatusMore">En savoir plus ›</span>
          </button>
          <span class="resultRowCtas">
            <a class="resultRowCta" href="${webHref}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${webLabel}</a>
            ${url ? `<a class="resultRowCta resultRowCta--primary" href="${url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Voir l'itinéraire</a>` : ''}
          </span>
        </span>
      </div>`;
  }

  // Encart "prochains événements" : statique pour la session (les
  // commerçants ne changent pas après le chargement initial, voir plus haut
  // pour le même raisonnement sur merchantQuartierId) — calculé une seule
  // fois à l'ouverture plutôt qu'à chaque render(), indépendant des filtres
  // catégorie/quartier actifs (une annonce d'événement reste visible même
  // si l'utilisateur a filtré sur une autre catégorie).
  function renderEventsBanner() {
    const todayIso = new Date().toISOString().slice(0, 10);
    const upcoming = merchants
      .filter((m) => m.gav_event_date && m.gav_event_date >= todayIso)
      .sort((a, b) => a.gav_event_date!.localeCompare(b.gav_event_date!));

    if (!upcoming.length) {
      eventsBannerEl.hidden = true;
      eventsBannerEl.innerHTML = '';
      return;
    }

    const formatDate = (iso: string) => {
      const d = new Date(`${iso}T00:00:00`);
      return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    };

    eventsBannerEl.hidden = false;
    eventsBannerEl.innerHTML = upcoming
      .map(
        (m) => `
          <button type="button" class="filtersEventRow" data-id="${m.id}">
            <span class="filtersEventIcon">📅</span>
            <span class="filtersEventText">
              <span class="filtersEventDate">${formatDate(m.gav_event_date!)}</span>
              <span class="filtersEventName">Événement GAV chez ${m.name}</span>
            </span>
            <span class="filtersEventMore">En savoir plus ›</span>
          </button>
        `
      )
      .join('');

    eventsBannerEl.querySelectorAll<HTMLButtonElement>('.filtersEventRow').forEach((rowEl) => {
      rowEl.addEventListener('click', () => {
        const merchant = merchants.find((m) => m.id === rowEl.dataset.id);
        if (merchant) {
          showEventInfo(merchant, (m) => {
            onSelectMerchant(m);
            close();
          });
        }
      });
    });
  }

  function render() {
    const filtered = filteredMerchants();
    const unlockedCount = filtered.filter((m) => !m.is_locked).length;
    gavCountEl.textContent = String(unlockedCount);

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
    listEl.querySelectorAll<HTMLButtonElement>('.resultRowGavInfoBtn').forEach((btn) => {
      btn.addEventListener('click', showGavResellerInfo);
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
    renderSubChips();
    updateChipStates();
    render();
  });

  subChipsEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.subChip');
    if (!btn) return;
    if (btn.dataset.all) {
      activeSub = null;
    } else {
      const id = btn.dataset.id!;
      const next = new Set(activeSub ?? []);
      if (activeSub === null) {
        next.clear();
        next.add(id);
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      activeSub = next.size ? next : null;
    }
    updateSubChipStates();
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

  quartierSelectEl.addEventListener('change', () => {
    activeQuartierId = quartierSelectEl.value || null;
    updateChipStates();
    render();
  });

  backdrop.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  resetBtn.addEventListener('click', () => {
    active = null;
    activeSub = null;
    activeQuartierId = null;
    quartierSelectEl.value = '';
    onResetSearch();
    renderSubChips();
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
  renderSubChips();
  renderEventsBanner();
  render();

  return {
    root,
    stickyBtn,
    open,
    getActiveCategories: () => active,
    getExtraFilterMerchantIds: extraFilterMerchantIds,
  };
}
