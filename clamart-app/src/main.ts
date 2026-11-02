import * as THREE from 'three';
import './style.css';
import { loadMapData } from './mapData.ts';
import { buildCity } from './cityBuilder.ts';
import { IsoCameraRig } from './cameraRig.ts';
import { buildBadges, pickBadge, setBadgesVisible } from './badges.ts';
import { showBottomSheet } from './bottomSheet.ts';
import { loadCategories, loadActiveMerchants, latLonToLocalMeters, type Merchant } from './merchants.ts';
import { buildMerchantPins, pickMerchantPin, setSelectedPin, applyCategoryFilter, type MerchantPin } from './merchantPins.ts';
import { showMerchantCard, hideMerchantCard, onMerchantCardClose, initMerchantCard } from './merchantCard.ts';
import { setupMapTopBar } from './mapTopBar.ts';
import { setupUnlockProgress } from './unlockProgress.ts';
import { setupFiltersSheet } from './filtersSheet.ts';
import { createAutoHide } from './autoHide.ts';
import { loadQuartiers } from './quartiersData.ts';
import { buildQuartiers, type QuartiersLayer } from './quartiers.ts';
import {
  createClusterLayer,
  type ClusterLayer,
  type MapCluster,
  CLUSTER_PIXEL_RADIUS,
  GAV_CLUSTER_PIXEL_RADIUS,
  PIN_WORLD_Y,
} from './clusterLayer.ts';
import { computeHalfSplitZoom, projectAll, clusterKey } from './clustering.ts';

// Seuil de "zoom fraction" (0 = dézoomé au max, 1 = zoomé au max, voir
// IsoCameraRig#getZoomFraction) sous lequel on bascule des badges/pins vers
// les zones de quartier colorées — "dézoomé à 30% de la ville" de la
// demande produit, traduit en fraction de la plage de zoom disponible.
const QUARTIER_MODE_ZOOM_THRESHOLD = 0.3;

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <canvas id="scene-canvas"></canvas>
  <div class="loading" id="loading">Chargement du quartier…</div>
  <div class="hud" id="hud" style="display:none">
    <button id="zoom-out" type="button" aria-label="Zoom arrière">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="10" cy="10" r="7"></circle>
        <line x1="15" y1="15" x2="21" y2="21"></line>
        <line x1="7" y1="10" x2="13" y2="10"></line>
      </svg>
    </button>
    <button id="zoom-in" type="button" aria-label="Zoom avant">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="10" cy="10" r="7"></circle>
        <line x1="15" y1="15" x2="21" y2="21"></line>
        <line x1="7" y1="10" x2="13" y2="10"></line>
        <line x1="10" y1="7" x2="10" y2="13"></line>
      </svg>
    </button>
  </div>
  <div class="quartiersDisclaimer" id="quartiers-disclaimer" hidden>Quartiers provisoires, non officiels</div>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#scene-canvas')!;
const loadingEl = document.querySelector<HTMLDivElement>('#loading')!;
const hudEl = document.querySelector<HTMLDivElement>('#hud')!;
const quartiersDisclaimerEl = document.querySelector<HTMLDivElement>('#quartiers-disclaimer')!;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfe3f2);

scene.add(new THREE.HemisphereLight(0xffffff, 0x9d8a6b, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(80, 140, 60);
scene.add(sun);

function viewportSize() {
  return { w: app.clientWidth, h: app.clientHeight };
}

const { w: initW, h: initH } = viewportSize();
let rig = new IsoCameraRig(initW / initH, 450);
renderer.setSize(initW, initH);

function resize() {
  const { w, h } = viewportSize();
  renderer.setSize(w, h);
  rig.setAspect(w / h);
}
window.addEventListener('resize', resize);

let badges: THREE.Sprite[] = [];
let merchantPins: MerchantPin[] = [];
let selectedMerchantId: string | null = null;
let autoHide: ReturnType<typeof createAutoHide> | null = null;
// Assignées une fois les données chargées (voir .then() ci-dessous) :
// animate() tourne déjà avant que badges/pins/quartiers n'existent, donc ce
// pont en portée externe évite de complexifier la boucle de rendu elle-même.
let zoomModeTick: (() => void) | null = null;
let recomputeClusters: ((spiderfyKey?: string | null) => void) | null = null;
let pickCluster: ((clientX: number, clientY: number, w: number, h: number) => MapCluster | null) | null = null;
let handleClusterClick: ((cluster: MapCluster) => void) | null = null;

function animate() {
  requestAnimationFrame(animate);
  zoomModeTick?.();
  renderer.render(scene, rig.camera);
}
animate();

onMerchantCardClose(() => {
  selectedMerchantId = null;
  setSelectedPin(merchantPins, null);
});

loadMapData()
  .then(async (data) => {
    buildCity(data, scene);
    badges = buildBadges(data.landmarks, scene);
    const worldHalf = Math.max(data.halfSizeM.x, data.halfSizeM.y);
    rig = new IsoCameraRig(viewportSize().w / viewportSize().h, worldHalf);
    loadingEl.style.display = 'none';
    hudEl.style.display = 'flex';

    // Les commerçants viennent de Supabase (base vivante), pas du JSON
    // précalculé OSM : chargés à part, après que la carte de base soit
    // déjà affichée, pour ne pas retarder le premier rendu si Supabase est
    // lent/indisponible.
    const [categories, merchants, quartiers] = await Promise.all([
      loadCategories(),
      loadActiveMerchants(),
      loadQuartiers(),
    ]);
    merchantPins = buildMerchantPins(merchants, data.center, scene);
    initMerchantCard(categories);
    const quartiersLayer: QuartiersLayer = buildQuartiers(quartiers, data.center, scene);
    const clusterLayer: ClusterLayer = createClusterLayer(scene);

    function doRecomputeClusters(spiderfyKey: string | null = null) {
      const { w, h } = viewportSize();
      clusterLayer.recompute(merchantPins, rig, w, h, spiderfyKey);
    }
    recomputeClusters = doRecomputeClusters;
    pickCluster = (x, y, w, h) => clusterLayer.pick(rig.camera, x, y, w, h);
    handleClusterClick = (cluster) => {
      const { w, h } = viewportSize();
      const screenPositions = projectAll(cluster.members, rig, PIN_WORLD_Y, w, h);
      const radius = cluster.isGav ? GAV_CLUSTER_PIXEL_RADIUS : CLUSTER_PIXEL_RADIUS;
      const result = computeHalfSplitZoom(cluster, screenPositions, rig, radius);
      if (result.kind === 'zoom') {
        rig.flyTo(result.worldX, -result.worldZ, result.zoom, 700, () => doRecomputeClusters());
      } else {
        // Coordonnées confondues : zoomer ne séparera jamais ces membres,
        // on vole dessus (au moins au zoom "rapproché") puis on les
        // affiche en éventail plutôt qu'en bulle (voir clusterLayer.ts).
        const key = clusterKey(cluster.members.map((m) => m.id));
        rig.flyTo(cluster.worldX, -cluster.worldZ, Math.max(rig.currentZoom, rig.closeZoom), 700, () =>
          doRecomputeClusters(key)
        );
      }
    };

    // Centralise "sélectionner un commerçant" (surbrillance du pin + vol de
    // la caméra + ouverture de la fiche) : utilisé aussi bien par le clic
    // direct sur un pin que par une suggestion de recherche, une ligne de la
    // bottom sheet de filtres, ou le paramètre `?merchant=` d'un lien direct.
    function selectMerchant(merchant: Merchant) {
      if (merchant.lat == null || merchant.lon == null) return;
      selectedMerchantId = merchant.id;
      setSelectedPin(merchantPins, merchant.id);
      const [x, y] = latLonToLocalMeters(merchant.lat, merchant.lon, data.center);
      rig.flyTo(x, -y, rig.closeZoom, 700, () => doRecomputeClusters());
      const { w, h } = viewportSize();
      showMerchantCard(merchant, { x: w / 2, y: h / 2 });
    }

    const topBar = setupMapTopBar({
      streets: data.streets,
      merchants,
      rig,
      scene,
      onOpenFilters: () => filtersSheet.open(),
      onSelectMerchant: selectMerchant,
      onCameraSettled: () => doRecomputeClusters(),
    });
    const progressEl = setupUnlockProgress(merchants);
    const filtersSheet = setupFiltersSheet({
      categories,
      merchants,
      merchantPins,
      rig,
      center: data.center,
      onSelectMerchant: selectMerchant,
      onFilterCountChange: (n) => {
        topBar.setFilterCount(n);
        doRecomputeClusters();
      },
      onResetSearch: () => topBar.clearSearch(),
      onCameraSettled: () => doRecomputeClusters(),
    });

    autoHide = createAutoHide([topBar.root, progressEl, filtersSheet.stickyBtn]);
    setupInteraction();

    // Très dézoomé (<= seuil) : zones de quartier colorées à la place des
    // badges/pins (qui deviendraient illisibles, trop petits/serrés à cette
    // échelle) ; au-delà, on repasse aux pins en respectant le filtre de
    // catégories actif (pas juste "tout réafficher").
    let inQuartierMode: boolean | null = null; // null = pas encore appliqué
    function applyQuartierMode() {
      const shouldShowQuartiers = rig.getZoomFraction() <= QUARTIER_MODE_ZOOM_THRESHOLD;
      if (shouldShowQuartiers === inQuartierMode) return;
      inQuartierMode = shouldShowQuartiers;
      quartiersLayer.setVisible(inQuartierMode);
      quartiersDisclaimerEl.hidden = !inQuartierMode;
      setBadgesVisible(badges, !inQuartierMode);
      applyCategoryFilter(merchantPins, inQuartierMode ? new Set<string>() : filtersSheet.getActiveCategories());
      doRecomputeClusters();
    }
    zoomModeTick = applyQuartierMode;
    applyQuartierMode();

    const params = new URLSearchParams(window.location.search);
    const preselectId = params.get('merchant');
    if (preselectId) {
      const merchant = merchants.find((m) => m.id === preselectId);
      if (merchant) selectMerchant(merchant);
    }
  })
  .catch((err) => {
    console.error(err);
    loadingEl.textContent = "Erreur de chargement des données de la carte.";
  });

// ===== Interaction : pan (glisser), zoom (molette / pincement) =====
function setupInteraction() {
  const pointers = new Map<number, { x: number; y: number }>();
  let lastPanPoint: { x: number; y: number } | null = null;
  let lastPinchDist: number | null = null;
  // Un tap doit ouvrir un badge, un glisser doit paner — on distingue les
  // deux par la distance parcourue entre pointerdown et pointerup (en
  // dessous du seuil = tap). Au-delà d'un 2e doigt posé (pincement), ce
  // n'est de toute façon plus un tap possible. Seuil volontairement généreux
  // (pas les ~6px habituels) : un doigt réel tremble plus qu'un clic souris
  // précis, et un seuil trop serré faisait passer certains taps sur un badge
  // pour un glissé (pas de bottom sheet ouverte, de façon intermittente —
  // signalé par l'utilisateur).
  let downPoint: { x: number; y: number } | null = null;
  let becameMultiTouch = false;
  const TAP_THRESHOLD_PX = 12;

  // Les clusters ne se recalculent qu'une fois le geste terminé (débounce),
  // jamais à chaque pointermove : recalculer en continu pendant un
  // pan/pincement ferait clignoter/sauter les bulles (règle produit :
  // "éviter les recalculs inutiles pendant les déplacements", "éviter les
  // changements brusques de position des clusters").
  let clusterRecomputeTimer: number | null = null;
  function scheduleClusterRecompute() {
    if (clusterRecomputeTimer != null) window.clearTimeout(clusterRecomputeTimer);
    clusterRecomputeTimer = window.setTimeout(() => recomputeClusters?.(), 180);
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      lastPanPoint = { x: e.clientX, y: e.clientY };
      downPoint = { x: e.clientX, y: e.clientY };
      becameMultiTouch = false;
    } else if (pointers.size === 2) {
      lastPinchDist = currentPinchDistance();
      becameMultiTouch = true;
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1 && lastPanPoint) {
      const dx = e.clientX - lastPanPoint.x;
      const dy = e.clientY - lastPanPoint.y;
      const { w, h } = viewportSize();
      rig.panByScreenDelta(dx, dy, w, h);
      lastPanPoint = { x: e.clientX, y: e.clientY };
      autoHide?.markMoving();
      scheduleClusterRecompute();
    } else if (pointers.size === 2 && lastPinchDist !== null) {
      const dist = currentPinchDistance();
      if (dist && dist > 0) {
        rig.zoomBy(dist / lastPinchDist);
        lastPinchDist = dist;
      }
      autoHide?.markMoving();
      scheduleClusterRecompute();
    }
  });

  function endPointer(e: PointerEvent) {
    if (
      !becameMultiTouch &&
      downPoint &&
      Math.hypot(e.clientX - downPoint.x, e.clientY - downPoint.y) < TAP_THRESHOLD_PX
    ) {
      const { w, h } = viewportSize();
      const merchantHit = pickMerchantPin(merchantPins, rig.camera, e.clientX, e.clientY, w, h);
      if (merchantHit) {
        selectedMerchantId = merchantHit.id;
        setSelectedPin(merchantPins, merchantHit.id);
        showMerchantCard(merchantHit, { x: e.clientX, y: e.clientY });
      } else {
        const clusterHit = pickCluster?.(e.clientX, e.clientY, w, h);
        if (clusterHit) {
          handleClusterClick?.(clusterHit);
        } else {
          const badgeHit = pickBadge(badges, rig.camera, e.clientX, e.clientY, w, h);
          if (badgeHit) {
            showBottomSheet(badgeHit.name, badgeHit.category);
          } else if (selectedMerchantId) {
            hideMerchantCard();
          }
        }
      }
    }
    downPoint = null;

    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      lastPanPoint = null;
      lastPinchDist = null;
      autoHide?.markIdle();
    } else if (pointers.size === 1) {
      const remaining = pointers.values().next().value;
      lastPanPoint = remaining ? { x: remaining.x, y: remaining.y } : null;
      lastPinchDist = null;
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', endPointer);

  function currentPinchDistance(): number | null {
    if (pointers.size < 2) return null;
    const [a, b] = Array.from(pointers.values());
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.001);
      rig.zoomBy(factor);
      autoHide?.markMoving();
      autoHide?.markIdle();
      scheduleClusterRecompute();
    },
    { passive: false }
  );

  document.querySelector('#zoom-in')!.addEventListener('click', () => {
    rig.zoomBy(1.25);
    scheduleClusterRecompute();
  });
  document.querySelector('#zoom-out')!.addEventListener('click', () => {
    rig.zoomBy(0.8);
    scheduleClusterRecompute();
  });
}
