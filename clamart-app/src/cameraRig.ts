import * as THREE from 'three';

// Caméra orthographique isométrique : pan (glisser) et zoom (molette /
// pincement à deux doigts) uniquement. Pas de rotation : orientation fixe,
// plus simple à contrôler sur mobile et ça garde le rendu "SimCity" lisible.
export class IsoCameraRig {
  readonly camera: THREE.OrthographicCamera;
  readonly target = new THREE.Vector3(0, 0, 0);

  private frustumSize: number;
  private aspect: number;
  private zoomLevel = 1;
  private readonly minZoom = 0.3;
  private readonly maxZoom: number;
  // Azimut choisi pour que le quartier Gare (le plus au nord de Clamart,
  // voir clamart-app/public/data/quartiers.json) ressorte vers le haut de
  // l'écran, comme sur ce GeoJSON affiché en nord-en-haut classique. Avec
  // l'ancienne valeur (1,1,1), le "haut d'écran" pointait vers l'azimut
  // nord-ouest (45°) ; ce vecteur a été recalculé pour viser précisément le
  // relèvement centre-ville → centroïde de Gare (≈34° est du nord), en
  // gardant la même inclinaison verticale (même rapport horizontal/vertical
  // que (1,1,1), donc même "hauteur" de vue isométrique qu'avant).
  private readonly isoDir = new THREE.Vector3(-0.4545044167999391, 0.5773502691896258, 0.6783011143850599);
  private readonly isoDistance: number;

  constructor(aspect: number, worldHalfSize: number) {
    this.aspect = aspect;
    // Le quartier fait ~2x worldHalfSize de large : on cadre large au
    // chargement et le zoom permet de se rapprocher ensuite.
    this.frustumSize = worldHalfSize * 2.2;
    this.isoDistance = worldHalfSize * 3;
    // Permet de zoomer jusqu'à voir ~15m de haut à l'écran (marge sous les
    // 20m visés) : calculé à partir de frustumSize plutôt qu'une constante,
    // pour rester correct si la taille de la commune couverte change.
    this.maxZoom = this.frustumSize / 15;

    this.camera = new THREE.OrthographicCamera(
      -this.frustumSize * this.aspect / 2,
      this.frustumSize * this.aspect / 2,
      this.frustumSize / 2,
      -this.frustumSize / 2,
      0.1,
      worldHalfSize * 10
    );
    this.update();
  }

  setAspect(aspect: number) {
    this.aspect = aspect;
    this.camera.left = (-this.frustumSize * this.aspect) / 2;
    this.camera.right = (this.frustumSize * this.aspect) / 2;
    this.camera.top = this.frustumSize / 2;
    this.camera.bottom = -this.frustumSize / 2;
    this.camera.updateProjectionMatrix();
  }

  private currentIsoOffset(): THREE.Vector3 {
    return this.isoDir.clone().multiplyScalar(this.isoDistance);
  }

  private update() {
    this.camera.position.copy(this.target).add(this.currentIsoOffset());
    this.camera.zoom = this.zoomLevel;
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }

  /** Vecteurs "droite" / "avant" projetés au sol, selon l'orientation actuelle. */
  private groundAxes(): { right: THREE.Vector3; forward: THREE.Vector3 } {
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up);
    right.y = 0;
    right.normalize();
    return { right, forward };
  }

  /** Déplace la cible au sol à partir d'un delta écran en pixels. */
  panByScreenDelta(dxPx: number, dyPx: number, viewportWidthPx: number, viewportHeightPx: number) {
    const worldPerPxX = (this.camera.right - this.camera.left) / viewportWidthPx / this.zoomLevel;
    const worldPerPxY = (this.camera.top - this.camera.bottom) / viewportHeightPx / this.zoomLevel;
    const { right, forward } = this.groundAxes();
    // Glisser vers la droite doit faire apparaître ce qui était à droite :
    // la scène se déplace dans le sens inverse du doigt/souris.
    this.target.addScaledVector(right, -dxPx * worldPerPxX);
    this.target.addScaledVector(forward, dyPx * worldPerPxY);
    this.update();
  }

  zoomBy(factor: number) {
    this.zoomLevel = THREE.MathUtils.clamp(this.zoomLevel * factor, this.minZoom, this.maxZoom);
    this.update();
  }

  /**
   * Zoom "rapproché" à utiliser pour centrer la caméra sur un résultat de
   * recherche précis (un commerce, une rue) : assez proche pour vraiment
   * voir le pin/bâtiment visé avec un peu de son pâté de maisons autour (pas
   * juste sa zone de quartier), mais pas le zoom maximum (~15m visés, voir
   * maxZoom ci-dessus) qui ferait disparaître tout contexte autour du pin.
   * Centralisé ici plutôt que des constantes éparpillées dans main.ts/
   * mapTopBar.ts, pour rester cohérent si maxZoom change.
   */
  get closeZoom(): number {
    return this.maxZoom * 0.1;
  }

  /**
   * Position du zoom actuel dans [minZoom, maxZoom], normalisée en [0, 1] —
   * sur une échelle logarithmique, pas linéaire : `zoomBy` multiplie déjà
   * `zoomLevel` par un facteur (molette/pincement), le zoom est donc
   * intrinsèquement exponentiel. Une fraction linéaire placerait le seuil
   * "dézoomé à 30%" de la demande produit à un niveau déjà très rapproché
   * (quasi à l'échelle de la rue), pas à l'échelle "vue d'ensemble de la
   * ville" voulue pour les zones de quartier (src/quartiers.ts).
   */
  getZoomFraction(): number {
    const logMin = Math.log(this.minZoom);
    const logMax = Math.log(this.maxZoom);
    return (Math.log(this.zoomLevel) - logMin) / (logMax - logMin);
  }

  /** Niveau de zoom actuel (unités internes, voir zoomBy/flyTo). */
  get currentZoom(): number {
    return this.zoomLevel;
  }

  /** Borne haute de zoom (voir maxZoom ci-dessus), exposée pour le clustering (src/clustering.ts). */
  get maxZoomLevel(): number {
    return this.maxZoom;
  }

  private readonly _scratchV3 = new THREE.Vector3();

  /**
   * Projette un point du monde vers l'écran (px), selon la caméra actuelle.
   * `camera.updateMatrixWorld()` est explicite plutôt que de compter sur le
   * prochain `renderer.render()` : utilisé par le clustering (src/
   * clustering.ts) depuis un callback différé (idle), pas forcément dans la
   * même frame qu'un rendu.
   */
  worldToScreen(worldX: number, worldY: number, worldZ: number, viewportW: number, viewportH: number) {
    this.camera.updateMatrixWorld();
    this._scratchV3.set(worldX, worldY, worldZ).project(this.camera);
    return {
      x: ((this._scratchV3.x + 1) / 2) * viewportW,
      y: ((1 - this._scratchV3.y) / 2) * viewportH,
    };
  }

  /**
   * Déplacement + zoom animés vers un point du sol (ex. résultat de
   * recherche de rue). `onComplete` (ex. recalcul des clusters, voir
   * main.ts) se déclenche une fois l'animation terminée — un déplacement
   * programmatique ne génère aucun évènement pointermove, donc rien
   * d'autre ne signalerait que la caméra vient de s'arrêter.
   */
  flyTo(worldX: number, worldZ: number, zoom: number, durationMs = 700, onComplete?: () => void) {
    const startTarget = this.target.clone();
    const endTarget = new THREE.Vector3(worldX, 0, worldZ);
    const startZoom = this.zoomLevel;
    const endZoom = THREE.MathUtils.clamp(zoom, this.minZoom, this.maxZoom);
    const startTime = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      this.target.lerpVectors(startTarget, endTarget, eased);
      this.zoomLevel = startZoom + (endZoom - startZoom) * eased;
      this.update();
      if (t < 1) requestAnimationFrame(step);
      else onComplete?.();
    };
    requestAnimationFrame(step);
  }

  /**
   * Déplacement + zoom animés pour cadrer un ensemble de points du sol (ex.
   * résultats filtrés dans la bottom sheet) — calcule le centre et le zoom
   * nécessaires pour que la boîte englobante tienne dans ~70% du cadre, puis
   * délègue à `flyTo` pour l'animation (même lerp, pas de code dupliqué).
   */
  flyToBounds(points: { x: number; z: number }[], durationMs = 700, onComplete?: () => void) {
    if (points.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const MARGIN = 0.7; // les résultats remplissent ~70% du cadre, pas bord à bord
    const spanX = Math.max(maxX - minX, 1);
    const spanZ = Math.max(maxZ - minZ, 1);
    const zoomForX = (this.frustumSize * this.aspect * MARGIN) / spanX;
    const zoomForZ = (this.frustumSize * MARGIN) / spanZ;
    this.flyTo(centerX, centerZ, Math.min(zoomForX, zoomForZ), durationMs, onComplete);
  }
}
