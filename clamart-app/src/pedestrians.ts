import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MapRoad } from './mapData.ts';
import { ROAD_WIDTH_BY_TYPE, DEFAULT_ROAD_WIDTH } from './cityBuilder.ts';
import { pointInRing } from './quartiers.ts';
import { toonMaterial } from './toonShading.ts';

// Piétons animés, étape 3 du plan SimCity : même architecture que
// src/traffic.ts (chemin offsetté le long d'une route réelle, parcouru par
// distance d'arc, InstancedMesh + matrice réécrite chaque frame) — voir ce
// fichier pour les commentaires détaillés sur buildOffsetPath/samplePath,
// non dupliqués ici. Différences : décalage plus petit (bord de chaussée,
// pas voie de circulation), familles de voies différentes (trottoirs/voies
// piétonnes plausibles, pas les grands axes), et un léger balancement de
// marche procédural plutôt qu'une vraie animation squelettique.

const SIDEWALK_ROAD_TYPES = new Set(['residential', 'tertiary', 'living_street', 'pedestrian', 'footway']);
const MIN_PATH_LENGTH_M = 15;
const SIDEWALK_MARGIN_M = 1.4; // au-delà du bord de chaussée, pas dessus

interface WalkPath {
  points: THREE.Vector2[];
  cumDist: number[];
  totalLength: number;
}

function buildSidewalkPath(road: MapRoad, side: 1 | -1): WalkPath | null {
  if (road.p.length < 2) return null;
  const raw = road.p.map(([x, y]) => new THREE.Vector2(x, -y));
  const halfWidth = (ROAD_WIDTH_BY_TYPE[road.hw] ?? DEFAULT_ROAD_WIDTH) / 2;
  const offset = halfWidth + SIDEWALK_MARGIN_M;

  const normals: THREE.Vector2[] = raw.map((_, i) => {
    const prev = raw[Math.max(0, i - 1)];
    const next = raw[Math.min(raw.length - 1, i + 1)];
    const dir = new THREE.Vector2().subVectors(next, prev);
    if (dir.lengthSq() < 1e-8) dir.set(1, 0);
    dir.normalize();
    return new THREE.Vector2(-dir.y, dir.x);
  });

  const points = raw.map((p, i) => p.clone().addScaledVector(normals[i], offset * side));
  const cumDist = [0];
  for (let i = 1; i < points.length; i++) {
    cumDist.push(cumDist[i - 1] + points[i].distanceTo(points[i - 1]));
  }
  const totalLength = cumDist[cumDist.length - 1];
  if (totalLength < MIN_PATH_LENGTH_M) return null;
  return { points, cumDist, totalLength };
}

function samplePath(path: WalkPath, distance: number): { pos: THREE.Vector2; dir: THREE.Vector2 } {
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

// Silhouette minimaliste : un cylindre (corps) + une petite sphère (tête) —
// un seul InstancedMesh combinant les deux pour rester à 1 draw call quel
// que soit le nombre de piétons, comme les voitures. `setColorAt` teinte
// tout le mesh d'un coup (même mécanisme que les arbres troncs/feuillage
// combinés) : corps ET tête prennent la couleur de vêtement choisie, pas de
// teinte peau distincte — compromis assumé pour rester à 1 draw call par
// silhouette plutôt que d'ajouter un deuxième InstancedMesh pour si peu de
// triangles.
const BODY_HEIGHT = 1.3;
const HEAD_RADIUS = 0.22;

function buildPedestrianGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.22, 0.26, BODY_HEIGHT, 7);
  body.translate(0, BODY_HEIGHT / 2, 0);
  const head = new THREE.SphereGeometry(HEAD_RADIUS, 8, 6);
  head.translate(0, BODY_HEIGHT + HEAD_RADIUS * 0.9, 0);
  const merged = mergeGeometries([body, head], false)!;
  merged.deleteAttribute('uv');
  return merged;
}

const CLOTHING_COLORS = [0xd14f4f, 0x3f6fae, 0xe0b23f, 0x4a9e6b, 0x7a5ca8, 0xe8e4da, 0x3a3a3a];
const WALK_SPEED_MPS = 1.2;
const PEDESTRIAN_WORLD_Y = 0; // pieds au sol (le cylindre part de y=0, voir buildPedestrianGeometry)
const SWAY_AMPLITUDE_RAD = 0.09;
const SWAY_FREQUENCY_HZ = 1.8; // ~1.8 pas/s, rythme de marche plausible
const STATIC_FRACTION = 0.25; // quelques piétons immobiles (vitesse figée au spawn, 0 coût d'animation)

interface PedestrianInstance {
  meshIndex: number;
  path: WalkPath;
  distance: number;
  dirSign: 1 | -1;
  speed: number; // 0 = statique
  swayPhase: number;
}

export interface PedestrianSystem {
  update(deltaSeconds: number, elapsedSeconds: number): void;
  /** Voir TrafficSystem#setOpacity (src/traffic.ts) — même contrat. */
  setOpacity(value: number): void;
  dispose(): void;
}

const MAX_PEDESTRIANS = 28;

/**
 * Même principe de zone pilote que src/traffic.ts (voir ce fichier et le
 * plan) : restreint aux trottoirs touchant `zoneRingLocal`.
 */
export function createPedestrians(
  roads: MapRoad[],
  zoneRingLocal: [number, number][],
  scene: THREE.Scene,
  maxPedestrians: number = MAX_PEDESTRIANS
): PedestrianSystem {
  const eligibleRoads = roads.filter(
    (r) => SIDEWALK_ROAD_TYPES.has(r.hw) && r.p.some(([x, y]) => pointInRing(x, y, zoneRingLocal))
  );

  const candidatePaths: WalkPath[] = [];
  for (const road of eligibleRoads) {
    const side: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const path = buildSidewalkPath(road, side);
    if (path) candidatePaths.push(path);
  }

  const group = new THREE.Group();
  group.name = 'pedestrians';
  const instances: PedestrianInstance[] = [];

  if (candidatePaths.length) {
    const count = Math.min(maxPedestrians, candidatePaths.length * 2);
    const geom = buildPedestrianGeometry();
    const mesh = new THREE.InstancedMesh(geom, toonMaterial({ transparent: true }), count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);

    const shuffled = [...candidatePaths].sort(() => Math.random() - 0.5);
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const path = shuffled[i % shuffled.length];
      mesh.setColorAt(i, color.setHex(CLOTHING_COLORS[Math.floor(Math.random() * CLOTHING_COLORS.length)]));
      const isStatic = Math.random() < STATIC_FRACTION;
      instances.push({
        meshIndex: i,
        path,
        distance: Math.random() * path.totalLength,
        dirSign: Math.random() < 0.5 ? 1 : -1,
        speed: isStatic ? 0 : WALK_SPEED_MPS * (0.85 + Math.random() * 0.3),
        swayPhase: Math.random() * Math.PI * 2,
      });
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  scene.add(group);

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _sway = new THREE.Quaternion();
  const _scale = new THREE.Vector3(1, 1, 1);
  const _up = new THREE.Vector3(0, 1, 0);
  const _tilt = new THREE.Vector3(0, 0, 1);
  const mesh = group.children[0] as THREE.InstancedMesh | undefined;

  let active = true;

  return {
    update(deltaSeconds: number, elapsedSeconds: number) {
      if (!active || !instances.length || !mesh) return;
      for (const inst of instances) {
        if (inst.speed > 0) {
          inst.distance += inst.dirSign * inst.speed * deltaSeconds;
          if (inst.distance <= 0) {
            inst.distance = 0;
            inst.dirSign = 1;
          } else if (inst.distance >= inst.path.totalLength) {
            inst.distance = inst.path.totalLength;
            inst.dirSign = -1;
          }
        }
        const { pos, dir } = samplePath(inst.path, inst.distance);
        const heading = inst.dirSign > 0 ? dir : dir.clone().negate();
        // Même convention que src/traffic.ts (voir le commentaire là-bas) :
        // la silhouette pointe vers +X au repos.
        const angle = Math.atan2(-heading.y, heading.x);
        _q.setFromAxisAngle(_up, angle);
        if (inst.speed > 0) {
          // Léger tangage gauche-droite en marchant, rien à l'arrêt — un
          // oscillateur JS, pas un cycle de marche squelettique (coût nul).
          const swing = Math.sin(elapsedSeconds * SWAY_FREQUENCY_HZ * Math.PI * 2 + inst.swayPhase) * SWAY_AMPLITUDE_RAD;
          _sway.setFromAxisAngle(_tilt, swing);
          _q.multiply(_sway);
        }
        _m.compose(new THREE.Vector3(pos.x, PEDESTRIAN_WORLD_Y, pos.y), _q, _scale);
        mesh.setMatrixAt(inst.meshIndex, _m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    setOpacity(value: number) {
      active = value > 0;
      group.visible = active;
      if (mesh) (mesh.material as THREE.MeshToonMaterial).opacity = value;
    },
    dispose() {
      scene.remove(group);
      group.children.forEach((c) => {
        const m = c as THREE.InstancedMesh;
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
    },
  };
}
