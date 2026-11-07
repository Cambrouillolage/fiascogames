import * as THREE from 'three';
import './style.css';
import { loadMapData } from './mapData.ts';
import { buildCity } from './cityBuilder.ts';
import { IsoCameraRig } from './cameraRig.ts';
import { buildBadges, pickBadge, setBadgesVisible } from './badges.ts';
import { showBottomSheet } from './bottomSheet.ts';
import { loadCategories, loadActiveMerchants, latLonToLocalMeters, type Merchant } from './merchants.ts';
import { buildMerchantPins, pickMerchantPin, setSelectedPin, applyCategoryFilter, tickRingShimmer, type MerchantPin } from './merchantPins.ts';
import { showMerchantCard, hideMerchantCard, onMerchantCardClose, initMerchantCard } from './merchantCard.ts';
import { setupMapTopBar } from './mapTopBar.ts';
import { setupFiltersSheet } from './filtersSheet.ts';
import { createAutoHide } from './autoHide.ts';
import { loadQuartiers } from './quartiersData.ts';
import { buildQuartiers, pickQuartier, type QuartiersLayer } from './quartiers.ts';
import { createPinDeclutter, type PinDeclutter } from './pinDeclutter.ts';
import { createTraffic, type TrafficSystem } from './traffic.ts';
import { createPedestrians, type PedestrianSystem } from './pedestrians.ts';
import { createLodFader, type LodFader } from './lod.ts';
import { createTransit, type TransitSystem } from './transit.ts';
import { showMissingShopInfo } from './missingShopInfo.ts';

// Seuil de "zoom fraction" (0 = dézoomé au max, 1 = zoomé au max, voir
// IsoCameraRig#getZoomFraction) sous lequel on bascule des badges/pins vers
// les zones de quartier colorées — "dézoomé à 30% de la ville" de la
// demande produit, traduit en fraction de la plage de zoom disponible.
const QUARTIER_MODE_ZOOM_THRESHOLD = 0.3;
// À partir de 70% de la plage de zoom (même échelle que ci-dessus) :
// beaucoup plus de voitures/piétons actifs (demande explicite) — reste
// cadré en-dessous ("baseline"), voir trafficDensityForZoom plus bas.
const HIGH_DENSITY_ZOOM_THRESHOLD = 0.7;

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
  <div class="zoomHint" id="zoom-hint" hidden>
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <circle cx="10" cy="10" r="7"></circle>
      <line x1="15" y1="15" x2="21" y2="21"></line>
      <line x1="10" y1="7" x2="10" y2="13"></line>
      <line x1="7" y1="10" x2="13" y2="10"></line>
    </svg>
    <span>Déplacez la carte et zoomez pour découvrir les commerces autour de vous</span>
  </div>
  <div class="mapFooter">Cette carte est proposée par le jeu <a href="/gav/" target="_blank" rel="noopener">GAV</a> · <a href="/gav/" target="_blank" rel="noopener">En savoir plus</a></div>
  <button id="help-btn" type="button" class="helpBtn" aria-label="Signaler une erreur ou une boutique manquante">?</button>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#scene-canvas')!;
const loadingEl = document.querySelector<HTMLDivElement>('#loading')!;
const hudEl = document.querySelector<HTMLDivElement>('#hud')!;
const quartiersDisclaimerEl = document.querySelector<HTMLDivElement>('#quartiers-disclaimer')!;
const zoomHintEl = document.querySelector<HTMLDivElement>('#zoom-hint')!;

// Affiché une fois au chargement si l'utilisateur n'a pas encore interagi
// avec la carte, disparaît dès le premier pan/zoom réel (ou après 2s au
// plus tard, cf. l'animation CSS .zoomHint). Les 4 points d'entrée
// d'interaction (pointerdown canvas, molette, boutons zoom) appellent tous
// dismissZoomHint().
let zoomHintDismissed = false;
let zoomHintTimer: number | null = null;
function dismissZoomHint() {
  if (zoomHintDismissed) return;
  zoomHintDismissed = true;
  if (zoomHintTimer != null) window.clearTimeout(zoomHintTimer);
  zoomHintEl.hidden = true;
}

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

// Adaptation perf grossière (demande explicite) : un petit écran ou peu de
// coeurs CPU indique un appareil modeste -> moitié moins de voitures/piétons
// simulés. Juste une heuristique (pas de vrai profilage FPS), évaluée une
// fois au chargement comme reducedMotion ci-dessous.
const isLowPowerDevice = viewportSize().w < 768 || (navigator.hardwareConcurrency ?? 8) <= 4;

// Paliers de densité voitures/piétons selon le zoom (voir
// HIGH_DENSITY_ZOOM_THRESHOLD) : "baseline" tant qu'on n'est pas bien
// rapproché, "high" (beaucoup plus, demande explicite) au-delà. Le pool
// construit une fois par src/traffic.ts et src/pedestrians.ts doit couvrir
// le plus grand des deux (voir HIGH_* passés à createTraffic/createPedestrians).
// x4 (demande explicite, voir discussion sur le coût CPU par frame avant de
// pousser jusqu'à x10/x15) par rapport aux paliers d'origine (24/48 et
// 45/90 pour les voitures, 36/75 et 68/135 pour les piétons).
const BASELINE_VEHICLES = isLowPowerDevice ? 96 : 192;
const HIGH_VEHICLES = isLowPowerDevice ? 180 : 360;
const BASELINE_PEDESTRIANS = isLowPowerDevice ? 144 : 300;
const HIGH_PEDESTRIANS = isLowPowerDevice ? 272 : 540;

function trafficDensityForZoom(zoomFraction: number): { vehicles: number; pedestrians: number } {
  return zoomFraction >= HIGH_DENSITY_ZOOM_THRESHOLD
    ? { vehicles: HIGH_VEHICLES, pedestrians: HIGH_PEDESTRIANS }
    : { vehicles: BASELINE_VEHICLES, pedestrians: BASELINE_PEDESTRIANS };
}

const { w: initW, h: initH } = viewportSize();
let rig = new IsoCameraRig(initW / initH, 450);
renderer.setSize(initW, initH);
let lastSyncedW = initW;
let lastSyncedH = initH;

function resize() {
  const { w, h } = viewportSize();
  if (w === lastSyncedW && h === lastSyncedH) return;
  lastSyncedW = w;
  lastSyncedH = h;
  renderer.setSize(w, h);
  rig.setAspect(w / h);
}
window.addEventListener('resize', resize);
// Filet de sécurité en plus de l'évènement "resize" de la fenêtre : #app
// est en `height: 100dvh` (voir style.css), qui peut se stabiliser/changer
// après le premier rendu (barre d'adresse mobile, polices qui chargent...)
// sans déclencher "resize" sur certains navigateurs — sans ça, caméra et
// canvas resteraient désynchronisés indéfiniment (étirement visuel global,
// pas la cause du bug "badges ovales" signalé — voir badges.ts/
// merchantPins.ts pour celle-là — mais un vrai trou de robustesse distinct).
new ResizeObserver(resize).observe(app);
// renderer.setSize() fixe la taille CSS du canvas en px via un style inline
// (qui l'emporte sur `width:100%` en CSS, voir style.css) : tant qu'un
// resize()/ResizeObserver n'a pas eu l'occasion de tourner, le canvas peut
// rester bloqué sur une ancienne taille alors que `#app` (en 100dvh) a déjà
// changé — ex. barre d'outils mobile qui se rétracte pile au moment du tap.
// Dans ce court intervalle, le raycast (basé sur la taille actuelle lue à
// l'instant T) et le rendu réel (toujours à l'ancienne taille) sont
// désynchronisés : le tap sur un badge peut alors rater sa cible sans
// réaction visible ("rien ne se passe", signalé sur Android/Samsung).
// Appeler resize() en traitant chaque pointerdown élimine cette fenêtre de
// course : pas cher (no-op si la taille n'a pas changé), donc exécuté à
// chaque tap plutôt que de dépendre uniquement d'un évènement resize externe.
function syncViewportBeforeInteraction() {
  resize();
}

let badges: THREE.Sprite[] = [];
let merchantPins: MerchantPin[] = [];
let quartiersLayer: QuartiersLayer | null = null;
let selectedMerchantId: string | null = null;
let autoHide: ReturnType<typeof createAutoHide> | null = null;
// Assignées une fois les données chargées (voir .then() ci-dessous) :
// animate() tourne déjà avant que badges/pins/quartiers n'existent, donc ce
// pont en portée externe évite de complexifier la boucle de rendu elle-même.
let zoomModeTick: (() => void) | null = null;
let declutterPins: (() => void) | null = null;
let trafficSystem: TrafficSystem | null = null;
let pedestrianSystem: PedestrianSystem | null = null;
let trafficFader: LodFader | null = null;
let pedestrianFader: LodFader | null = null;
let transitSystem: TransitSystem | null = null;
let transitFader: LodFader | null = null;

// Glissement (inertie) après un pan tactile — "léger glissement" demandé,
// uniquement au doigt (pointerType === 'touch', voir setupInteraction),
// jamais à la souris : la molette/le clic-glisser desktop ont leur propre
// retour immédiat, l'inertie n'y est pas attendue. Décroissance rapide
// (friction élevée) pour rester "léger", pas un long effet de glisse.
let panInertiaVX = 0; // px/s
let panInertiaVY = 0;
let panInertiaActive = false;
const PAN_INERTIA_FRICTION_PER_SEC = 0.05; // fraction de la vitesse restante après 1s
const PAN_INERTIA_MIN_START_SPEED_PX_S = 300;
const PAN_INERTIA_MAX_START_SPEED_PX_S = 2200;
const PAN_INERTIA_MIN_STOP_SPEED_PX_S = 30;

// Respecté une fois pour toutes au chargement (comme gav/index.html pour la
// vidéo) : pas de ré-évaluation en continu, un changement de préférence en
// cours de session nécessiterait de toute façon un rechargement de la carte.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let pageVisible = !document.hidden;
document.addEventListener('visibilitychange', () => {
  pageVisible = !document.hidden;
});

const animationStartTime = performance.now();
let lastFrameTime = animationStartTime;
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const deltaSeconds = Math.min(0.1, (now - lastFrameTime) / 1000); // plafonné : évite un grand bond après un onglet mis en veille puis réactivé
  lastFrameTime = now;
  if (panInertiaActive) {
    const { w, h } = viewportSize();
    rig.panByScreenDelta(panInertiaVX * deltaSeconds, panInertiaVY * deltaSeconds, w, h);
    const decay = Math.pow(PAN_INERTIA_FRICTION_PER_SEC, deltaSeconds);
    panInertiaVX *= decay;
    panInertiaVY *= decay;
    if (Math.hypot(panInertiaVX, panInertiaVY) < PAN_INERTIA_MIN_STOP_SPEED_PX_S) {
      panInertiaActive = false;
      autoHide?.markIdle();
      // Même principe que le pan normal : recalculer les collisions de
      // badges seulement une fois le mouvement fini, pas à chaque frame du
      // glissement (voir scheduleDeclutter dans setupInteraction).
      declutterPins?.();
    }
  }
  zoomModeTick?.();
  // Même seuil que le mode quartier (zoomé à 30% de la plage dispo) : en
  // dessous, voitures/piétons n'apportent rien (illisibles à cette échelle,
  // comme les badges/pins) et coûtent une simulation + un rendu pour rien —
  // fondu court plutôt qu'une disparition brutale (voir src/lod.ts).
  const zoomFraction = rig.getZoomFraction();
  const trafficTarget: 0 | 1 = zoomFraction > QUARTIER_MODE_ZOOM_THRESHOLD ? 1 : 0;
  trafficFader?.tick(trafficTarget, deltaSeconds);
  pedestrianFader?.tick(trafficTarget, deltaSeconds);
  transitFader?.tick(trafficTarget, deltaSeconds);
  // Palier "beaucoup plus de monde" à partir de 70% de zoom (voir
  // trafficDensityForZoom) : setActiveCount gère lui-même la rampe
  // progressive, pas besoin de ne l'appeler qu'au changement de palier.
  const density = trafficDensityForZoom(zoomFraction);
  trafficSystem?.setActiveCount(density.vehicles);
  pedestrianSystem?.setActiveCount(density.pedestrians);
  if (!reducedMotion && pageVisible) {
    trafficSystem?.update(deltaSeconds);
    pedestrianSystem?.update(deltaSeconds, (now - animationStartTime) / 1000);
    transitSystem?.update(deltaSeconds);
    tickRingShimmer((now - animationStartTime) / 1000);
  }
  renderer.render(scene, rig.camera);
}
animate();

onMerchantCardClose(() => {
  selectedMerchantId = null;
  setSelectedPin(merchantPins, null);
  declutterPins?.();
});

loadMapData()
  .then(async (data) => {
    buildCity(data, scene);
    badges = buildBadges(data.landmarks, scene);
    const worldHalf = Math.max(data.halfSizeM.x, data.halfSizeM.y);
    // Resynchronise aussi le canvas du renderer ici, pas seulement la
    // caméra : entre le tout premier rendu (taille prise avant même le
    // fetch des données) et ce point, la taille réelle de la page a pu
    // changer (ex. 100dvh qui se stabilise, polices qui chargent) sans
    // qu'aucun évènement "resize" ne se déclenche — sans ce renderer.setSize,
    // la caméra se recalcule aux bonnes proportions mais le canvas garde
    // l'ancienne taille, désynchronisant les deux (étirement global, distinct
    // du bug "badges ovales" — voir badges.ts/merchantPins.ts).
    const { w: freshW, h: freshH } = viewportSize();
    renderer.setSize(freshW, freshH);
    rig = new IsoCameraRig(freshW / freshH, worldHalf);
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
    quartiersLayer = buildQuartiers(quartiers, data.center, scene);
    const pinDeclutter: PinDeclutter = createPinDeclutter(scene);

    // Voitures/piétons sur toute la ville (généralisé après validation sur
    // le quartier pilote "Centre") : `data.boundary` est le vrai contour
    // administratif de Clamart, déjà en mètres locaux (même repère que
    // `data.roads`) — voir src/traffic.ts et src/pedestrians.ts. Le pool
    // construit ici couvre le palier "high" (zoom rapproché) ; le palier
    // réellement actif est piloté dynamiquement (voir plus bas et animate()).
    trafficSystem = createTraffic(data.roads, data.boundary, scene, HIGH_VEHICLES);
    pedestrianSystem = createPedestrians(data.roads, data.boundary, scene, HIGH_PEDESTRIANS);
    // Position initiale posée une fois immédiatement (delta=0), y compris
    // sous `prefers-reduced-motion` : sinon chaque instance reste à
    // l'origine (0,0,0) tant que animate() ne les a jamais mises à jour —
    // "restent visibles mais immobiles" suppose qu'elles soient déjà à
    // leur place, pas regroupées au centre de la carte (bug détecté en
    // testant l'émulation `prefers-reduced-motion` via CDP).
    trafficSystem.update(0);
    pedestrianSystem.update(0, 0);
    const initialDensity = trafficDensityForZoom(rig.getZoomFraction());
    trafficSystem.setActiveCount(initialDensity.vehicles);
    pedestrianSystem.setActiveCount(initialDensity.pedestrians);
    const initialOpacity: 0 | 1 = rig.getZoomFraction() > QUARTIER_MODE_ZOOM_THRESHOLD ? 1 : 0;
    trafficFader = createLodFader(trafficSystem, initialOpacity);
    pedestrianFader = createLodFader(pedestrianSystem, initialOpacity);

    // Train + trams (nombre fixe, pas de palier "beaucoup plus" — voir
    // src/transit.ts) : même fondu zoom que voitures/piétons.
    transitSystem = createTransit(data.railways, data.tramways, data.boundary, scene);
    transitSystem.update(0);
    transitFader = createLodFader(transitSystem, initialOpacity);

    function doDeclutter() {
      const { w, h } = viewportSize();
      pinDeclutter.update(merchantPins, rig, w, h, selectedMerchantId);
    }
    declutterPins = doDeclutter;

    // Centralise "sélectionner un commerçant" (surbrillance du pin + vol de
    // la caméra + ouverture de la fiche) : utilisé aussi bien par le clic
    // direct sur un pin que par une suggestion de recherche, une ligne de la
    // bottom sheet de filtres, ou le paramètre `?merchant=` d'un lien direct.
    function selectMerchant(merchant: Merchant) {
      if (merchant.lat == null || merchant.lon == null) return;
      selectedMerchantId = merchant.id;
      setSelectedPin(merchantPins, merchant.id);
      const [x, y] = latLonToLocalMeters(merchant.lat, merchant.lon, data.center);
      rig.flyTo(x, -y, rig.closeZoom, 700, () => doDeclutter());
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
      onCameraSettled: () => doDeclutter(),
    });
    const filtersSheet = setupFiltersSheet({
      categories,
      merchants,
      merchantPins,
      rig,
      center: data.center,
      quartiers,
      onSelectMerchant: selectMerchant,
      onFilterCountChange: (n) => {
        topBar.setFilterCount(n);
        doDeclutter();
      },
      onResetSearch: () => topBar.clearSearch(),
      onCameraSettled: () => doDeclutter(),
    });

    autoHide = createAutoHide([topBar.root, filtersSheet.stickyBtn]);
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
      quartiersLayer!.setVisible(inQuartierMode);
      quartiersDisclaimerEl.hidden = !inQuartierMode;
      setBadgesVisible(badges, !inQuartierMode);
      applyCategoryFilter(
        merchantPins,
        inQuartierMode ? new Set<string>() : filtersSheet.getActiveCategories(),
        inQuartierMode ? null : filtersSheet.getExtraFilterMerchantIds()
      );
      doDeclutter();
    }
    zoomModeTick = applyQuartierMode;
    applyQuartierMode();

    const params = new URLSearchParams(window.location.search);
    const preselectId = params.get('merchant');
    const merchant = preselectId ? merchants.find((m) => m.id === preselectId) : undefined;
    if (merchant) {
      selectMerchant(merchant);
    } else if (inQuartierMode) {
      // Pas de lien direct vers un commerce : vue dézoomée de départ, donc
      // l'utilisateur n'a encore rien fait — on affiche l'indice.
      zoomHintEl.hidden = false;
      zoomHintTimer = window.setTimeout(dismissZoomHint, 2000);
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

  // Vitesse du pan en cours (moyenne mobile exponentielle, lissée pour ne
  // pas dépendre d'un seul pointermove bruité) — sert uniquement à amorcer
  // l'inertie au relâché (voir panInertia* au niveau module).
  let gestureVX = 0; // px/ms
  let gestureVY = 0;
  let lastMoveTime = 0;
  const VELOCITY_EMA_ALPHA = 0.35;

  // Le désamorçage de collisions (taille/décalage des badges, voir
  // pinDeclutter.ts) ne se recalcule qu'une fois le geste terminé
  // (débounce), jamais à chaque pointermove : recalculer en continu pendant
  // un pan/pincement ferait clignoter/sauter les badges (règle produit :
  // "éviter les recalculs inutiles pendant les déplacements", "éviter les
  // changements brusques de position").
  let declutterTimer: number | null = null;
  function scheduleDeclutter() {
    if (declutterTimer != null) window.clearTimeout(declutterTimer);
    declutterTimer = window.setTimeout(() => declutterPins?.(), 180);
  }

  canvas.addEventListener('pointerdown', (e) => {
    syncViewportBeforeInteraction();
    dismissZoomHint();
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      lastPanPoint = { x: e.clientX, y: e.clientY };
      downPoint = { x: e.clientX, y: e.clientY };
      becameMultiTouch = false;
      gestureVX = 0;
      gestureVY = 0;
      lastMoveTime = performance.now();
      panInertiaActive = false; // on reprend la carte en main : stoppe un glissement en cours
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
      if (e.pointerType === 'touch') {
        const now = performance.now();
        const dt = Math.max(1, now - lastMoveTime); // évite une division par ~0 si deux events arrivent à la même ms
        lastMoveTime = now;
        gestureVX = gestureVX * (1 - VELOCITY_EMA_ALPHA) + (dx / dt) * VELOCITY_EMA_ALPHA;
        gestureVY = gestureVY * (1 - VELOCITY_EMA_ALPHA) + (dy / dt) * VELOCITY_EMA_ALPHA;
      }
      autoHide?.markMoving();
      scheduleDeclutter();
    } else if (pointers.size === 2 && lastPinchDist !== null) {
      const dist = currentPinchDistance();
      if (dist && dist > 0) {
        rig.zoomBy(dist / lastPinchDist);
        lastPinchDist = dist;
      }
      autoHide?.markMoving();
      scheduleDeclutter();
    }
  });

  function endPointer(e: PointerEvent) {
    if (
      !becameMultiTouch &&
      downPoint &&
      Math.hypot(e.clientX - downPoint.x, e.clientY - downPoint.y) < TAP_THRESHOLD_PX
    ) {
      syncViewportBeforeInteraction();
      const { w, h } = viewportSize();
      // Mode "zones de quartier" (très dézoomé, voir applyQuartierMode) :
      // taper une zone/étiquette zoome directement dessus, pour les
      // utilisateurs qui ne pensent pas à zoomer eux-mêmes (voir zoomHint
      // plus haut). Les pins/badges sont de toute façon invisibles (donc non
      // raycastables) dans ce mode, inutile de tester l'ordre ici.
      const quartierHit = quartiersLayer
        ? pickQuartier(quartiersLayer.pickables, rig.camera, e.clientX, e.clientY, w, h)
        : null;
      if (quartierHit) {
        dismissZoomHint();
        const bounds = quartiersLayer!.boundsById.get(quartierHit.id);
        // Plancher de zoom légèrement au-dessus du seuil quartier : sinon
        // cadrer un grand quartier entier peut rester en-dessous et garder
        // les zones colorées au lieu des pins (tap perçu comme sans effet).
        if (bounds) {
          const zoomFloor = rig.zoomLevelForFraction(QUARTIER_MODE_ZOOM_THRESHOLD + 0.08);
          rig.flyToBounds(bounds, 700, () => declutterPins?.(), zoomFloor);
        }
      } else {
        const merchantHit = pickMerchantPin(merchantPins, rig.camera, e.clientX, e.clientY, w, h);
        if (merchantHit) {
          selectedMerchantId = merchantHit.id;
          setSelectedPin(merchantPins, merchantHit.id);
          declutterPins?.();
          showMerchantCard(merchantHit, { x: e.clientX, y: e.clientY });
        } else {
          const badgeHit = pickBadge(badges, rig.camera, e.clientX, e.clientY, w, h);
          if (badgeHit) {
            showBottomSheet(badgeHit.name, badgeHit.category, badgeHit.addr);
          } else if (selectedMerchantId) {
            hideMerchantCard();
          }
        }
      }
    }
    downPoint = null;

    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      // Glissement au relâché : uniquement un pan tactile pur (jamais sorti
      // d'un pincement, jamais à la souris) et assez rapide pour que ce soit
      // un vrai "flick" plutôt qu'un pan qui vient juste de s'arrêter.
      if (!becameMultiTouch && e.pointerType === 'touch') {
        const speedPxPerS = Math.hypot(gestureVX, gestureVY) * 1000;
        if (speedPxPerS >= PAN_INERTIA_MIN_START_SPEED_PX_S) {
          const clampedSpeed = Math.min(speedPxPerS, PAN_INERTIA_MAX_START_SPEED_PX_S);
          const scale = clampedSpeed / speedPxPerS;
          panInertiaVX = gestureVX * 1000 * scale;
          panInertiaVY = gestureVY * 1000 * scale;
          panInertiaActive = true;
        }
      }
      lastPanPoint = null;
      lastPinchDist = null;
      if (!panInertiaActive) autoHide?.markIdle(); // sinon l'inertie garde l'UI masquée jusqu'à son arrêt (voir animate())
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
      dismissZoomHint();
      const factor = Math.exp(-e.deltaY * 0.001);
      rig.zoomBy(factor);
      autoHide?.markMoving();
      autoHide?.markIdle();
      scheduleDeclutter();
    },
    { passive: false }
  );

  document.querySelector('#zoom-in')!.addEventListener('click', () => {
    dismissZoomHint();
    rig.zoomBy(1.25);
    scheduleDeclutter();
  });
  document.querySelector('#zoom-out')!.addEventListener('click', () => {
    dismissZoomHint();
    rig.zoomBy(0.8);
    scheduleDeclutter();
  });
  document.querySelector('#help-btn')!.addEventListener('click', showMissingShopInfo);
}
