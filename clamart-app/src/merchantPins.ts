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
const GOLD_SHINE_COLOR = '#FFF6D8';
export const RING_SIZE_FACTOR = 1.4;
const RING_CANVAS_SIZE = 64;
let goldRingCanvas: HTMLCanvasElement | null = null;
let goldRingCtx: CanvasRenderingContext2D | null = null;
let goldRingTexture: THREE.CanvasTexture | null = null;

// Anneau partagé par TOUS les pins GAV (un seul canvas/texture, redessiné
// chaque frame) plutôt qu'un par pin : un bandeau de lumière tourne autour
// de l'anneau pour un effet "scintillant" (demande produit), sans coût par
// instance — redessiner un canvas 64x64 est négligeable, et comme la
// texture est partagée, la mise à jour se fait une seule fois par frame
// quel que soit le nombre de commerces GAV affichés.
function ringTexture(): THREE.CanvasTexture {
  if (goldRingTexture) return goldRingTexture;
  const size = RING_CANVAS_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  goldRingCanvas = canvas;
  goldRingCtx = canvas.getContext('2d')!;
  goldRingTexture = new THREE.CanvasTexture(canvas);
  goldRingTexture.colorSpace = THREE.SRGBColorSpace;
  drawRingShimmer(0);
  return goldRingTexture;
}

const RING_SHIMMER_PERIOD_S = 2.6;

function drawRingShimmer(elapsedSec: number) {
  if (!goldRingCtx || !goldRingCanvas) return;
  const size = RING_CANVAS_SIZE;
  const r = size / 2 - 2;
  const cx = size / 2;
  const cy = size / 2;
  const ctx = goldRingCtx;
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = GOLD_COLOR;
  ctx.fill();

  // Bandeau lumineux : un dégradé angulaire étroit qui tourne en continu
  // (un seul tour toutes les RING_SHIMMER_PERIOD_S secondes), superposé en
  // "lighter" pour éclaircir plutôt que remplacer la couleur or dessous.
  const phase = (elapsedSec % RING_SHIMMER_PERIOD_S) / RING_SHIMMER_PERIOD_S;
  const sweepAngle = phase * Math.PI * 2;
  const sweepWidth = Math.PI / 4;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const grad = ctx.createConicGradient
    ? ctx.createConicGradient(sweepAngle - sweepWidth / 2, cx, cy)
    : null;
  if (grad) {
    grad.addColorStop(0, 'rgba(255,246,216,0)');
    grad.addColorStop(0.5, GOLD_SHINE_COLOR);
    grad.addColorStop(1, 'rgba(255,246,216,0)');
    // Restreint le dégradé conique (0..2π) à la largeur voulue en
    // dupliquant la couleur transparente sur le reste du cercle.
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(0, 0, size, size);
  } else {
    // Secours (navigateur sans createConicGradient) : un simple arc plein
    // plus clair à la position du balayage, moins fin mais même principe.
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, sweepAngle - sweepWidth / 2, sweepAngle + sweepWidth / 2);
    ctx.closePath();
    ctx.fillStyle = GOLD_SHINE_COLOR;
    ctx.globalAlpha = 0.85;
    ctx.fill();
  }
  ctx.restore();

  goldRingTexture!.needsUpdate = true;
}

/** À appeler une fois par frame (voir animate() dans main.ts) pour faire tourner le reflet. */
export function tickRingShimmer(elapsedSec: number) {
  if (!goldRingTexture) return; // pas encore créé (aucun pin GAV construit) : rien à animer
  drawRingShimmer(elapsedSec);
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
