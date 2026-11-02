import * as THREE from 'three';
import type { MapStreet } from './mapData.ts';
import type { IsoCameraRig } from './cameraRig.ts';
import type { Merchant } from './merchants.ts';
import { badgesParId, BADGE_DEFAULT_ID } from './data/badgesClamart.ts';

// Barre unique en haut de la carte : recherche (rues + commerces, dropdown de
// suggestions mixte) + bouton filtre (ouvre la bottom sheet de filtrersSheet.ts).
// Remplace l'ancienne boîte de recherche de rue dédiée (streetSearch.ts) et
// l'ancienne rangée de chips de catégories toujours visible
// (categoryFilters.ts) : même technique de marqueur temporaire Sprite que
// l'ancien streetSearch.ts, reprise ici plutôt que partagée, pour rester
// cohérent avec le reste du projet (voir merchantPins.ts sur ce choix).

function removeDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function tempMarkerTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 10, 0, Math.PI * 2);
  ctx.fillStyle = '#e8374a';
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.font = `${size * 0.5}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('📍', size / 2, size / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

type Suggestion =
  | { kind: 'street'; street: MapStreet }
  | { kind: 'merchant'; merchant: Merchant };

export interface MapTopBarDeps {
  streets: MapStreet[];
  merchants: Merchant[];
  rig: IsoCameraRig;
  scene: THREE.Scene;
  onOpenFilters: () => void;
  onSelectMerchant: (merchant: Merchant) => void;
  /** Appelé une fois le vol vers une rue terminé — recalcule les clusters (main.ts). */
  onCameraSettled: () => void;
}

export interface MapTopBar {
  root: HTMLElement;
  setFilterCount(n: number): void;
  clearSearch(): void;
}

export function setupMapTopBar(deps: MapTopBarDeps): MapTopBar {
  const { streets, merchants, rig, scene, onOpenFilters, onSelectMerchant, onCameraSettled } = deps;

  const root = document.createElement('div');
  root.id = 'map-top-bar';
  root.innerHTML = `
    <div class="topBarRow">
      <div class="topSearchBox">
        <input type="text" id="topSearchInput" placeholder="Rechercher une rue ou un commerce" autocomplete="off" />
        <button type="button" id="topSearchClear" aria-label="Effacer la recherche" hidden>×</button>
      </div>
      <button type="button" id="topFilterBtn" aria-label="Filtres">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="4" y1="7" x2="20" y2="7"></line>
          <circle cx="9" cy="7" r="2.3" fill="currentColor" stroke="none"></circle>
          <line x1="4" y1="17" x2="20" y2="17"></line>
          <circle cx="15" cy="17" r="2.3" fill="currentColor" stroke="none"></circle>
        </svg>
        <span id="topFilterBadge" class="topFilterBadge" hidden></span>
      </button>
    </div>
    <div id="topSearchResults" hidden></div>
  `;
  document.body.appendChild(root);

  const input = root.querySelector<HTMLInputElement>('#topSearchInput')!;
  const clearBtn = root.querySelector<HTMLButtonElement>('#topSearchClear')!;
  const resultsEl = root.querySelector<HTMLDivElement>('#topSearchResults')!;
  const filterBtn = root.querySelector<HTMLButtonElement>('#topFilterBtn')!;
  const filterBadge = root.querySelector<HTMLSpanElement>('#topFilterBadge')!;

  let marker: THREE.Sprite | null = null;
  const markerTex = tempMarkerTexture();

  function clearMarker() {
    if (marker) {
      scene.remove(marker);
      marker = null;
    }
  }

  function badgeIconFor(merchant: Merchant) {
    const badge = (merchant.badge_id && badgesParId[merchant.badge_id]) || badgesParId[BADGE_DEFAULT_ID];
    return `${import.meta.env.BASE_URL}${badge.webp}`;
  }

  function selectStreet(street: MapStreet) {
    input.value = street.n;
    closeResults();
    clearBtn.hidden = false;
    clearMarker();
    marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTex, depthTest: false, depthWrite: false }));
    marker.scale.set(26, 26, 1);
    marker.position.set(street.center[0], 20, -street.center[1]);
    marker.renderOrder = 1001;
    scene.add(marker);
    rig.flyTo(street.center[0], -street.center[1], rig.closeZoom, 700, onCameraSettled);
  }

  function selectMerchantSuggestion(merchant: Merchant) {
    input.value = merchant.name;
    closeResults();
    clearBtn.hidden = false;
    clearMarker();
    onSelectMerchant(merchant);
  }

  function closeResults() {
    resultsEl.innerHTML = '';
    resultsEl.hidden = true;
  }

  input.addEventListener('input', () => {
    const raw = input.value.trim();
    clearBtn.hidden = raw.length === 0;
    if (!raw) {
      closeResults();
      return;
    }
    const q = removeDiacritics(raw.toLowerCase());

    const matchingStreets: Suggestion[] = streets
      .filter((s) => removeDiacritics(s.n.toLowerCase()).includes(q))
      .slice(0, 4)
      .map((street) => ({ kind: 'street', street }));

    const matchingMerchants: Suggestion[] = merchants
      .filter(
        (m) =>
          removeDiacritics(m.name.toLowerCase()).includes(q) ||
          (m.address && removeDiacritics(m.address.toLowerCase()).includes(q))
      )
      .slice(0, 6)
      .map((merchant) => ({ kind: 'merchant', merchant }));

    const suggestions = [...matchingMerchants, ...matchingStreets].slice(0, 8);

    if (!suggestions.length) {
      resultsEl.innerHTML = '<div class="topSearchEmpty">Aucun résultat</div>';
    } else {
      resultsEl.innerHTML = suggestions
        .map((s, i) => {
          if (s.kind === 'street') {
            return `<button type="button" class="topSearchItem topSearchItem--street" data-index="${i}">
              <span class="topSearchItemIcon">🛣️</span>
              <span class="topSearchItemLabel">${s.street.n}</span>
            </button>`;
          }
          return `<button type="button" class="topSearchItem topSearchItem--merchant" data-index="${i}">
            <img class="topSearchItemIcon topSearchItemBadge${s.merchant.is_locked ? ' isLockedBadge' : ''}" src="${badgeIconFor(s.merchant)}" alt="" />
            <span class="topSearchItemLabel">${s.merchant.name}</span>
          </button>`;
        })
        .join('');
      resultsEl.querySelectorAll<HTMLButtonElement>('.topSearchItem').forEach((btn, i) => {
        btn.addEventListener('click', () => {
          const s = suggestions[i];
          if (s.kind === 'street') selectStreet(s.street);
          else selectMerchantSuggestion(s.merchant);
        });
      });
    }
    resultsEl.hidden = false;
  });

  function clearSearch() {
    input.value = '';
    closeResults();
    clearBtn.hidden = true;
    if (marker) rig.flyTo(0, 0, 1, 700, onCameraSettled);
    clearMarker();
    input.blur();
  }
  clearBtn.addEventListener('click', clearSearch);

  filterBtn.addEventListener('click', onOpenFilters);

  return {
    root,
    setFilterCount(n: number) {
      if (n > 0) {
        filterBadge.textContent = String(n);
        filterBadge.hidden = false;
      } else {
        filterBadge.hidden = true;
      }
    },
    clearSearch,
  };
}
