import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MapRoad } from './mapData.ts';
import { ROAD_WIDTH_BY_TYPE, DEFAULT_ROAD_WIDTH } from './cityBuilder.ts';
import { pointInRing } from './quartiers.ts';
import { toonMaterial } from './toonShading.ts';

// Voitures animées, étape 2 du plan SimCity : suivent de vraies routes
// (data.roads), restent sur leur moitié de chaussée (décalage latéral, pas
// de données `oneway` dans ce jeu de données — voir le commentaire sur
// buildOffsetPath plus bas), jamais de simulation de trafic/collision
// (hors périmètre demandé : "rester discret"). Même famille technique que
// la végétation instanciée de cityBuilder.ts (InstancedMesh, matrices
// recomposées), mais ici la matrice change CHAQUE frame (position + cap),
// donc pas de réutilisation directe de buildInstancedBlobs (statique).

const VEHICLE_ROAD_TYPES = new Set([
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'living_street',
  'unclassified',
]);
const MIN_PATH_LENGTH_M = 20;
const LANE_MARGIN_M = 1.2; // marge entre l'axe de la voie et la trajectoire (reste sur SA moitié, pas au milieu)

interface VehiclePath {
  points: THREE.Vector2[]; // déjà décalés du bon côté, XZ monde
  cumDist: number[];
  totalLength: number;
}

// Décale les points d'une route vers un côté (+1 = "droite" en roulant de
// p[0] vers p[n], -1 = sens inverse) : normale moyenne entre segment
// entrant/sortant à chaque sommet intérieur (évite un angle cassé aux
// virages), même principe que le décalage des arbres d'alignement
// (STREET_TREE_SIDE_OFFSET_M) mais appliqué en continu le long d'un chemin
// parcouru par un véhicule, pas juste à des points isolés.
function buildOffsetPath(road: MapRoad, side: 1 | -1): VehiclePath | null {
  if (road.p.length < 2) return null;
  const raw = road.p.map(([x, y]) => new THREE.Vector2(x, -y));
  const halfWidth = (ROAD_WIDTH_BY_TYPE[road.hw] ?? DEFAULT_ROAD_WIDTH) / 2;
  const laneOffset = halfWidth * 0.5 + LANE_MARGIN_M;

  const normals: THREE.Vector2[] = raw.map((_, i) => {
    const prev = raw[Math.max(0, i - 1)];
    const next = raw[Math.min(raw.length - 1, i + 1)];
    const dir = new THREE.Vector2().subVectors(next, prev);
    if (dir.lengthSq() < 1e-8) dir.set(1, 0);
    dir.normalize();
    return new THREE.Vector2(-dir.y, dir.x);
  });

  const points = raw.map((p, i) => p.clone().addScaledVector(normals[i], laneOffset * side));
  const cumDist = [0];
  for (let i = 1; i < points.length; i++) {
    cumDist.push(cumDist[i - 1] + points[i].distanceTo(points[i - 1]));
  }
  const totalLength = cumDist[cumDist.length - 1];
  if (totalLength < MIN_PATH_LENGTH_M) return null;
  return { points, cumDist, totalLength };
}

function samplePath(path: VehiclePath, distance: number): { pos: THREE.Vector2; dir: THREE.Vector2 } {
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

// ===== Gabarits de véhicule : boîtes simples fusionnées, une seule couleur
// par instance (instanceColor, même mécanisme que les arbres) =====
type VehicleKind = 'car' | 'van' | 'bus';

function buildVehicleGeometry(kind: VehicleKind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (kind === 'bus') {
    const body = new THREE.BoxGeometry(7.2, 2.3, 2.3);
    body.translate(0, 1.15, 0);
    parts.push(body);
  } else {
    const bodyLen = kind === 'van' ? 4.4 : 3.7;
    const bodyH = kind === 'van' ? 1.9 : 1.3;
    const width = kind === 'van' ? 1.9 : 1.7;
    const body = new THREE.BoxGeometry(bodyLen, bodyH, width);
    body.translate(0, bodyH / 2, 0);
    parts.push(body);
    if (kind === 'car') {
      const cabin = new THREE.BoxGeometry(bodyLen * 0.5, 0.75, width * 0.85);
      cabin.translate(-bodyLen * 0.05, bodyH + 0.37, 0);
      parts.push(cabin);
    }
  }
  const merged = mergeGeometries(parts, false)!;
  merged.deleteAttribute('uv');
  return merged;
}

const VEHICLE_COLORS: Record<VehicleKind, number[]> = {
  car: [0xcc4b3f, 0x3f6fae, 0xe8d24a, 0xe8e4da, 0x4a9e6b],
  van: [0xe8e4da, 0xc9c2b2, 0x3f6fae],
  bus: [0xd8c23f, 0xe8e4da],
};

const VEHICLE_SPEED_MPS: Record<VehicleKind, number> = {
  car: 7,
  van: 6,
  bus: 5,
};

const VEHICLE_WORLD_Y = 0.35; // juste au-dessus de la chaussée (voir road y=0.1 dans cityBuilder)

interface CarInstance {
  kind: VehicleKind;
  meshIndex: number; // index d'instance dans l'InstancedMesh de son gabarit
  path: VehiclePath;
  distance: number;
  dirSign: 1 | -1;
}

export interface TrafficSystem {
  update(deltaSeconds: number): void;
  /**
   * 0 = invisible et simulation suspendue (zoom éloigné, voir src/lod.ts),
   * 1 = pleinement visible. Valeur intermédiaire pendant la transition en
   * fondu (pas de changement brutal, voir le plan).
   */
  setOpacity(value: number): void;
  dispose(): void;
}

const MAX_VEHICLES = 32;

/**
 * Construit le système de voitures, restreint aux routes du quartier
 * `zoneRingLocal` (polygone en mètres locaux, même repère que `roads` —
 * voir pointInRing dans src/quartiers.ts). Zone de pilotage initiale :
 * seules les routes touchant ce polygone reçoivent du trafic — lever la
 * restriction plus tard = passer le contour de toute la commune ici, pas de
 * réécriture (voir le plan).
 */
export function createTraffic(
  roads: MapRoad[],
  zoneRingLocal: [number, number][],
  scene: THREE.Scene,
  maxVehicles: number = MAX_VEHICLES
): TrafficSystem {
  const eligibleRoads = roads.filter(
    (r) => VEHICLE_ROAD_TYPES.has(r.hw) && r.p.some(([x, y]) => pointInRing(x, y, zoneRingLocal))
  );

  // Un chemin valide par route éligible (un seul côté construit par route
  // au hasard ; avec peu de voitures au total, pas besoin des deux côtés de
  // chaque route) ; routes trop courtes (buildOffsetPath -> null) écartées.
  const candidatePaths: VehiclePath[] = [];
  for (const road of eligibleRoads) {
    const side: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const path = buildOffsetPath(road, side);
    if (path) candidatePaths.push(path);
  }

  const group = new THREE.Group();
  group.name = 'traffic';
  const instances: CarInstance[] = [];
  const meshesByKind: Partial<Record<VehicleKind, THREE.InstancedMesh>> = {};

  if (candidatePaths.length) {
    const vehicleCount = Math.min(maxVehicles, candidatePaths.length);
    const kinds: VehicleKind[] = [];
    for (let i = 0; i < vehicleCount; i++) {
      // Surtout des citadines, quelques utilitaires, un bus tout au plus —
      // "rester discret" (demande explicite).
      const r = Math.random();
      kinds.push(r < 0.08 ? 'bus' : r < 0.3 ? 'van' : 'car');
    }

    const countByKind: Record<VehicleKind, number> = { car: 0, van: 0, bus: 0 };
    for (const k of kinds) countByKind[k]++;

    const nextIndexByKind: Record<VehicleKind, number> = { car: 0, van: 0, bus: 0 };
    (Object.keys(countByKind) as VehicleKind[]).forEach((kind) => {
      if (!countByKind[kind]) return;
      const geom = buildVehicleGeometry(kind);
      const mesh = new THREE.InstancedMesh(geom, toonMaterial({ transparent: true }), countByKind[kind]);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(mesh);
      meshesByKind[kind] = mesh;
    });

    const shuffled = [...candidatePaths].sort(() => Math.random() - 0.5);
    const color = new THREE.Color();
    for (let i = 0; i < vehicleCount; i++) {
      const kind = kinds[i];
      const mesh = meshesByKind[kind]!;
      const meshIndex = nextIndexByKind[kind]++;
      const path = shuffled[i % shuffled.length];
      const palette = VEHICLE_COLORS[kind];
      mesh.setColorAt(meshIndex, color.setHex(palette[Math.floor(Math.random() * palette.length)]));
      instances.push({
        kind,
        meshIndex,
        path,
        distance: Math.random() * path.totalLength,
        dirSign: Math.random() < 0.5 ? 1 : -1,
      });
    }
    (Object.values(meshesByKind) as THREE.InstancedMesh[]).forEach((m) => {
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }

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
        const speed = VEHICLE_SPEED_MPS[inst.kind];
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
        // La géométrie du véhicule pointe vers +X au repos (voir
        // buildVehicleGeometry, bodyLen le long de X) — avec une rotation Y
        // standard Three.js, +X devient (cosθ, -sinθ) en (x,z), d'où ce
        // signe précis pour que ça corresponde à `heading` (sinon la
        // voiture roule perpendiculairement à la route, bug signalé).
        const angle = Math.atan2(-heading.y, heading.x);
        _q.setFromAxisAngle(_up, angle);
        _m.compose(new THREE.Vector3(pos.x, VEHICLE_WORLD_Y, pos.y), _q, _scale);
        const mesh = meshesByKind[inst.kind];
        mesh?.setMatrixAt(inst.meshIndex, _m);
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
