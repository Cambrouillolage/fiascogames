import * as THREE from 'three';
import type { LandmarkCategory, MapLandmark } from './mapData.ts';
import { badgesParId } from './data/badgesClamart.ts';

// Badges "pin" au-dessus des lieux emblématiques : un Sprite (toujours face
// caméra, même après rotation 90°) par lieu, avec la texture chargée depuis
// le badge cartoon fourni (rond + icône + transparence déjà dans l'image) —
// pas de disque/pointeur dessiné par-dessus, même principe que
// src/merchantPins.ts. userData porte le nom/catégorie pour le clic
// (raycast) -> bottom sheet.

const CATEGORY_BADGE_ID: Record<LandmarkCategory, string> = {
  townhall: 'mairie',
  church: 'eglise',
  mosque: 'mosquee',
  school: 'ecole',
  college: 'college_lycee',
  post_office: 'poste',
  park: 'parc',
  station: 'gare',
  hospital: 'hopital',
  police: 'commissariat',
  fire_station: 'pompier',
  sports_hall: 'salle_sport',
  // sports_pitch/sports_tennis/sports_track : pas d'asset webp dédié dans le
  // catalogue (badgesClamart.ts) pour l'instant — voir EMOJI_BADGE plus bas,
  // ces 3-là sont dessinés directement plutôt que de retomber sur l'icône
  // générique "boutique", trompeuse pour un terrain de sport.
  sports_pitch: '',
  sports_tennis: '',
  sports_track: '',
  sports_rugby: '',
};

// Badge "rond + emoji" dessiné sur canvas pour les catégories sans asset
// webp dédié — même esprit visuel que les badges fournis (rond + icône),
// sans attendre un nouvel asset pour ces 3-là.
const EMOJI_BADGE: Partial<Record<LandmarkCategory, { emoji: string; color: string }>> = {
  sports_pitch: { emoji: '⚽', color: '#5FBF4A' },
  sports_tennis: { emoji: '🎾', color: '#4AA8C9' },
  sports_track: { emoji: '🏃', color: '#CC6B3F' },
  sports_rugby: { emoji: '🏉', color: '#8A5A3C' },
};

const textureCache = new Map<string, THREE.Texture>();

// Certains badges du catalogue ont un léger liseré blanc non transparent
// sur une partie du bord (défaut de l'asset source, visible en zoomant —
// signalé par l'utilisateur) : plutôt que de corriger chaque PNG un par un,
// on découpe systématiquement à un cercle légèrement en retrait du bord du
// canvas au chargement, ce qui élimine ce liseré quel que soit le badge
// concerné.
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

const emojiTextureCache = new Map<string, THREE.CanvasTexture>();

function emojiBadgeTexture(emoji: string, bgColor: string): THREE.CanvasTexture {
  const key = `${emoji}:${bgColor}`;
  let tex = emojiTextureCache.get(key);
  if (tex) return tex;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = bgColor;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.font = `${size * 0.52}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, size / 2, size / 2 + 4);
  tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  emojiTextureCache.set(key, tex);
  return tex;
}

export interface BadgeHit {
  name: string;
  category: LandmarkCategory;
}

export function buildBadges(landmarks: MapLandmark[], scene: THREE.Scene): THREE.Sprite[] {
  const sprites: THREE.Sprite[] = [];

  for (const l of landmarks) {
    const emojiSpec = EMOJI_BADGE[l.c];
    const tex = emojiSpec
      ? emojiBadgeTexture(emojiSpec.emoji, emojiSpec.color)
      : badgeWebpTexture((badgesParId[CATEGORY_BADGE_ID[l.c]] ?? badgesParId['boutique']).webp);
    // depthTest désactivé + renderOrder élevé : le badge doit rester un
    // repère toujours visible (comme un pin de carte), pas se faire
    // "manger" derrière un immeuble plus proche de la caméra.
    const material = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
    const sprite = new THREE.Sprite(material);
    const size = 22;
    sprite.scale.set(size, size, 1);
    sprite.position.set(l.pos[0], l.h, -l.pos[1]);
    // Sous tout pin commerce (PIN_RENDER_ORDER_LOCKED=998, voir
    // merchantPins.ts) : un lieu non-commerçant (mairie, école, parking...)
    // ne doit jamais passer devant un commerce qui se trouverait au même
    // endroit à l'écran — règle produit.
    sprite.renderOrder = 997;
    sprite.userData = { name: l.n, category: l.c } satisfies BadgeHit;
    scene.add(sprite);
    sprites.push(sprite);
  }

  return sprites;
}

export function setBadgesVisible(badges: THREE.Sprite[], visible: boolean) {
  for (const b of badges) b.visible = visible;
}

/** Retourne le badge touché (le plus proche de la caméra) sous (clientX, clientY), ou null. */
export function pickBadge(
  badges: THREE.Sprite[],
  camera: THREE.Camera,
  clientX: number,
  clientY: number,
  viewportW: number,
  viewportH: number
): BadgeHit | null {
  const ndc = new THREE.Vector2((clientX / viewportW) * 2 - 1, -(clientY / viewportH) * 2 + 1);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(badges, false);
  if (!hits.length) return null;
  return hits[0].object.userData as BadgeHit;
}
