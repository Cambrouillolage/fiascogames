import * as THREE from 'three';
import type { IsoCameraRig } from './cameraRig.ts';
import type { MerchantPin } from './merchantPins.ts';
import { clusterByScreen, clusterKey, projectAll, spiderfyPositions, type Cluster, type ClusterPoint } from './clustering.ts';

// Distance écran (px) en dessous de laquelle deux pins sont regroupés en
// cluster — fixe quel que soit le zoom (c'est justement ce qui fait qu'un
// amas se "déplie" naturellement en zoomant : les points s'écartent à
// l'écran, moins d'entre eux restent sous ce rayon). Un peu plus large pour
// les GAV entre eux : on préfère les garder individuels, donc un rayon plus
// serré avant de former un cluster GAV dédié.
export const CLUSTER_PIXEL_RADIUS = 42;
export const GAV_CLUSTER_PIXEL_RADIUS = 26;

export const PIN_WORLD_Y = 18;

interface PinPoint extends ClusterPoint {
  pin: MerchantPin;
}

export type MapCluster = Cluster<PinPoint> & { isGav: boolean };

function bubbleTexture(count: number, isGav: boolean): THREE.CanvasTexture {
  const scale = 3;
  const size = (isGav ? 46 : 40) + Math.min(28, Math.round(Math.sqrt(count) * 7));
  const canvas = document.createElement('canvas');
  canvas.width = size * scale;
  canvas.height = size * scale;
  const ctx = canvas.getContext('2d')!;
  const r = (size * scale) / 2;

  ctx.beginPath();
  ctx.arc(r, r, r - 3 * scale, 0, Math.PI * 2);
  ctx.fillStyle = isGav ? '#ea6f11' : '#3a3a3a';
  ctx.fill();
  ctx.lineWidth = 3 * scale;
  ctx.strokeStyle = '#fff';
  ctx.stroke();

  ctx.fillStyle = '#fff';
  ctx.font = `800 ${Math.round(size * scale * 0.38)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(count), r, r + 2 * scale);

  if (isGav) {
    ctx.font = `${Math.round(size * scale * 0.26)}px system-ui, sans-serif`;
    ctx.fillText('🎲', r, r - size * scale * 0.27);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface ClusterLayer {
  /**
   * Recalcule les clusters à partir des pins actuellement éligibles
   * (`matchesFilter`) et masque/affiche les pins individuels en
   * conséquence. `forcedSpiderfyKey` (voir clustering.ts#clusterKey) force
   * le groupe correspondant en éventail plutôt qu'en bulle — utilisé juste
   * après un clic sur un cluster de coordonnées confondues (voir
   * computeHalfSplitZoom) ; un recalcul normal (sans cette clé, ex. après
   * un prochain pan/zoom) revient au clustering habituel.
   */
  recompute(
    pins: MerchantPin[],
    rig: IsoCameraRig,
    viewportW: number,
    viewportH: number,
    forcedSpiderfyKey?: string | null
  ): MapCluster[];
  pick(camera: THREE.Camera, clientX: number, clientY: number, viewportW: number, viewportH: number): MapCluster | null;
  clear(): void;
}

export function createClusterLayer(scene: THREE.Scene): ClusterLayer {
  let bubbles: { sprite: THREE.Sprite; cluster: MapCluster }[] = [];
  // Pins actuellement décalés en éventail, pour les remettre à leur
  // véritable position (celle posée par buildMerchantPins, jamais mutée
  // ailleurs) dès qu'ils ne sont plus le cluster en éventail courant.
  let spiderfiedHomePositions = new Map<string, { x: number; z: number }>();

  function clear() {
    for (const b of bubbles) {
      scene.remove(b.sprite);
      (b.sprite.material as THREE.SpriteMaterial).map?.dispose();
      (b.sprite.material as THREE.SpriteMaterial).dispose();
    }
    bubbles = [];
  }

  function recompute(
    pins: MerchantPin[],
    rig: IsoCameraRig,
    viewportW: number,
    viewportH: number,
    forcedSpiderfyKey: string | null = null
  ): MapCluster[] {
    clear();

    // Restaure la position réelle de tout pin précédemment déplacé en
    // éventail avant de recalculer quoi que ce soit.
    for (const p of pins) {
      const home = spiderfiedHomePositions.get(p.merchant.id);
      if (home) p.sprite.position.set(home.x, p.sprite.position.y, home.z);
    }
    spiderfiedHomePositions = new Map();

    const eligible = pins.filter((p) => p.matchesFilter);
    const gavPoints: PinPoint[] = [];
    const lockedPoints: PinPoint[] = [];
    for (const p of eligible) {
      const point: PinPoint = { id: p.merchant.id, worldX: p.sprite.position.x, worldZ: -p.sprite.position.z, pin: p };
      if (p.merchant.is_locked) lockedPoints.push(point);
      else gavPoints.push(point);
    }

    // GAV et verrouillés sont groupés SÉPARÉMENT (jamais un commerce GAV
    // absorbé dans un cluster classique, règle produit) : deux passes de
    // clustering indépendantes plutôt qu'une seule sur tous les points.
    const gavScreen = projectAll(gavPoints, rig, PIN_WORLD_Y, viewportW, viewportH);
    const lockedScreen = projectAll(lockedPoints, rig, PIN_WORLD_Y, viewportW, viewportH);
    const gavClusters = clusterByScreen(gavPoints, gavScreen, GAV_CLUSTER_PIXEL_RADIUS).map((c) => ({
      ...c,
      isGav: true as const,
    }));
    const lockedClusters = clusterByScreen(lockedPoints, lockedScreen, CLUSTER_PIXEL_RADIUS).map((c) => ({
      ...c,
      isGav: false as const,
    }));
    const allClusters: MapCluster[] = [...gavClusters, ...lockedClusters];

    for (const cluster of allClusters) {
      const isSingle = cluster.members.length === 1;
      const isForcedSpiderfy =
        !isSingle && forcedSpiderfyKey !== null && clusterKey(cluster.members.map((m) => m.id)) === forcedSpiderfyKey;

      if (isForcedSpiderfy) {
        const fanned = spiderfyPositions(cluster.members.length, cluster.worldX, cluster.worldZ);
        cluster.members.forEach(({ pin }, i) => {
          spiderfiedHomePositions.set(pin.merchant.id, { x: pin.sprite.position.x, z: pin.sprite.position.z });
          pin.sprite.position.set(fanned[i].x, pin.sprite.position.y, -fanned[i].z);
          if (pin.lockSprite) pin.lockSprite.position.set(fanned[i].x, pin.lockSprite.position.y, -fanned[i].z);
          pin.sprite.visible = true;
          if (pin.lockSprite) pin.lockSprite.visible = true;
        });
        continue;
      }

      for (const { pin } of cluster.members) {
        const visible = isSingle;
        pin.sprite.visible = visible;
        if (pin.lockSprite) pin.lockSprite.visible = visible;
      }
      if (!isSingle) {
        const tex = bubbleTexture(cluster.members.length, cluster.isGav);
        const material = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
        const sprite = new THREE.Sprite(material);
        const worldSize = tex.image.width / 3 / 2; // ~ diamètre en unités-monde comparable aux pins à cette échelle d'affichage
        sprite.scale.set(worldSize, worldSize, 1);
        sprite.position.set(cluster.worldX, PIN_WORLD_Y + 2, -cluster.worldZ);
        // Les bulles GAV passent au-dessus des bulles classiques, mais
        // restent sous un pin GAV individuel (PIN_RENDER_ORDER_GAV) — un
        // cluster ne doit jamais sembler "couvrir" un commerce GAV.
        sprite.renderOrder = cluster.isGav ? 1001 : 996;
        scene.add(sprite);
        bubbles.push({ sprite, cluster });
      }
    }

    return allClusters;
  }

  function pick(
    camera: THREE.Camera,
    clientX: number,
    clientY: number,
    viewportW: number,
    viewportH: number
  ): MapCluster | null {
    if (!bubbles.length) return null;
    const ndc = new THREE.Vector2((clientX / viewportW) * 2 - 1, -(clientY / viewportH) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const sprites = bubbles.map((b) => b.sprite);
    const hits = raycaster.intersectObjects(sprites, false);
    if (!hits.length) return null;
    const hit = bubbles.find((b) => b.sprite === hits[0].object);
    return hit?.cluster ?? null;
  }

  return { recompute, pick, clear };
}
