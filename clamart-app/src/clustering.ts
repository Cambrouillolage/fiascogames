import type { IsoCameraRig } from './cameraRig.ts';

// Clustering "maison" plutôt qu'une bibliothèque de clustering géo classique
// (type supercluster) : ce projet n'a pas de fond de carte en tuiles, c'est
// une scène Three.js avec une caméra orthographique isométrique à azimut
// fixe (voir cameraRig.ts) — le clustering doit se faire en espace ÉCRAN
// (px), pas en distance "monde" brute, sinon deux points séparés surtout
// selon l'axe de profondeur de la caméra (fortement raccourci à l'écran en
// isométrique) seraient regroupés différemment de deux points séparés selon
// l'axe "droite", pour une même distance 3D. Avec seulement ~300 commerces,
// un algorithme glouton O(n²) en espace écran est largement assez rapide et
// beaucoup plus simple/fiable qu'une grille adaptative.

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

/** Identité stable d'un groupe de points (indépendante de l'ordre), pour reconnaître "le même cluster" d'un recalcul à l'autre (éventail, voir spiderfyPositions). */
export function clusterKey(memberIds: string[]): string {
  return [...memberIds].sort().join('|');
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

// Distance écran (px) en dessous de laquelle deux points sont considérés
// géographiquement confondus (même immeuble/mêmes coordonnées GPS) : aucun
// zoom, même maximal, ne les séparera jamais — il faut un éventail
// (spiderfy) plutôt que continuer à chercher un zoom de séparation.
const COINCIDENT_PX_AT_MAXZOOM = 3;

export interface SplitZoomResult {
  kind: 'zoom';
  worldX: number;
  worldZ: number;
  zoom: number;
}
export interface SpiderfyResult {
  kind: 'spiderfy';
}

/**
 * Calcule, pour un cluster cliqué, le zoom qui sépare ~la moitié de ses
 * membres (règle produit : "diviser par deux", pas un zoom fixe +1/+2).
 *
 * Principe : en projection orthographique à azimut fixe, zoomer multiplie
 * UNIFORMÉMENT toutes les distances écran par le même facteur (le zoom est
 * un simple facteur d'échelle de la caméra, voir IsoCameraRig#update). Donc
 * la distance écran actuelle de chaque membre au centre du cluster, triée,
 * donne directement — sans aucune simulation ni recherche itérative — le
 * facteur de zoom exact qui laisserait exactement N/2 membres dans le rayon
 * de cluster : on vise le membre classé au rang médian et on calcule le
 * facteur qui l'amène pile au bord du rayon.
 */
export function computeHalfSplitZoom<T extends ClusterPoint>(
  cluster: Cluster<T>,
  screenPositions: Map<string, ScreenPos>,
  rig: IsoCameraRig,
  pixelRadius: number
): SplitZoomResult | SpiderfyResult {
  const currentZoom = rig.currentZoom;
  const maxZoom = rig.maxZoomLevel;

  const clusterScreen = screenPositions.get(cluster.members[0].id)!; // seed = déjà un membre représentatif
  const distances = cluster.members
    .map((m) => {
      const pos = screenPositions.get(m.id)!;
      return Math.hypot(pos.x - clusterScreen.x, pos.y - clusterScreen.y);
    })
    .sort((a, b) => a - b);

  const half = Math.max(1, Math.ceil(distances.length / 2));
  const dHalf = distances[half - 1];

  if (dHalf <= 0) {
    // Tous les membres jusqu'au rang médian sont à la même position écran
    // (coordonnées confondues) : zoomer ne les séparera jamais.
    return { kind: 'spiderfy' };
  }

  let newZoom = currentZoom * (pixelRadius / dHalf);
  newZoom = Math.min(newZoom, maxZoom);

  // Si même le zoom maximum laisse les membres les plus proches à moins de
  // COINCIDENT_PX_AT_MAXZOOM d'écart, un zoom supplémentaire ne les
  // distinguera jamais (coordonnées quasi identiques) → éventail.
  const closestPairScreenDistAtMax = dHalf * (maxZoom / currentZoom);
  if (newZoom >= maxZoom && closestPairScreenDistAtMax < COINCIDENT_PX_AT_MAXZOOM) {
    return { kind: 'spiderfy' };
  }

  return { kind: 'zoom', worldX: cluster.worldX, worldZ: cluster.worldZ, zoom: Math.max(newZoom, currentZoom * 1.15) };
}

/**
 * Dispose les membres d'un cluster de coordonnées confondues en éventail
 * (petit cercle en mètres-monde autour du point commun), pour que chacun
 * reste cliquable individuellement même au zoom maximal. Rayon croissant
 * avec le nombre de membres pour rester lisible.
 */
export function spiderfyPositions(count: number, centerX: number, centerZ: number): { x: number; z: number }[] {
  const radius = 3 + Math.min(10, count * 0.6);
  const positions: { x: number; z: number }[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    positions.push({ x: centerX + Math.cos(angle) * radius, z: centerZ + Math.sin(angle) * radius });
  }
  return positions;
}
