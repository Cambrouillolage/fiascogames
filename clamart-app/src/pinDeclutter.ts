import * as THREE from 'three';
import type { IsoCameraRig } from './cameraRig.ts';
import type { MerchantPin } from './merchantPins.ts';
import { PIN_WORLD_Y, PIN_SIZE_GAV, PIN_SIZE_LOCKED, RING_SIZE_FACTOR } from './merchantPins.ts';
import { clusterByScreen, projectAll, type ClusterPoint } from './clustering.ts';

// Anti-collision des badges, sans agrégation (plus de bulles "+N" — règle
// produit : on préfère rapetisser/décaler plutôt que cacher un commerce).
// À chaque recalcul (débounce pan/zoom, voir main.ts#scheduleDeclutter) :
// 1) la taille des badges s'adapte au zoom — plus discrets dézoomé, pleine
//    taille rapproché (les GAV rétrécissent moins, règle "toujours
//    prioritaires/lisibles") ;
// 2) les badges qui se chevauchent encore à l'écran (typiquement plusieurs
//    commerces au même immeuble, qu'aucun zoom ne séparera jamais) sont
//    décalés en éventail autour d'un badge "ancre" qui reste à sa vraie
//    position (le pin sélectionné, sinon un GAV, sinon le premier membre) ;
//    un léger trait relie chaque badge décalé à la position réelle du
//    commerce, pour rester honnête sur l'emplacement.

interface DeclutterPoint extends ClusterPoint {
  pin: MerchantPin;
}

// Rayons de collision/décalage exprimés en FRACTION de la taille écran
// réelle d'un badge verrouillé (le cas le plus courant, voir
// sizeScaleForZoom) au zoom courant — pas un nombre de px fixe : un badge
// peut occuper 15px comme 150px selon le zoom, un seuil fixe serait soit
// toujours déclenché soit jamais selon le niveau. `COLLISION_SIZE_FACTOR=1`
// correspond à peu près au seuil "les deux badges se touchent tout juste"
// (distance centre-à-centre = diamètre, pour deux badges de même taille).
const COLLISION_SIZE_FACTOR = 0.8;
const OFFSET_SIZE_FACTOR = 1.6; // décalage d'~1,6x un badge — plus large qu'avant, pour désamorcer les amas denses
// Les GAV restent lisibles même très dézoomé (toujours prioritaires) ; les
// verrouillés peuvent rétrécir davantage, ce sont eux qui doivent "s'effacer".
const MIN_SIZE_SCALE_GAV = 0.75;
const MIN_SIZE_SCALE_LOCKED = 0.5;
// Un badge décalé (pas l'ancre du groupe) est légèrement réduit, pour que
// l'ancre reste visuellement dominante dans le petit éventail.
const FANNED_SIZE_FACTOR = 0.9;
// Au-delà de ce nombre de badges décalés autour d'une même ancre (immeuble
// très dense), un seul éventail serait illisible (tous entassés au même
// rayon) : on empile des anneaux concentriques successifs plutôt que de
// chercher à tout faire tenir sur un seul.
const RING_CAPACITY = 3;
const RING_RADIUS_STEP = 1.1; // chaque anneau suivant est ~110% plus loin que le précédent

/** Angles (radians, convention écran : y vers le bas) d'un éventail ouvert vers le haut, pour ne pas chevaucher ce qu'il y a sous l'ancre. */
function fanAngles(n: number): number[] {
  if (n <= 1) return [-Math.PI / 2];
  const start = (-165 * Math.PI) / 180;
  const end = (-15 * Math.PI) / 180;
  const angles: number[] = [];
  for (let i = 0; i < n; i++) angles.push(start + ((end - start) * i) / (n - 1));
  return angles;
}

/** Position (angle + multiplicateur de rayon) de chaque membre "autre" d'un groupe, en anneaux successifs au-delà de RING_CAPACITY. */
function fanLayout(n: number): { angle: number; radiusMul: number }[] {
  const layout: { angle: number; radiusMul: number }[] = [];
  let remaining = n;
  let ring = 0;
  while (remaining > 0) {
    const countInRing = Math.min(RING_CAPACITY, remaining);
    const angles = fanAngles(countInRing);
    const radiusMul = 1 + ring * RING_RADIUS_STEP;
    for (const angle of angles) layout.push({ angle, radiusMul });
    remaining -= countInRing;
    ring += 1;
  }
  return layout;
}

function sizeScaleForZoom(rig: IsoCameraRig, minScale: number): number {
  const fraction = THREE.MathUtils.clamp(rig.getZoomFraction(), 0, 1);
  return minScale + (1 - minScale) * fraction;
}

export interface PinDeclutter {
  update(
    pins: MerchantPin[],
    rig: IsoCameraRig,
    viewportW: number,
    viewportH: number,
    selectedMerchantId: string | null
  ): void;
  clear(): void;
}

export function createPinDeclutter(scene: THREE.Scene): PinDeclutter {
  let lines: THREE.Line[] = [];

  function clear() {
    for (const line of lines) {
      scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    lines = [];
  }

  function addLine(fromX: number, fromZ: number, toX: number, toZ: number) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(fromX, 1.5, fromZ),
      new THREE.Vector3(toX, PIN_WORLD_Y, toZ),
    ]);
    const material = new THREE.LineBasicMaterial({ color: 0x4a4a4a, transparent: true, opacity: 0.8, depthTest: false });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 990; // sous tout badge (998+), au-dessus du reste de la scène
    scene.add(line);
    lines.push(line);
  }

  function update(
    pins: MerchantPin[],
    rig: IsoCameraRig,
    viewportW: number,
    viewportH: number,
    selectedMerchantId: string | null
  ) {
    clear();

    const eligible = pins.filter((p) => p.matchesFilter);
    if (eligible.length === 0) return;

    const gavScale = sizeScaleForZoom(rig, MIN_SIZE_SCALE_GAV);
    const lockedScale = sizeScaleForZoom(rig, MIN_SIZE_SCALE_LOCKED);

    function baseSizeFor(pin: MerchantPin): number {
      const base = pin.merchant.is_locked ? PIN_SIZE_LOCKED : PIN_SIZE_GAV;
      const scale = pin.merchant.is_locked ? lockedScale : gavScale;
      return base * scale;
    }

    function applyPinVisual(pin: MerchantPin, size: number, x: number, z: number) {
      pin.sprite.scale.set(size, size, 1);
      pin.sprite.position.set(x, PIN_WORLD_Y, z);
      if (pin.ringSprite) {
        pin.ringSprite.scale.set(size * RING_SIZE_FACTOR, size * RING_SIZE_FACTOR, 1);
        pin.ringSprite.position.set(x, PIN_WORLD_Y, z);
      }
    }

    // Le pin sélectionné (voir merchantPins.ts#setSelectedPin) garde la
    // taille/surbrillance posée ailleurs — on ne le redimensionne/décale pas
    // ici, seule sa participation au groupement de collision compte (il doit
    // toujours être l'ancre, jamais le membre décalé, d'un groupe où il
    // apparaît).
    const points: DeclutterPoint[] = eligible.map((pin) => ({
      id: pin.merchant.id,
      worldX: pin.homeX,
      worldZ: pin.homeZ,
      pin,
    }));
    const screen = projectAll(points, rig, PIN_WORLD_Y, viewportW, viewportH);

    // Base px <-> monde (inverse de IsoCameraRig#worldToScreen) : constante
    // pour tout ce recalcul (même état caméra), dérivée en projetant deux
    // vecteurs unitaires plutôt qu'une formule analytique — robuste à
    // l'azimut isométrique fixe sans dépendre de ses détails internes. Sert
    // aussi à convertir la taille d'un badge (monde) en taille écran réelle,
    // pour que les seuils de collision/décalage ci-dessous s'adaptent au
    // zoom plutôt que d'être des px fixes (un badge va de ~15px à ~150px
    // selon le zoom, voir sizeScaleForZoom).
    const origin = rig.worldToScreen(0, PIN_WORLD_Y, 0, viewportW, viewportH);
    const alongX = rig.worldToScreen(1, PIN_WORLD_Y, 0, viewportW, viewportH);
    const alongZ = rig.worldToScreen(0, PIN_WORLD_Y, 1, viewportW, viewportH);
    const ux = { dx: alongX.x - origin.x, dy: alongX.y - origin.y };
    const uz = { dx: alongZ.x - origin.x, dy: alongZ.y - origin.y };
    const det = ux.dx * uz.dy - uz.dx * ux.dy;
    const pxPerWorldUnit = (Math.hypot(ux.dx, ux.dy) + Math.hypot(uz.dx, uz.dy)) / 2;

    function pxOffsetToWorld(pxDx: number, pxDy: number): { dx: number; dz: number } {
      if (Math.abs(det) < 1e-9) return { dx: 0, dz: 0 };
      return {
        dx: (uz.dy * pxDx - uz.dx * pxDy) / det,
        dz: (-ux.dy * pxDx + ux.dx * pxDy) / det,
      };
    }

    const referenceBadgePx = PIN_SIZE_LOCKED * lockedScale * pxPerWorldUnit;
    const collisionRadius = referenceBadgePx * COLLISION_SIZE_FACTOR;
    const offsetPx = referenceBadgePx * OFFSET_SIZE_FACTOR;
    const groups = clusterByScreen(points, screen, collisionRadius);

    for (const group of groups) {
      if (group.members.length === 1) {
        const pin = group.members[0].pin;
        if (pin.merchant.id === selectedMerchantId) continue;
        applyPinVisual(pin, baseSizeFor(pin), pin.homeX, pin.homeZ);
        continue;
      }

      const members = group.members;
      let anchorIdx = members.findIndex((m) => m.pin.merchant.id === selectedMerchantId);
      if (anchorIdx < 0) anchorIdx = members.findIndex((m) => !m.pin.merchant.is_locked);
      if (anchorIdx < 0) anchorIdx = 0;
      const anchor = members[anchorIdx];
      const others = members.filter((_, i) => i !== anchorIdx);

      if (anchor.pin.merchant.id !== selectedMerchantId) {
        applyPinVisual(anchor.pin, baseSizeFor(anchor.pin), anchor.pin.homeX, anchor.pin.homeZ);
      }

      const layout = fanLayout(others.length);
      others.forEach((member, i) => {
        if (member.pin.merchant.id === selectedMerchantId) return; // garde-fou, ne devrait pas arriver (ancre prioritaire ci-dessus)
        const { angle, radiusMul } = layout[i];
        const r = offsetPx * radiusMul;
        const pxDx = Math.cos(angle) * r;
        const pxDy = Math.sin(angle) * r;
        const { dx, dz } = pxOffsetToWorld(pxDx, pxDy);
        const x = member.pin.homeX + dx;
        const z = member.pin.homeZ + dz;
        applyPinVisual(member.pin, baseSizeFor(member.pin) * FANNED_SIZE_FACTOR, x, z);
        addLine(member.pin.homeX, member.pin.homeZ, x, z);
      });
    }
  }

  return { update, clear };
}
