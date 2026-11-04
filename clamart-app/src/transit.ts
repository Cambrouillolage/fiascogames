import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MapArea } from './mapData.ts';
import { toonMaterial } from './toonShading.ts';
import { pointInRing } from './quartiers.ts';

// Train + trams : même architecture que src/traffic.ts (chemin suivi par
// distance d'arc, InstancedMesh, matrice réécrite chaque frame), mais sur
// la ligne de centre du rail/rail de tram (data.railways/data.tramways),
// PAS de décalage latéral contrairement aux voitures — une seule voie, pas
// deux sens de circulation côte à côte. Un seul tronçon OSM par ligne est
// déjà assez long pour un aller-retour visible (vérifié : jusqu'à 5+ km
// pour le tram, >1 km pour le rail), pas besoin de recoudre plusieurs
// tronçons entre eux.
//
// Un tronçon de tram/rail déborde souvent largement de la commune (le T6
// continue dans les communes voisines) : sans ça, le véhicule roulait une
// partie de son aller-retour hors du sol rendu (clippé au vrai contour de
// Clamart, voir cityBuilder.ts), donc visible flottant dans le ciel à vide
// — `clipToBoundary` ne garde que le plus long tronçon CONTINU à
// l'intérieur du contour.

function clipToBoundary(area: MapArea, boundary: [number, number][]): MapArea | null {
  const inside = area.p.map(([x, y]) => pointInRing(x, y, boundary));
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < inside.length; i++) {
    if (inside[i]) {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  if (bestLen < 2) return null;
  return { p: area.p.slice(bestStart, bestStart + bestLen) };
}

interface TransitPath {
  points: THREE.Vector2[];
  cumDist: number[];
  totalLength: number;
}

function buildCenterPath(area: MapArea): TransitPath | null {
  if (area.p.length < 2) return null;
  const points = area.p.map(([x, y]) => new THREE.Vector2(x, -y));
  const cumDist = [0];
  for (let i = 1; i < points.length; i++) {
    cumDist.push(cumDist[i - 1] + points[i].distanceTo(points[i - 1]));
  }
  return { points, cumDist, totalLength: cumDist[cumDist.length - 1] };
}

function samplePath(path: TransitPath, distance: number): { pos: THREE.Vector2; dir: THREE.Vector2 } {
  const d = THREE.MathUtils.clamp(distance, 0, path.totalLength);
  let i = 1;
  while (i < path.cumDist.length - 1 && path.cumDist[i] < d) i++;
  const segStart = path.cumDist[i - 1];
  const segLen = Math.max(1e-6, path.cumDist[i] - segStart);
  const t = (d - segStart) / segLen;
  const pos = path.points[i - 1].clone().lerp(path.points[i], t);
  const dir = new THREE.Vector2().subVectors(path.points[i], path.points[i - 1]).normalize();
  return { pos, dir };
}

type TransitKind = 'train' | 'tram';

const DIMENSIONS: Record<TransitKind, { length: number; height: number; width: number }> = {
  train: { length: 22, height: 3.2, width: 2.9 },
  tram: { length: 24, height: 3.1, width: 2.5 },
};
const COLORS: Record<TransitKind, number> = {
  train: 0x3f5068, // bleu-gris SNCF
  tram: 0xe3e7ea, // blanc cassé, tram T6
};
const SPEED_MPS: Record<TransitKind, number> = {
  train: 11,
  tram: 8,
};
const WORLD_Y: Record<TransitKind, number> = {
  train: 0.4, // au-dessus du ruban rail (y=0.12 dans cityBuilder)
  tram: 0.42, // au-dessus du ruban tram (y=0.13 dans cityBuilder)
};

function buildVehicleGeometry(kind: TransitKind): THREE.BufferGeometry {
  const { length, height, width } = DIMENSIONS[kind];
  const body = new THREE.BoxGeometry(length, height, width);
  body.translate(0, height / 2, 0);
  const cabin = new THREE.BoxGeometry(length * 0.12, height * 0.35, width * 0.95);
  cabin.translate(length * 0.44, height * 0.9, 0);
  const merged = mergeGeometries([body, cabin], false)!;
  merged.deleteAttribute('uv');
  return merged;
}

interface TransitInstance {
  kind: TransitKind;
  meshIndex: number;
  path: TransitPath;
  distance: number;
  dirSign: 1 | -1;
}

export interface TransitSystem {
  update(deltaSeconds: number): void;
  /** Voir TrafficSystem#setOpacity (src/traffic.ts) — même contrat. */
  setOpacity(value: number): void;
  dispose(): void;
}

const MAX_TRAMS = 2;
const MIN_TRANSIT_PATH_LENGTH_M = 150;

/**
 * Un train sur le plus long tronçon de voie ferrée, jusqu'à deux trams sur
 * les plus longs tronçons de voie de tram — pas de palier de zoom
 * "beaucoup plus" ici (contrairement aux voitures/piétons) : train et trams
 * restent en nombre fixe et discret, seul le fondu zoom existant s'applique
 * (voir setOpacity, piloté comme les voitures depuis main.ts).
 */
export function createTransit(
  railways: MapArea[],
  tramways: MapArea[],
  boundary: [number, number][],
  scene: THREE.Scene
): TransitSystem {
  const trainPaths = railways
    .map((r) => clipToBoundary(r, boundary))
    .filter((r): r is MapArea => r !== null)
    .map(buildCenterPath)
    .filter((p): p is TransitPath => p !== null && p.totalLength >= MIN_TRANSIT_PATH_LENGTH_M)
    .sort((a, b) => b.totalLength - a.totalLength)
    .slice(0, 1);
  const tramPaths = tramways
    .map((r) => clipToBoundary(r, boundary))
    .filter((r): r is MapArea => r !== null)
    .map(buildCenterPath)
    .filter((p): p is TransitPath => p !== null && p.totalLength >= MIN_TRANSIT_PATH_LENGTH_M)
    .sort((a, b) => b.totalLength - a.totalLength)
    .slice(0, 3);

  const group = new THREE.Group();
  group.name = 'transit';
  const instances: TransitInstance[] = [];
  const meshesByKind: Partial<Record<TransitKind, THREE.InstancedMesh>> = {};

  function spawnKind(kind: TransitKind, paths: TransitPath[], count: number) {
    if (!paths.length || count <= 0) return;
    const geom = buildVehicleGeometry(kind);
    const mesh = new THREE.InstancedMesh(geom, toonMaterial({ transparent: true }), count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const color = new THREE.Color(COLORS[kind]);
    for (let i = 0; i < count; i++) {
      mesh.setColorAt(i, color);
      const path = paths[i % paths.length];
      instances.push({
        kind,
        meshIndex: i,
        path,
        // Phase répartie le long du tronçon plutôt que toutes au même
        // endroit au chargement, surtout utile quand plusieurs trams
        // partagent le même tronçon (paths.length < count).
        distance: (path.totalLength * (i + 1)) / (count + 1),
        dirSign: i % 2 === 0 ? 1 : -1,
      });
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    meshesByKind[kind] = mesh;
  }

  spawnKind('train', trainPaths, trainPaths.length ? 1 : 0);
  spawnKind('tram', tramPaths, Math.min(MAX_TRAMS, tramPaths.length * 2));

  scene.add(group);

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _scale = new THREE.Vector3(1, 1, 1);
  const _up = new THREE.Vector3(0, 1, 0);

  let active = true;

  return {
    update(deltaSeconds: number) {
      if (!active || !instances.length) return;
      for (const inst of instances) {
        const speed = SPEED_MPS[inst.kind];
        inst.distance += inst.dirSign * speed * deltaSeconds;
        if (inst.distance <= 0) {
          inst.distance = 0;
          inst.dirSign = 1;
        } else if (inst.distance >= inst.path.totalLength) {
          inst.distance = inst.path.totalLength;
          inst.dirSign = -1;
        }
        const { pos, dir } = samplePath(inst.path, inst.distance);
        const heading = inst.dirSign > 0 ? dir : dir.clone().negate();
        // Même convention que src/traffic.ts : la géométrie pointe vers +X
        // au repos, voir le commentaire détaillé là-bas pour le signe.
        const angle = Math.atan2(-heading.y, heading.x);
        _q.setFromAxisAngle(_up, angle);
        _m.compose(new THREE.Vector3(pos.x, WORLD_Y[inst.kind], pos.y), _q, _scale);
        meshesByKind[inst.kind]?.setMatrixAt(inst.meshIndex, _m);
      }
      (Object.values(meshesByKind) as (THREE.InstancedMesh | undefined)[]).forEach((m) => {
        if (m) m.instanceMatrix.needsUpdate = true;
      });
    },
    setOpacity(value: number) {
      active = value > 0;
      group.visible = active;
      group.children.forEach((c) => {
        ((c as THREE.InstancedMesh).material as THREE.MeshToonMaterial).opacity = value;
      });
    },
    dispose() {
      scene.remove(group);
      group.children.forEach((c) => {
        const mesh = c as THREE.InstancedMesh;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
    },
  };
}
