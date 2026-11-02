import * as THREE from 'three';
import type { Merchant } from './merchants.ts';
import { latLonToLocalMeters } from './merchants.ts';
import { badgesParId, BADGE_DEFAULT_ID } from './data/badgesClamart.ts';

// Les marqueurs sont les badges cartoon fournis (rond + icône + fond
// transparent déjà intégrés à l'image WebP) : pas de pointeur ni de cercle
// dessiné par-dessus, l'image EST le badge complet. Même mécanique Sprite
// que src/badges.ts (depthTest désactivé, renderOrder élevé) mais avec une
// texture chargée depuis un fichier au lieu d'un canvas dessiné à la main.

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map<string, THREE.Texture>();

function badgeWebpTexture(webpPath: string): THREE.Texture {
  let tex = textureCache.get(webpPath);
  if (!tex) {
    tex = textureLoader.load(`${import.meta.env.BASE_URL}${webpPath}`);
    tex.colorSpace = THREE.SRGBColorSpace;
    textureCache.set(webpPath, tex);
  }
  return tex;
}

// Badge d'un commerce verrouillé : même image, en gris (règle produit :
// "garder le logo mais le mettre en gris"). Une SpriteMaterial.color ne
// désature pas (simple multiplication RGB), il faut une vraie conversion
// pixel — faite une fois par badge sur un canvas hors-écran, avec
// ctx.filter, et mise en cache comme la texture couleur ci-dessus. La
// texture est retournée tout de suite (canvas vide, transparent) et se
// peuple dès que l'image source a fini de charger — même latence qu'un
// THREE.Texture normal, pas de flash supplémentaire perceptible.
const grayscaleTextureCache = new Map<string, THREE.Texture>();

function grayscaleBadgeTexture(webpPath: string): THREE.Texture {
  let tex = grayscaleTextureCache.get(webpPath);
  if (tex) return tex;

  const canvas = document.createElement('canvas');
  tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  grayscaleTextureCache.set(webpPath, tex);

  const img = new Image();
  img.onload = () => {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.filter = 'grayscale(1)';
    ctx.drawImage(img, 0, 0);
    tex!.needsUpdate = true;
  };
  img.src = `${import.meta.env.BASE_URL}${webpPath}`;

  return tex;
}

// Petit cadenas superposé au badge d'un commerce verrouillé (règle 5 :
// "badge cartoon éventuellement surmonté d'un petit cadenas") : un second
// Sprite minuscule décalé en coin, pas un second badge complet.
let lockTexture: THREE.CanvasTexture | null = null;
function lockIconTexture(): THREE.CanvasTexture {
  if (lockTexture) return lockTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
  ctx.fillStyle = '#1f2937';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.font = `${size * 0.52}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🔒', size / 2, size / 2 + 2);
  lockTexture = new THREE.CanvasTexture(canvas);
  lockTexture.colorSpace = THREE.SRGBColorSpace;
  return lockTexture;
}

export interface MerchantPin {
  sprite: THREE.Sprite;
  lockSprite: THREE.Sprite | null;
  merchant: Merchant;
  // Résultat du filtre catégories/mode-quartier (src/main.ts), indépendant
  // de `sprite.visible` : le clustering (src/clusterLayer.ts) masque aussi
  // des pins (absorbés dans une bulle) sans changer ce statut de filtre, il
  // doit donc rester lisible séparément à chaque recalcul de clusters.
  matchesFilter: boolean;
}

// Hiérarchie visuelle voulue : les commerces GAV (déverrouillés) doivent
// être "plus visibles et reconnaissables", les autres "plus discrets" — en
// plus du niveau de gris déjà appliqué aux verrouillés, un badge GAV est
// légèrement plus grand et dessiné par-dessus (renderOrder) tout le reste.
const PIN_SIZE_GAV = 26;
const PIN_SIZE_LOCKED = 18;
const PIN_SIZE_SELECTED = 32;
const LOCK_SIZE = 10;
const LOCK_SIZE_SELECTED = 13;
const LOCK_OFFSET_FACTOR = 0.42; // fraction du badge, pour que le cadenas reste au coin en se redimensionnant avec lui
export const PIN_RENDER_ORDER_GAV = 1002;
export const PIN_RENDER_ORDER_LOCKED = 998;
export const PIN_RENDER_ORDER_SELECTED = 1010;

export function buildMerchantPins(
  merchants: Merchant[],
  center: { lat: number; lon: number },
  scene: THREE.Scene
): MerchantPin[] {
  const pins: MerchantPin[] = [];

  for (const m of merchants) {
    if (m.lat == null || m.lon == null) continue;
    const badge = (m.badge_id && badgesParId[m.badge_id]) || badgesParId[BADGE_DEFAULT_ID];
    const tex = m.is_locked ? grayscaleBadgeTexture(badge.webp) : badgeWebpTexture(badge.webp);

    const pinSize = m.is_locked ? PIN_SIZE_LOCKED : PIN_SIZE_GAV;
    const material = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(pinSize, pinSize, 1);
    const [x, y] = latLonToLocalMeters(m.lat, m.lon, center);
    sprite.position.set(x, 18, -y);
    sprite.renderOrder = m.is_locked ? PIN_RENDER_ORDER_LOCKED : PIN_RENDER_ORDER_GAV;
    sprite.userData = { merchantId: m.id };
    scene.add(sprite);

    let lockSprite: THREE.Sprite | null = null;
    if (m.is_locked) {
      const lockMat = new THREE.SpriteMaterial({
        map: lockIconTexture(),
        depthTest: false,
        depthWrite: false,
        transparent: true,
      });
      lockSprite = new THREE.Sprite(lockMat);
      lockSprite.scale.set(LOCK_SIZE, LOCK_SIZE, 1);
      const offset = (pinSize * LOCK_OFFSET_FACTOR) / 2;
      lockSprite.position.set(x + offset, 18 + offset, -y);
      lockSprite.renderOrder = PIN_RENDER_ORDER_LOCKED + 1;
      scene.add(lockSprite);
    }

    pins.push({ sprite, lockSprite, merchant: m, matchesFilter: true });
  }

  return pins;
}

export function setSelectedPin(pins: MerchantPin[], merchantId: string | null) {
  for (const p of pins) {
    const selected = p.merchant.id === merchantId;
    const baseSize = p.merchant.is_locked ? PIN_SIZE_LOCKED : PIN_SIZE_GAV;
    const size = selected ? PIN_SIZE_SELECTED : baseSize;
    p.sprite.scale.set(size, size, 1);
    p.sprite.renderOrder = selected
      ? PIN_RENDER_ORDER_SELECTED
      : p.merchant.is_locked
        ? PIN_RENDER_ORDER_LOCKED
        : PIN_RENDER_ORDER_GAV;
    if (p.lockSprite) {
      const lockSize = selected ? LOCK_SIZE_SELECTED : LOCK_SIZE;
      p.lockSprite.scale.set(lockSize, lockSize, 1);
      const offset = (size * LOCK_OFFSET_FACTOR) / 2;
      p.lockSprite.position.set(p.sprite.position.x + offset, p.sprite.position.y + offset, p.sprite.position.z);
      p.lockSprite.renderOrder = p.sprite.renderOrder + 1;
    }
  }
}

export function pickMerchantPin(
  pins: MerchantPin[],
  camera: THREE.Camera,
  clientX: number,
  clientY: number,
  viewportW: number,
  viewportH: number
): Merchant | null {
  const ndc = new THREE.Vector2((clientX / viewportW) * 2 - 1, -(clientY / viewportH) * 2 + 1);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const sprites = pins.map((p) => p.sprite);
  const hits = raycaster.intersectObjects(sprites, false);
  if (!hits.length) return null;
  const hit = pins.find((p) => p.sprite === hits[0].object);
  return hit?.merchant ?? null;
}

export function applyCategoryFilter(pins: MerchantPin[], activeCategoryIds: Set<string> | null) {
  for (const p of pins) {
    const visible = !activeCategoryIds || activeCategoryIds.has(p.merchant.category_id);
    p.matchesFilter = visible;
    // Valeur par défaut tout de suite (corrigée par le clustering juste
    // après, voir main.ts#recomputeClusters, qui masque en plus les pins
    // absorbés dans une bulle) : évite un flash "tout visible" entre les
    // deux passes.
    p.sprite.visible = visible;
    if (p.lockSprite) p.lockSprite.visible = visible;
  }
}
