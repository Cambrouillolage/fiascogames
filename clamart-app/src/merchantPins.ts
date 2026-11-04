import * as THREE from 'three';
import type { Merchant } from './merchants.ts';
import { latLonToLocalMeters } from './merchants.ts';
import { badgesParId, BADGE_DEFAULT_ID } from './data/badgesClamart.ts';

// Les marqueurs sont les badges cartoon fournis (rond + icône + fond
// transparent déjà intégrés à l'image WebP) : pas de pointeur ni de cercle
// dessiné par-dessus, l'image EST le badge complet. Même mécanique Sprite
// que src/badges.ts (depthTest désactivé, renderOrder élevé) mais avec une
// texture chargée depuis un fichier au lieu d'un canvas dessiné à la main.

const textureCache = new Map<string, THREE.Texture>();

// Certains badges du catalogue ont un léger liseré blanc non transparent
// sur une partie du bord (défaut de l'asset source, voir le même commentaire
// dans badges.ts) : découpe systématique à un cercle légèrement en retrait
// du bord du canvas, quel que soit le badge concerné.
function badgeWebpTexture(webpPath: string): THREE.Texture {
  let tex = textureCache.get(webpPath);
  if (!tex) {
    const canvas = document.createElement('canvas');
    const canvasTex = new THREE.CanvasTexture(canvas);
    canvasTex.colorSpace = THREE.SRGBColorSpace;
    const img = new Image();
    img.onload = () => {
      const size = Math.max(img.naturalWidth, img.naturalHeight);
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.save();
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.49, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, 0, 0, size, size);
      ctx.restore();
      canvasTex.needsUpdate = true;
    };
    img.src = `${import.meta.env.BASE_URL}${webpPath}`;
    tex = canvasTex;
    textureCache.set(webpPath, tex);
  }
  return tex;
}

// Anneau doré derrière le badge d'un commerce GAV (déverrouillé) uniquement
// — règle produit : la bordure colorée ne doit distinguer QUE les
// revendeurs GAV, pas de couleur de catégorie pour les autres (retiré après
// coup, ça surchargeait la lecture de la carte). Un simple disque plein,
// légèrement plus grand que le badge posé par-dessus — comme le badge est
// lui-même un rond sur fond transparent, le disque ne dépasse que sur son
// pourtour, ce qui se lit comme une bordure, pas un second badge.
const GOLD_COLOR = '#F2C438';
export const RING_SIZE_FACTOR = 1.4;
let goldRingTexture: THREE.CanvasTexture | null = null;

function ringTexture(): THREE.CanvasTexture {
  if (goldRingTexture) return goldRingTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fillStyle = GOLD_COLOR;
  ctx.fill();
  goldRingTexture = new THREE.CanvasTexture(canvas);
  goldRingTexture.colorSpace = THREE.SRGBColorSpace;
  return goldRingTexture;
}

export interface MerchantPin {
  sprite: THREE.Sprite;
  ringSprite: THREE.Sprite | null;
  merchant: Merchant;
  // Résultat du filtre catégories/mode-quartier (src/main.ts), indépendant
  // de `sprite.visible` : c'est la seule source de vérité pour la visibilité
  // (plus de clustering qui masquerait en plus des pins absorbés dans une
  // bulle, voir src/pinDeclutter.ts qui ne fait que redimensionner/décaler).
  matchesFilter: boolean;
  // Vraie position (immuable, posée une fois ici) : src/pinDeclutter.ts
  // décale sprite.position pour désamorcer les collisions à l'écran, il lui
  // faut donc une référence stable pour toujours repartir de la bonne place
  // plutôt que de dériver d'un décalage précédent.
  homeX: number;
  homeZ: number;
}

// Hiérarchie visuelle voulue : les commerces GAV (déverrouillés) doivent
// être "plus visibles et reconnaissables", les autres "plus discrets" — en
// plus du niveau de gris déjà appliqué aux verrouillés, un badge GAV est
// légèrement plus grand et dessiné par-dessus (renderOrder) tout le reste.
export const PIN_SIZE_GAV = 26;
export const PIN_SIZE_LOCKED = 18;
const PIN_SIZE_SELECTED = 32;
export const PIN_RENDER_ORDER_GAV = 1002;
export const PIN_RENDER_ORDER_LOCKED = 998;
export const PIN_RENDER_ORDER_SELECTED = 1010;
// Hauteur (monde) commune à tous les badges — centralisée ici plutôt que
// dupliquée en dur, src/pinDeclutter.ts en a aussi besoin pour ses calculs
// écran <-> monde.
export const PIN_WORLD_Y = 18;

export function buildMerchantPins(
  merchants: Merchant[],
  center: { lat: number; lon: number },
  scene: THREE.Scene
): MerchantPin[] {
  const pins: MerchantPin[] = [];

  for (const m of merchants) {
    if (m.lat == null || m.lon == null) continue;
    const badge = (m.badge_id && badgesParId[m.badge_id]) || badgesParId[BADGE_DEFAULT_ID];
    const tex = badgeWebpTexture(badge.webp);

    const pinSize = m.is_locked ? PIN_SIZE_LOCKED : PIN_SIZE_GAV;
    const renderOrder = m.is_locked ? PIN_RENDER_ORDER_LOCKED : PIN_RENDER_ORDER_GAV;
    const [x, y] = latLonToLocalMeters(m.lat, m.lon, center);
    const homeX = x;
    const homeZ = -y;

    let ringSprite: THREE.Sprite | null = null;
    if (!m.is_locked) {
      const ringMat = new THREE.SpriteMaterial({
        map: ringTexture(),
        depthTest: false,
        depthWrite: false,
        transparent: true,
      });
      ringSprite = new THREE.Sprite(ringMat);
      ringSprite.scale.set(pinSize * RING_SIZE_FACTOR, pinSize * RING_SIZE_FACTOR, 1);
      ringSprite.position.set(homeX, PIN_WORLD_Y, homeZ);
      ringSprite.renderOrder = renderOrder - 0.5; // juste sous son badge, jamais sous un badge d'un AUTRE commerce (voir PIN_RENDER_ORDER_*)
      scene.add(ringSprite);
    }

    const material = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(pinSize, pinSize, 1);
    sprite.position.set(homeX, PIN_WORLD_Y, homeZ);
    sprite.renderOrder = renderOrder;
    sprite.userData = { merchantId: m.id };
    scene.add(sprite);

    pins.push({ sprite, ringSprite, merchant: m, matchesFilter: true, homeX, homeZ });
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
    if (p.ringSprite) {
      p.ringSprite.scale.set(size * RING_SIZE_FACTOR, size * RING_SIZE_FACTOR, 1);
      p.ringSprite.renderOrder = p.sprite.renderOrder - 0.5;
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

// `allowedMerchantIds` : filtre additionnel optionnel (ex. quartier
// sélectionné, voir src/filtersSheet.ts) — un commerce doit satisfaire LES
// DEUX filtres (catégorie ET quartier) pour rester visible. `null` = pas de
// restriction sur ce filtre-là.
export function applyCategoryFilter(
  pins: MerchantPin[],
  activeCategoryIds: Set<string> | null,
  allowedMerchantIds: Set<string> | null = null
) {
  for (const p of pins) {
    const matchesCategory = !activeCategoryIds || activeCategoryIds.has(p.merchant.category_id);
    const matchesQuartier = !allowedMerchantIds || allowedMerchantIds.has(p.merchant.id);
    const visible = matchesCategory && matchesQuartier;
    p.matchesFilter = visible;
    p.sprite.visible = visible;
    if (p.ringSprite) p.ringSprite.visible = visible;
  }
}
