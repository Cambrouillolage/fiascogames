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
  school: 'ecole',
  post_office: 'poste',
  park: 'parc',
  station: 'gare',
  parking: 'parking',
  hospital: 'hopital',
};

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

export interface BadgeHit {
  name: string;
  category: LandmarkCategory;
}

export function buildBadges(landmarks: MapLandmark[], scene: THREE.Scene): THREE.Sprite[] {
  const sprites: THREE.Sprite[] = [];

  for (const l of landmarks) {
    const badge = badgesParId[CATEGORY_BADGE_ID[l.c]] ?? badgesParId['boutique'];
    const tex = badgeWebpTexture(badge.webp);
    // depthTest désactivé + renderOrder élevé : le badge doit rester un
    // repère toujours visible (comme un pin de carte), pas se faire
    // "manger" derrière un immeuble plus proche de la caméra.
    const material = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
    const sprite = new THREE.Sprite(material);
    const size = 22;
    sprite.scale.set(size, size, 1);
    sprite.position.set(l.pos[0], l.h, -l.pos[1]);
    sprite.renderOrder = 999;
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
