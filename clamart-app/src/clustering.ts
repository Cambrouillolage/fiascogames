import type { IsoCameraRig } from './cameraRig.ts';

// Groupement "maison" en espace écran plutôt qu'une bibliothèque de
// clustering géo classique (type supercluster) : ce projet n'a pas de fond
// de carte en tuiles, c'est une scène Three.js avec une caméra orthographique
// isométrique à azimut fixe (voir cameraRig.ts) — le regroupement doit se
// faire en espace ÉCRAN (px), pas en distance "monde" brute, sinon deux
// points séparés surtout selon l'axe de profondeur de la caméra (fortement
// raccourci à l'écran en isométrique) seraient regroupés différemment de
// deux points séparés selon l'axe "droite", pour une même distance 3D. Avec
// seulement ~300 commerces, un algorithme glouton O(n²) en espace écran est
// largement assez rapide et beaucoup plus simple/fiable qu'une grille
// adaptative. Utilisé par src/pinDeclutter.ts pour détecter les badges qui
// se chevauchent encore à l'écran (pas pour les agréger en bulle — il n'y a
// plus d'agrégation, voir pinDeclutter.ts).

export interface ClusterPoint {
  id: string;
  worldX: number;
  worldZ: number;
}

export interface Cluster<T extends ClusterPoint> {
  members: T[];
  worldX: number;
  worldZ: number;
}

interface ScreenPos {
  x: number;
  y: number;
}

/** Regroupe `points` dont la distance écran est <= `pixelRadius`, glouton (premier arrivé = centre du groupe). */
export function clusterByScreen<T extends ClusterPoint>(
  points: T[],
  screenPositions: Map<string, ScreenPos>,
  pixelRadius: number
): Cluster<T>[] {
  const clusters: Cluster<T>[] = [];
  const visited = new Set<string>();

  for (const p of points) {
    if (visited.has(p.id)) continue;
    const seedPos = screenPositions.get(p.id)!;
    const members: T[] = [p];
    visited.add(p.id);

    for (const q of points) {
      if (visited.has(q.id)) continue;
      const qPos = screenPositions.get(q.id)!;
      const dx = qPos.x - seedPos.x;
      const dy = qPos.y - seedPos.y;
      if (Math.hypot(dx, dy) <= pixelRadius) {
        members.push(q);
        visited.add(q.id);
      }
    }

    const worldX = members.reduce((s, m) => s + m.worldX, 0) / members.length;
    const worldZ = members.reduce((s, m) => s + m.worldZ, 0) / members.length;
    clusters.push({ members, worldX, worldZ });
  }

  return clusters;
}

/** Projette chaque point à l'écran selon la caméra/viewport actuels — calculé une fois, réutilisé pour le clustering. */
export function projectAll<T extends ClusterPoint>(
  points: T[],
  rig: IsoCameraRig,
  worldY: number,
  viewportW: number,
  viewportH: number
): Map<string, ScreenPos> {
  const map = new Map<string, ScreenPos>();
  for (const p of points) {
    map.set(p.id, rig.worldToScreen(p.worldX, worldY, p.worldZ, viewportW, viewportH));
  }
  return map;
}

