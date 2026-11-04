import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuildingType, MapArea, MapData, MapLandmark, MapRoad } from './mapData.ts';
import { toonMaterial } from './toonShading.ts';
import { buildOutlineMesh } from './outline.ts';

// Étape 3 : style cartoon — MeshToonMaterial partout, contours noirs sur
// les bâtiments (expansion des faces arrière, voir outline.ts), gabarits
// procéduraux par type (toit à deux pans / plat selon le type, clocher
// pour l'église, drapeau pour la mairie), arbres "boules" dans les parcs.
//
// Convention de monde partagée par toute la scène : worldX = donnée.x
// (est), worldZ = -donnée.y (donnée.y = nord), worldY = hauteur. Voir
// `toXZ`.

function toXZ([x, y]: [number, number]): THREE.Vector2 {
  return new THREE.Vector2(x, -y);
}

function dedupeClosed(points: [number, number][]): [number, number][] {
  if (points.length < 2) return points;
  const [fx, fy] = points[0];
  const [lx, ly] = points[points.length - 1];
  if (Math.abs(fx - lx) < 1e-6 && Math.abs(fy - ly) < 1e-6) {
    return points.slice(0, -1);
  }
  return points;
}

function footprintCentroid(points: [number, number][]): [number, number] {
  let sx = 0;
  let sy = 0;
  for (const [x, y] of points) {
    sx += x;
    sy += y;
  }
  return [sx / points.length, sy / points.length];
}

function shrinkTowardCentroid(points: [number, number][], factor: number): [number, number][] {
  const [cx, cy] = footprintCentroid(points);
  return points.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor]);
}

function shapeFromFootprint(points: [number, number][]): THREE.Shape | null {
  const pts = dedupeClosed(points);
  if (pts.length < 3) return null;
  const shape = new THREE.Shape();
  const [x0, y0] = pts[0];
  shape.moveTo(x0, y0);
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i];
    shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

// mergeGeometries exige que toutes les géométries combinées soient
// cohérentes sur l'indexation (toutes indexées ou toutes non-indexées), en
// plus des mêmes attributs. Les géométries "builtin" (Extrude/Shape/
// Cylinder/Plane) sont indexées par défaut, alors que les pans de toit
// construits à la main ci-dessous ne le sont pas : on uniformise tout en
// non-indexé avant la moindre fusion.
function nonIndexed(geom: THREE.BufferGeometry): THREE.BufferGeometry {
  return geom.index ? geom.toNonIndexed() : geom;
}

function paintVertexColors(geom: THREE.BufferGeometry, color: THREE.Color) {
  const count = geom.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// Exportées : largeur de voirie réutilisée par src/traffic.ts et
// src/pedestrians.ts pour décaler voitures/piétons du bon côté de la route
// (même convention de largeur que le rendu de la route elle-même).
export const ROAD_WIDTH_BY_TYPE: Record<string, number> = {
  primary: 8,
  secondary: 6,
  tertiary: 5,
  residential: 5,
  living_street: 4.5,
  unclassified: 4.5,
  service: 3,
  pedestrian: 3,
  footway: 1.6,
  cycleway: 1.8,
  path: 1.2,
  steps: 1.2,
  track: 2.5,
};
export const DEFAULT_ROAD_WIDTH = 4;

function quadGeometry(a: THREE.Vector2, b: THREE.Vector2, width: number, y: number): THREE.BufferGeometry {
  const dir = new THREE.Vector2().subVectors(b, a);
  if (dir.lengthSq() < 1e-8) return new THREE.BufferGeometry();
  dir.normalize();
  const normal = new THREE.Vector2(-dir.y, dir.x).multiplyScalar(width / 2);

  const p0 = new THREE.Vector3(a.x + normal.x, y, a.y + normal.y);
  const p1 = new THREE.Vector3(a.x - normal.x, y, a.y - normal.y);
  const p2 = new THREE.Vector3(b.x - normal.x, y, b.y - normal.y);
  const p3 = new THREE.Vector3(b.x + normal.x, y, b.y + normal.y);

  // Ordre p0,p2,p1 / p0,p3,p2 (pas p0,p1,p2 / p0,p2,p3) : avec a->b et une
  // normale 2D (-dir.z, dir.x), l'ordre "naturel" donne une normale 3D
  // orientée vers le bas (vérifié par calcul) — donc invisible vue de
  // dessus avec le culling de face par défaut. On inverse l'ordre pour que
  // la normale pointe vers le haut.
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array([
    p0.x, p0.y, p0.z,
    p2.x, p2.y, p2.z,
    p1.x, p1.y, p1.z,
    p0.x, p0.y, p0.z,
    p3.x, p3.y, p3.z,
    p2.x, p2.y, p2.z,
  ]);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function buildRibbonMesh(items: MapRoad[], y: number, widthFor: (hw: string) => number, color: number): THREE.Mesh | null {
  const geoms: THREE.BufferGeometry[] = [];
  for (const item of items) {
    const width = widthFor(item.hw);
    for (let i = 0; i < item.p.length - 1; i++) {
      const a = toXZ(item.p[i]);
      const b = toXZ(item.p[i + 1]);
      geoms.push(quadGeometry(a, b, width, y));
    }
  }
  if (!geoms.length) return null;
  const merged = mergeGeometries(geoms, false);
  const material = toonMaterial({ color });
  return new THREE.Mesh(merged, material);
}

// Ligne centrale pointillée blanche — look "cartoon" simple, seulement sur
// les vraies routes (pas les trottoirs/chemins piétons/pistes cyclables).
// Réutilise `quadGeometry` (déjà vérifiée vue de dessus) pour chaque tiret.
const DASHED_ROAD_TYPES = new Set([
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'living_street',
  'unclassified',
]);
const DASH_LENGTH = 2.2;
const DASH_GAP = 2.2;
const DASH_WIDTH = 0.35;

function buildRoadDashes(roads: MapRoad[], y: number): THREE.Mesh | null {
  const geoms: THREE.BufferGeometry[] = [];
  for (const road of roads) {
    if (!DASHED_ROAD_TYPES.has(road.hw)) continue;
    let phase = 0; // continue le cycle tiret/espace d'un segment au suivant
    for (let i = 0; i < road.p.length - 1; i++) {
      const a = toXZ(road.p[i]);
      const b = toXZ(road.p[i + 1]);
      const segVec = new THREE.Vector2().subVectors(b, a);
      const segLen = segVec.length();
      if (segLen < 1e-6) continue;
      const dir = segVec.clone().normalize();
      const cycle = DASH_LENGTH + DASH_GAP;
      let dist = 0;
      // `step` doit toujours avancer d'un minimum non nul : un résidu
      // flottant (`remainingInPhase` ou `segLen - dist` quasi nul mais pas
      // nul) sinon bloque la boucle quasi indéfiniment sur certains
      // segments — déjà rencontré (page qui semblait figée au chargement).
      let guard = 0;
      while (dist < segLen && guard < 100000) {
        guard++;
        const posInCycle = phase % cycle;
        const isDash = posInCycle < DASH_LENGTH;
        const remainingInPhase = isDash ? DASH_LENGTH - posInCycle : cycle - posInCycle;
        const step = Math.max(1e-3, Math.min(remainingInPhase, segLen - dist));
        if (isDash && step > 0.05) {
          const p0 = a.clone().addScaledVector(dir, dist);
          const p1 = a.clone().addScaledVector(dir, dist + step);
          geoms.push(quadGeometry(p0, p1, DASH_WIDTH, y));
        }
        dist += step;
        phase += step;
      }
    }
  }
  if (!geoms.length) return null;
  const merged = mergeGeometries(geoms, false);
  const material = toonMaterial({ color: 0xf7f2e4 }); // blanc cassé chaud plutôt que blanc pur, cohérent avec la palette adoucie
  return new THREE.Mesh(merged, material);
}

function areaShapeGeometry(points: [number, number][], y: number): THREE.BufferGeometry | null {
  const pts = dedupeClosed(points);
  if (pts.length < 3) return null;
  const shape = new THREE.Shape();
  const [x0, y0] = toXZ(pts[0]);
  shape.moveTo(x0, y0);
  for (let i = 1; i < pts.length; i++) {
    const [x, z] = toXZ(pts[i]);
    shape.lineTo(x, z);
  }
  shape.closePath();
  const geom = nonIndexed(new THREE.ShapeGeometry(shape));
  geom.deleteAttribute('uv');
  const pos = geom.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    pos.setXYZ(i, vx, y, vy);
  }
  geom.computeVertexNormals();
  return geom;
}

function buildAreaMesh(items: MapArea[], y: number, color: number): THREE.Mesh | null {
  const geoms: THREE.BufferGeometry[] = [];
  for (const item of items) {
    const geom = areaShapeGeometry(item.p, y);
    if (geom) geoms.push(geom);
  }
  if (!geoms.length) return null;
  const merged = mergeGeometries(geoms, false);
  const material = toonMaterial({ color, side: THREE.DoubleSide });
  return new THREE.Mesh(merged, material);
}

// ===== Bâtiments : gabarits procéduraux par type =====
// Les murs montent jusqu'à `wallFraction * hauteur totale`, le toit
// (un "frustum" : copie rétrécie du contour, reliée par des pans
// inclinés, avec un plafond plat) occupe le reste. `shrink` contrôle à
// quel point le toit se resserre — plus petit = plus pentu/pointu.
interface RoofParams {
  wallFraction: number;
  shrink: number;
  roofColor: number;
}
// church/school/townhall : bâtiments officiels non-commerçants, gabarit
// "carré" demandé (wallFraction=1, shrink=1 = murs jusqu'en haut, toit plat
// de même contour que les murs = simple bloc rectangulaire), pour bien les
// distinguer visuellement des maisons/immeubles/commerces à toit pentu.
const ROOF_PARAMS: Record<BuildingType, RoofParams> = {
  house: { wallFraction: 0.62, shrink: 0.5, roofColor: 0xa8553a }, // terre cuite conservée telle quelle (demande explicite)
  apartment: { wallFraction: 0.94, shrink: 0.9, roofColor: 0x9c9080 }, // réchauffé (était un gris froid plat 0x8d8d86)
  commerce: { wallFraction: 0.84, shrink: 0.82, roofColor: 0x6e6659 },
  church: { wallFraction: 1, shrink: 1, roofColor: 0x463a5c },
  mosque: { wallFraction: 1, shrink: 1, roofColor: 0x8a7550 }, // toit plat, le dôme (buildMosqueDome) vient par-dessus
  school: { wallFraction: 1, shrink: 1, roofColor: 0x3f6b74 },
  townhall: { wallFraction: 1, shrink: 1, roofColor: 0x7a3f3f },
  police: { wallFraction: 1, shrink: 1, roofColor: 0x3f5068 },
  fire_station: { wallFraction: 1, shrink: 1, roofColor: 0x8a2f2f },
};

const WALL_COLOR_BY_TYPE: Record<BuildingType, number> = {
  house: 0xe6d6b2,
  apartment: 0xd6ccba, // greige chaud (était un gris plus froid 0xcfc6b8) — "immeubles moins sévères"
  commerce: 0xe0a35c,
  church: 0xcbbfe0,
  mosque: 0xe8d9b5, // pierre chaude, distincte de l'église (violet) et de la mairie (rose)
  school: 0xb9dbe3,
  townhall: 0xe3b0b0,
  police: 0xb7c4d6,
  fire_station: 0xe3c9a0,
};

// Variation légère de teinte/luminosité par bâtiment (murs uniquement) pour
// éviter l'effet "un seul bloc monotone" sur les maisons/immeubles/commerces
// — règle produit explicite. Les bâtiments civics (église/école/mairie), peu
// nombreux et déjà pensés comme des repères visuels distincts, gardent leur
// teinte exacte de type.
const JITTERED_WALL_TYPES = new Set<BuildingType>(['house', 'apartment', 'commerce']);
const WALL_HUE_JITTER_DEG = 5;
const WALL_LIGHTNESS_JITTER = 0.045;

function jitterColor(hex: number, lightnessJitter: number, hueJitterDeg: number): THREE.Color {
  const color = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  const dh = ((Math.random() - 0.5) * 2 * hueJitterDeg) / 360;
  const dl = (Math.random() - 0.5) * 2 * lightnessJitter;
  color.setHSL((hsl.h + dh + 1) % 1, hsl.s, THREE.MathUtils.clamp(hsl.l + dl, 0, 1));
  return color;
}

// ===== Détails de façade (porte/fenêtres) pour maisons et immeubles =====
// Le sens de sortie (normale) d'une arête de contour n'est pas fiable
// (dépend de l'ordre OSM, pas garanti CW/CCW) : on le déduit en comparant
// au centroïde (la normale "sort" toujours à l'opposé du centre du
// bâtiment), robuste quel que soit le sens d'origine.
function edgeOutwardNormal(
  centroid: [number, number],
  a: [number, number],
  b: [number, number]
): [number, number] {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const len = Math.hypot(ex, ey) || 1;
  const dx = ex / len;
  const dy = ey / len;
  let nx = -dy;
  let ny = dx;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  if (nx * (centroid[0] - mx) + ny * (centroid[1] - my) > 0) {
    nx = -nx;
    ny = -ny;
  }
  return [nx, ny];
}

// Construit un quad dont on ne connaît pas le sens à l'avance (contrairement
// aux pans de toit) : on le fabrique dans un ordre arbitraire puis on
// compare sa normale réelle à la normale voulue, et on inverse si besoin.
// Plus robuste que de re-dériver le bon ordre à la main à chaque fois.
function orientedQuad(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  p3: THREE.Vector3,
  desiredNormal: THREE.Vector3,
  color: THREE.Color
): THREE.BufferGeometry {
  const e1 = new THREE.Vector3().subVectors(p1, p0);
  const e2 = new THREE.Vector3().subVectors(p2, p0);
  const n = new THREE.Vector3().crossVectors(e1, e2);
  const flip = n.dot(desiredNormal) < 0;
  const order = flip ? [p0, p2, p1, p0, p3, p2] : [p0, p1, p2, p0, p2, p3];
  const positions = new Float32Array(18);
  order.forEach((p, i) => {
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
  });
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  paintVertexColors(geom, color);
  return geom;
}

// Un quad "collé" à une façade (porte/fenêtre), légèrement décalé vers
// l'extérieur pour ne pas se confondre avec le mur (évite le z-fighting).
function facadeQuad(
  a: [number, number],
  b: [number, number],
  outward: [number, number],
  tAlongEdge: number,
  widthM: number,
  y0: number,
  y1: number,
  offset: number,
  color: THREE.Color
): THREE.BufferGeometry | null {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const edgeLen = Math.hypot(ex, ey);
  if (edgeLen < widthM + 0.3 || y1 <= y0) return null;
  const dx = ex / edgeLen;
  const dy = ey / edgeLen;
  const cx = a[0] + ex * tAlongEdge + outward[0] * offset;
  const cy = a[1] + ey * tAlongEdge + outward[1] * offset;
  const halfW = widthM / 2;
  const lx = cx - dx * halfW;
  const ly = cy - dy * halfW;
  const rx = cx + dx * halfW;
  const ry = cy + dy * halfW;
  const p0 = new THREE.Vector3(lx, y0, -ly);
  const p1 = new THREE.Vector3(rx, y0, -ry);
  const p2 = new THREE.Vector3(rx, y1, -ry);
  const p3 = new THREE.Vector3(lx, y1, -ly);
  const desiredNormal = new THREE.Vector3(outward[0], 0, -outward[1]).normalize();
  return orientedQuad(p0, p1, p2, p3, desiredNormal, color);
}

const DOOR_COLOR = new THREE.Color(0x5a3c28);
const GLASS_COLOR_HOUSE = new THREE.Color(0xbfe6ef);
const GLASS_COLOR_APARTMENT = new THREE.Color(0xa9d6e5);

// Maison : une porte + 2 fenêtres sur la plus longue arête (sert de
// "façade avant"). Volontairement minimal (x9361 dans cette zone).
function buildHouseDetails(pts: [number, number][], wallH: number): THREE.BufferGeometry[] {
  const centroid = footprintCentroid(pts);
  const n = pts.length;
  let longestIdx = 0;
  let longestLen = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > longestLen) {
      longestLen = len;
      longestIdx = i;
    }
  }
  const a = pts[longestIdx];
  const b = pts[(longestIdx + 1) % n];
  const outward = edgeOutwardNormal(centroid, a, b);
  const geoms: THREE.BufferGeometry[] = [];

  const door = facadeQuad(a, b, outward, 0.5, 1.0, 0, Math.min(wallH * 0.55, 2.2), 0.06, DOOR_COLOR);
  if (door) geoms.push(door);

  const winY0 = wallH * 0.4;
  const winY1 = Math.min(wallH * 0.85, winY0 + 1.1);
  const win1 = facadeQuad(a, b, outward, 0.2, 0.8, winY0, winY1, 0.06, GLASS_COLOR_HOUSE);
  if (win1) geoms.push(win1);
  const win2 = facadeQuad(a, b, outward, 0.8, 0.8, winY0, winY1, 0.06, GLASS_COLOR_HOUSE);
  if (win2) geoms.push(win2);

  return geoms;
}

// Immeuble : grille de fenêtres sur chaque arête assez longue, nombre de
// rangées calé sur la hauteur (≈ nb d'étages).
function buildApartmentDetails(pts: [number, number][], wallH: number): THREE.BufferGeometry[] {
  const centroid = footprintCentroid(pts);
  const n = pts.length;
  const geoms: THREE.BufferGeometry[] = [];
  const rows = Math.max(2, Math.min(6, Math.round(wallH / 3)));
  const rowH = wallH / (rows + 0.6);

  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 3) continue;
    const outward = edgeOutwardNormal(centroid, a, b);
    const cols = Math.max(1, Math.min(6, Math.floor(len / 3)));
    const winWidth = Math.min(1.1, (len / cols) * 0.6);
    for (let r = 0; r < rows; r++) {
      const y0 = rowH * 0.35 + r * rowH;
      const y1 = y0 + rowH * 0.55;
      for (let c = 0; c < cols; c++) {
        const t = (c + 0.5) / cols;
        const q = facadeQuad(a, b, outward, t, winWidth, y0, y1, 0.07, GLASS_COLOR_APARTMENT);
        if (q) geoms.push(q);
      }
    }
  }
  return geoms;
}

function buildProceduralBuilding(
  footprint: [number, number][],
  type: BuildingType,
  totalHeight: number
): THREE.BufferGeometry | null {
  const pts = dedupeClosed(footprint);
  if (pts.length < 3) return null;
  const { wallFraction, shrink, roofColor } = ROOF_PARAMS[type];
  const wallH = totalHeight * wallFraction;
  const roofH = totalHeight - wallH;

  // --- Murs : extrusion standard, orientée debout ---
  const shape = shapeFromFootprint(pts);
  if (!shape) return null;
  const wallsGeom = nonIndexed(new THREE.ExtrudeGeometry(shape, { depth: wallH, bevelEnabled: false }));
  wallsGeom.rotateX(-Math.PI / 2);
  wallsGeom.deleteAttribute('uv'); // pas de texture ; doit matcher les attributs des pans de toit pour mergeGeometries
  const wallColor = JITTERED_WALL_TYPES.has(type)
    ? jitterColor(WALL_COLOR_BY_TYPE[type], WALL_LIGHTNESS_JITTER, WALL_HUE_JITTER_DEG)
    : new THREE.Color(WALL_COLOR_BY_TYPE[type]);
  paintVertexColors(wallsGeom, wallColor);

  // --- Toit : frustum (contour rétréci relié par des pans), + plafond plat ---
  const shrunk = shrinkTowardCentroid(pts, shrink);
  const roofGeoms: THREE.BufferGeometry[] = [];
  const n = pts.length;
  const roofColorObj = new THREE.Color(roofColor);
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const sa = shrunk[i];
    const sb = shrunk[(i + 1) % n];
    // DoubleSide sur le matériau du toit : on ne reprend pas le calcul de
    // sens de triangles (coûteux en temps) pour ces petits quads, un
    // rendu double-face est négligeable à cette échelle.
    const positions = new Float32Array([
      a[0], wallH, -a[1],
      b[0], wallH, -b[1],
      sb[0], wallH + roofH, -sb[1],
      a[0], wallH, -a[1],
      sb[0], wallH + roofH, -sb[1],
      sa[0], wallH + roofH, -sa[1],
    ]);
    const slopeGeom = new THREE.BufferGeometry();
    slopeGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    slopeGeom.computeVertexNormals();
    paintVertexColors(slopeGeom, roofColorObj);
    roofGeoms.push(slopeGeom);
  }
  const capGeom = areaShapeGeometryLocal(shrunk, wallH + roofH);
  if (capGeom) {
    paintVertexColors(capGeom, roofColorObj);
    roofGeoms.push(capGeom);
  }

  // --- Détails de façade : maison/immeuble (porte/fenêtres, demande
  // explicite d'origine) + les 5 catégories de bâtiments publics (mairie,
  // écoles, églises, mosquée, casernes, commissariats — demande SimCity) ---
  let detailGeoms: THREE.BufferGeometry[] = [];
  if (type === 'house') {
    detailGeoms = buildHouseDetails(pts, wallH);
  } else if (type === 'apartment' || type === 'school') {
    // École : même bande de fenêtres que les immeubles (réutilisée telle
    // quelle), juste sur un gabarit bloc avec sa propre couleur de façade.
    detailGeoms = buildApartmentDetails(pts, wallH);
  } else if (type === 'church') {
    detailGeoms = buildChurchWindows(pts, wallH);
  } else if (type === 'fire_station') {
    detailGeoms = buildFireStationDoors(pts, wallH);
  } else if (type === 'townhall') {
    const steps = buildTownhallSteps(pts);
    if (steps) detailGeoms = [steps];
  }

  return mergeGeometries([wallsGeom, ...roofGeoms, ...detailGeoms], false);
}

// Variante locale de `areaShapeGeometry` : prend des points déjà en
// mètres locaux (x,y) sans repasser par `toXZ` (déjà fait en amont pour
// les murs/toit d'un même bâtiment).
function areaShapeGeometryLocal(points: [number, number][], y: number): THREE.BufferGeometry | null {
  if (points.length < 3) return null;
  const shape = new THREE.Shape();
  // Pas de négation ici (contrairement à avant) : on reproduit la même
  // transformation que `rotateX(-PI/2)` sur les murs (x,y,0)->(x,0,-y), en
  // négateant seulement au moment du remap ci-dessous. Négater à la
  // construction du Shape PUIS remapper sans re-négater revenait, une fois
  // décomposé, à une réflexion (pas une rotation) : même position finale,
  // mais normale inversée -> toit invisible de dessus (culling), et le
  // dessous noir du mesh de contour prenait sa place.
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    shape.lineTo(points[i][0], points[i][1]);
  }
  shape.closePath();
  const geom = nonIndexed(new THREE.ShapeGeometry(shape));
  geom.deleteAttribute('uv');
  const pos = geom.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    pos.setXYZ(i, vx, y, -vy);
  }
  geom.computeVertexNormals();
  return geom;
}

// Petits éléments distinctifs pour les bâtiments civics (spec : "un
// modèle reconnaissable chacun"). Fusionnés dans un mesh à part (peu
// d'instances : 1 mairie, 3 églises dans cette zone).
function buildChurchSpire(footprint: [number, number][], totalHeight: number): THREE.BufferGeometry {
  const [cx, cy] = footprintCentroid(dedupeClosed(footprint));
  const base = totalHeight * 0.95;
  const top = totalHeight + totalHeight * 0.55;
  const half = 1.6;
  const square = (s: number): [number, number][] => [
    [cx - s, cy - s],
    [cx + s, cy - s],
    [cx + s, cy + s],
    [cx - s, cy + s],
  ];
  const bodyBottom = square(half);
  const bodyTop = square(half * 0.95);
  const geoms: THREE.BufferGeometry[] = [];
  const n = 4;
  for (let i = 0; i < n; i++) {
    const a = bodyBottom[i];
    const b = bodyBottom[(i + 1) % n];
    const sa = bodyTop[i];
    const sb = bodyTop[(i + 1) % n];
    const positions = new Float32Array([
      a[0], base, -a[1],
      b[0], base, -b[1],
      sb[0], top * 0.8, -sb[1],
      a[0], base, -a[1],
      sb[0], top * 0.8, -sb[1],
      sa[0], top * 0.8, -sa[1],
    ]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.computeVertexNormals();
    geoms.push(g);
  }
  // pointe
  const tip: [number, number, number] = [cx, top, -cy];
  const apex: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const a = bodyTop[i];
    const b = bodyTop[(i + 1) % n];
    const positions = new Float32Array([
      a[0], top * 0.8, -a[1],
      b[0], top * 0.8, -b[1],
      tip[0], tip[1], tip[2],
    ]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.computeVertexNormals();
    apex.push(g);
  }
  return mergeGeometries([...geoms, ...apex], false)!;
}

function buildFlagpole(footprint: [number, number][], totalHeight: number): THREE.BufferGeometry {
  const pts = dedupeClosed(footprint);
  const [cx, cy] = footprintCentroid(pts);
  // Posé près d'un bord plutôt qu'en plein centre du toit.
  const px = pts[0][0] * 0.3 + cx * 0.7;
  const py = pts[0][1] * 0.3 + cy * 0.7;
  const poleBase = totalHeight * 0.9;
  const poleTop = totalHeight + totalHeight * 0.5;
  const poleGeom = nonIndexed(new THREE.CylinderGeometry(0.25, 0.3, poleTop - poleBase, 6));
  poleGeom.translate(px, (poleBase + poleTop) / 2, -py);
  poleGeom.deleteAttribute('uv'); // doit matcher le clocher (sans uv) pour mergeGeometries

  const flagGeom = nonIndexed(new THREE.PlaneGeometry(3.2, 1.8));
  flagGeom.translate(1.7, 0, 0);
  flagGeom.rotateY(Math.PI / 2);
  flagGeom.translate(px, poleTop - 1.2, -py);
  flagGeom.deleteAttribute('uv');

  return mergeGeometries([poleGeom, flagGeom], false)!;
}

// Mosquée : dôme (demi-sphère posée sur le toit plat) + minaret excentré
// vers un coin du bâtiment (même principe que buildFlagpole). Traitement
// générique assumé (aucune source fiable trouvée décrivant l'architecture
// réelle de la mosquée de Clamart — ni base Mérimée, ni inventaire IDF),
// couleur pierre chaude distincte des autres civics (église/mairie/école).
function buildMosqueDome(footprint: [number, number][], totalHeight: number): THREE.BufferGeometry {
  const pts = dedupeClosed(footprint);
  const [cx, cy] = footprintCentroid(pts);
  const { minX, maxX, minY, maxY } = polygonBBox(pts);
  const radius = Math.max(2, Math.min(maxX - minX, maxY - minY) * 0.28);

  const domeGeom = nonIndexed(new THREE.SphereGeometry(radius, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2));
  domeGeom.translate(cx, totalHeight, -cy);
  domeGeom.deleteAttribute('uv');

  const mx = pts[0][0] * 0.25 + cx * 0.75;
  const my = pts[0][1] * 0.25 + cy * 0.75;
  const towerH = totalHeight * 1.6;
  const towerGeom = nonIndexed(new THREE.CylinderGeometry(0.9, 1.1, towerH, 8));
  towerGeom.translate(mx, towerH / 2, -my);
  towerGeom.deleteAttribute('uv');

  const capGeom = nonIndexed(new THREE.ConeGeometry(1.3, 2.2, 8));
  capGeom.translate(mx, towerH + 1.1, -my);
  capGeom.deleteAttribute('uv');

  return mergeGeometries([domeGeom, towerGeom, capGeom], false)!;
}

// Caserne de pompiers : 2 portes de garage sombres sur la plus longue
// façade (même technique que buildHouseDetails/buildApartmentDetails —
// quads orientés vers l'extérieur), fusionnées dans le mesh PRINCIPAL
// (elles ont déjà leurs propres couleurs par sommet, comme porte/fenêtres
// de maison) plutôt que le mesh civic.
const GARAGE_DOOR_COLOR = new THREE.Color(0x2b2b2b);

function buildFireStationDoors(pts: [number, number][], wallH: number): THREE.BufferGeometry[] {
  const centroid = footprintCentroid(pts);
  const n = pts.length;
  let longestIdx = 0;
  let longestLen = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > longestLen) {
      longestLen = len;
      longestIdx = i;
    }
  }
  const a = pts[longestIdx];
  const b = pts[(longestIdx + 1) % n];
  const outward = edgeOutwardNormal(centroid, a, b);
  const doorH = Math.min(wallH * 0.78, 4.4);
  const doorW = Math.min(longestLen * 0.28, 3.6);
  const geoms: THREE.BufferGeometry[] = [];
  const door1 = facadeQuad(a, b, outward, 0.32, doorW, 0, doorH, 0.07, GARAGE_DOOR_COLOR);
  if (door1) geoms.push(door1);
  const door2 = facadeQuad(a, b, outward, 0.68, doorW, 0, doorH, 0.07, GARAGE_DOOR_COLOR);
  if (door2) geoms.push(door2);
  return geoms;
}

// Petit camion de pompier STATIQUE (boîtes simples), posé devant la
// caserne — aucune animation, coût identique à n'importe quel autre détail
// civic fusionné dans le même mesh (clocher, drapeau...).
const TRUCK_RED = new THREE.Color(0xb23a2e);
const TRUCK_CAB = new THREE.Color(0xe8e4da);

function buildFireTruck(footprint: [number, number][]): THREE.BufferGeometry {
  const pts = dedupeClosed(footprint);
  const centroid = footprintCentroid(pts);
  const a = pts[0];
  const b = pts[1 % pts.length];
  const outward = edgeOutwardNormal(centroid, a, b);
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const standoff = 7; // devant la façade, pas collé au mur
  const tx = mx + outward[0] * standoff;
  const ty = my + outward[1] * standoff;
  const angle = Math.atan2(outward[1], outward[0]);

  const bodyGeom = nonIndexed(new THREE.BoxGeometry(5.2, 2.2, 2.1));
  paintVertexColors(bodyGeom, TRUCK_RED);
  bodyGeom.translate(0, 1.1, 0);

  const cabGeom = nonIndexed(new THREE.BoxGeometry(1.8, 1.8, 2.1));
  paintVertexColors(cabGeom, TRUCK_CAB);
  cabGeom.translate(1.9, 1.9, 0);

  const merged = mergeGeometries([bodyGeom, cabGeom], false)!;
  merged.rotateY(-angle);
  merged.translate(tx, 0, -ty);
  merged.deleteAttribute('uv');
  return merged;
}

// Église : vitraux colorés sur la plus longue façade (même technique que
// les fenêtres de maison/immeuble), palette "vitrail" plutôt que le bleu
// vitré des fenêtres résidentielles.
const STAINED_GLASS_COLORS = [0x7a5ca8, 0xc46b4e, 0x4e8ab0];

function buildChurchWindows(pts: [number, number][], wallH: number): THREE.BufferGeometry[] {
  const centroid = footprintCentroid(pts);
  const n = pts.length;
  let longestIdx = 0;
  let longestLen = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > longestLen) {
      longestLen = len;
      longestIdx = i;
    }
  }
  const a = pts[longestIdx];
  const b = pts[(longestIdx + 1) % n];
  const outward = edgeOutwardNormal(centroid, a, b);
  const count = Math.max(1, Math.min(3, Math.floor(longestLen / 6)));
  const winH = Math.min(wallH * 0.5, 3.2);
  const geoms: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const color = new THREE.Color(STAINED_GLASS_COLORS[i % STAINED_GLASS_COLORS.length]);
    const win = facadeQuad(a, b, outward, t, 0.9, wallH * 0.3, wallH * 0.3 + winH, 0.06, color);
    if (win) geoms.push(win);
  }
  return geoms;
}

// Mairie : léger perron devant l'entrée (une marche basse, même technique
// de quad orienté) — reste discret, le gabarit bloc + drapeau fait déjà
// l'essentiel de la distinction visuelle.
const STEP_COLOR = new THREE.Color(0xd8d2c4);

function buildTownhallSteps(pts: [number, number][]): THREE.BufferGeometry | null {
  const centroid = footprintCentroid(pts);
  const n = pts.length;
  let longestIdx = 0;
  let longestLen = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > longestLen) {
      longestLen = len;
      longestIdx = i;
    }
  }
  const a = pts[longestIdx];
  const b = pts[(longestIdx + 1) % n];
  const outward = edgeOutwardNormal(centroid, a, b);
  const mx = (a[0] + b[0]) / 2 + outward[0] * 1.2;
  const my = (a[1] + b[1]) / 2 + outward[1] * 1.2;
  const stepW = Math.min(longestLen * 0.25, 6);
  const stepGeom = nonIndexed(new THREE.BoxGeometry(stepW, 0.4, 2.4));
  paintVertexColors(stepGeom, STEP_COLOR);
  const angle = Math.atan2(outward[1], outward[0]);
  stepGeom.rotateY(-angle);
  stepGeom.translate(mx, 0.2, -my);
  stepGeom.deleteAttribute('uv');
  return stepGeom;
}

function buildBuildingsMesh(data: MapData): { main: THREE.Mesh | null; civic: THREE.Mesh | null; outline: THREE.Mesh | null } {
  const mainGeoms: THREE.BufferGeometry[] = [];
  const civicGeoms: THREE.BufferGeometry[] = [];

  for (const b of data.buildings) {
    const geom = buildProceduralBuilding(b.f, b.t, b.h);
    if (!geom) continue;
    mainGeoms.push(geom);

    if (b.t === 'church') {
      civicGeoms.push(paintColored(buildChurchSpire(b.f, b.h), 0x2e2740));
    } else if (b.t === 'townhall') {
      const pole = buildFlagpole(b.f, b.h);
      civicGeoms.push(paintColored(pole, 0xdedede));
    } else if (b.t === 'mosque') {
      civicGeoms.push(paintColored(buildMosqueDome(b.f, b.h), 0xcdb46a));
    } else if (b.t === 'police') {
      const pole = buildFlagpole(b.f, b.h);
      civicGeoms.push(paintColored(pole, 0x2c5f99));
    } else if (b.t === 'fire_station') {
      civicGeoms.push(buildFireTruck(b.f)); // déjà coloré par sommet (voir buildFireTruck)
    }
  }

  const mainMerged = mainGeoms.length ? mergeGeometries(mainGeoms, false) : null;
  const civicMerged = civicGeoms.length ? mergeGeometries(civicGeoms, false) : null;

  const main = mainMerged
    ? new THREE.Mesh(mainMerged, toonMaterial({ vertexColors: true }))
    : null;
  const civic = civicMerged
    ? new THREE.Mesh(civicMerged, toonMaterial({ vertexColors: true }))
    : null;
  const outline = mainMerged ? buildOutlineMesh(mainMerged, 0.12) : null;

  return { main, civic, outline };
}

function paintColored(geom: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  paintVertexColors(geom, new THREE.Color(color));
  return geom;
}

// ===== Végétation (arbres + buissons, InstancedMesh) =====
// Ville plus vivante, moins vide visuellement (règle produit) : des arbres
// en petits GROUPES dans les parcs (pas un semis uniforme — on veut lire
// "quelques arbres rassemblés", pas une distribution régulière artificielle),
// le long de certaines rues (résidentielles/secondaires, pas sur les grands
// axes ni les chemins piétons), et autour des lieux emblématiques (sauf les
// parkings, où des arbres au milieu du bitume n'auraient pas de sens). Des
// buissons, plus petits et plus denses, complètent les parcs comme un sous-
// bois léger. Tout reste en InstancedMesh (2 mesh pour les arbres + 1 pour
// les buissons, quel que soit le nombre d'instances) : coût de rendu
// négligeable même avec plusieurs centaines d'éléments.
function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polygonBBox(poly: [number, number][]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

// Quelques foyers de végétation par polygone (pas un point par foyer isolé),
// puis quelques éléments dispersés autour de chaque foyer — lit comme "des
// petits groupes d'arbres", pas comme une grille/un semis régulier.
function clusteredScatterInPolygon(
  poly: [number, number][],
  targetCount: number,
  clusterRadiusM: number
): [number, number][] {
  if (targetCount <= 0) return [];
  const { minX, maxX, minY, maxY } = polygonBBox(poly);
  const clusterCount = Math.max(1, Math.round(targetCount / 4));
  const centers: [number, number][] = [];
  let attempts = 0;
  while (centers.length < clusterCount && attempts < clusterCount * 30) {
    attempts++;
    const x = minX + Math.random() * (maxX - minX);
    const y = minY + Math.random() * (maxY - minY);
    if (pointInPolygon(x, y, poly)) centers.push([x, y]);
  }
  if (!centers.length) return [];

  const perCluster = Math.max(1, Math.round(targetCount / centers.length));
  const points: [number, number][] = [];
  for (const [cx, cy] of centers) {
    for (let i = 0; i < perCluster; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * clusterRadiusM;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (pointInPolygon(x, y, poly)) points.push([x, y]);
    }
  }
  return points;
}

const TREE_ROAD_TYPES = new Set(['residential', 'tertiary', 'secondary', 'living_street']);
const STREET_TREE_SPACING_M = 16;
// Volontairement < 1 : un arbre à CHAQUE emplacement espacé régulièrement
// ferait une rangée trop régulière/artificielle ; ce tirage casse
// l'alignement parfait sans perdre l'idée de rangée d'arbres le long de la
// rue (règle produit : "ne pas surcharger").
const STREET_TREE_PROBABILITY = 0.4;
const STREET_TREE_SIDE_OFFSET_M = 3;

function streetTreePositions(roads: MapRoad[]): [number, number][] {
  const points: [number, number][] = [];
  for (const road of roads) {
    if (!TREE_ROAD_TYPES.has(road.hw)) continue;
    const halfWidth = (ROAD_WIDTH_BY_TYPE[road.hw] ?? DEFAULT_ROAD_WIDTH) / 2;
    const offset = halfWidth + STREET_TREE_SIDE_OFFSET_M;
    for (let i = 0; i < road.p.length - 1; i++) {
      const [ax, ay] = road.p[i];
      const [bx, by] = road.p[i + 1];
      const segLen = Math.hypot(bx - ax, by - ay);
      if (segLen < 1) continue;
      const dirX = (bx - ax) / segLen;
      const dirY = (by - ay) / segLen;
      const normalX = -dirY;
      const normalY = dirX;
      const steps = Math.floor(segLen / STREET_TREE_SPACING_M);
      for (let s = 1; s <= steps; s++) {
        if (Math.random() > STREET_TREE_PROBABILITY) continue;
        const t = s * STREET_TREE_SPACING_M;
        const px = ax + dirX * t;
        const py = ay + dirY * t;
        const side = Math.random() < 0.5 ? 1 : -1;
        points.push([px + normalX * offset * side, py + normalY * offset * side]);
      }
    }
  }
  return points;
}

function landmarkTreePositions(landmarks: MapLandmark[]): [number, number][] {
  const points: [number, number][] = [];
  for (const lm of landmarks) {
    const count = 2 + Math.floor(Math.random() * 2); // 2-3
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 5 + Math.random() * 5;
      points.push([lm.pos[0] + Math.cos(angle) * r, lm.pos[1] + Math.sin(angle) * r]);
    }
  }
  return points;
}

const TREE_TRUNK_COLOR = 0x7a5a3a;
// Petite palette (pas une seule teinte figée) pour casser l'effet "copier-
// coller" sur un grand nombre d'instances — assigné aléatoirement par arbre
// via InstancedMesh#setColorAt (aucun coût de géométrie supplémentaire).
const TREE_FOLIAGE_COLORS = [0x6fae5f, 0x5c9b52, 0x7ab468];
const BUSH_FOLIAGE_COLORS = [0x7fb568, 0x6fa85c, 0x74ad5e];

function buildInstancedBlobs(
  positions: [number, number][],
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  colors: number[],
  baseScale: [number, number],
  heightOffsetFactor: number
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  positions.forEach(([x, y], i) => {
    const scale = baseScale[0] + Math.random() * (baseScale[1] - baseScale[0]);
    m.compose(
      new THREE.Vector3(x, heightOffsetFactor * scale, -y),
      new THREE.Quaternion(),
      new THREE.Vector3(scale, scale, scale)
    );
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, color.setHex(colors[Math.floor(Math.random() * colors.length)]));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function buildVegetation(data: MapData): THREE.Group | null {
  const treePositions: [number, number][] = [];
  for (const park of data.parks) {
    const pts = dedupeClosed(park.p);
    if (pts.length < 3) continue;
    const { minX, maxX, minY, maxY } = polygonBBox(pts);
    const area = (maxX - minX) * (maxY - minY);
    const target = Math.min(55, Math.max(1, Math.round(area / 260)));
    treePositions.push(...clusteredScatterInPolygon(pts, target, 6));
  }
  treePositions.push(...streetTreePositions(data.roads));
  treePositions.push(...landmarkTreePositions(data.landmarks));

  const bushPositions: [number, number][] = [];
  for (const park of data.parks) {
    const pts = dedupeClosed(park.p);
    if (pts.length < 3) continue;
    const { minX, maxX, minY, maxY } = polygonBBox(pts);
    const area = (maxX - minX) * (maxY - minY);
    const target = Math.min(40, Math.max(1, Math.round(area / 340)));
    bushPositions.push(...clusteredScatterInPolygon(pts, target, 4));
  }

  if (!treePositions.length && !bushPositions.length) return null;
  const group = new THREE.Group();

  if (treePositions.length) {
    const trunkGeom = new THREE.CylinderGeometry(0.25, 0.3, 2.2, 6);
    trunkGeom.translate(0, 1.1, 0);
    // Matériau par défaut (blanc, pas `vertexColors`) : la couleur finale
    // vient entièrement de `instanceColor` via setColorAt (voir
    // buildInstancedBlobs) — un mécanisme par INSTANCE, indépendant de
    // `material.vertexColors` qui lit lui une couleur par SOMMET sur la
    // géométrie (absente ici). Mettre `vertexColors:true` sans attribut
    // `color` sur la géométrie fait lire au shader un attribut inexistant
    // -> rendu noir (déjà vu à l'écran, corrigé).
    const trunks = buildInstancedBlobs(
      treePositions,
      trunkGeom,
      toonMaterial(),
      [TREE_TRUNK_COLOR],
      [0.8, 1.4],
      0
    );
    const foliageGeom = new THREE.IcosahedronGeometry(1.6, 0);
    const foliage = buildInstancedBlobs(
      treePositions,
      foliageGeom,
      toonMaterial(),
      TREE_FOLIAGE_COLORS,
      [0.8, 1.4],
      2.2
    );
    group.add(trunks, foliage);
  }

  if (bushPositions.length) {
    const bushGeom = new THREE.IcosahedronGeometry(0.9, 0);
    const bushes = buildInstancedBlobs(
      bushPositions,
      bushGeom,
      toonMaterial(),
      BUSH_FOLIAGE_COLORS,
      [0.7, 1.2],
      0.7
    );
    group.add(bushes);
  }

  return group;
}

export function buildCity(data: MapData, scene: THREE.Scene): void {
  // Le sol épouse le vrai contour administratif de Clamart (pas un simple
  // rectangle) : au-delà de cette forme, plus rien n'est dessiné — c'est
  // ce qui fait que seule Clamart s'affiche, pas les communes voisines
  // tombées dans la bbox de requête (déjà filtrées côté données, mais le
  // sol rectangulaire les aurait quand même laissé deviner en silhouette).
  // Palette réchauffée (direction artistique "ville miniature chaleureuse",
  // moins froide/austère) : sol en sauge claire plutôt que vert-menthe
  // froid, parcs un ton plus soutenu pour bien se détacher du sol (lecture
  // des zones vertes), gris de voirie adouci/réchauffé. Les toits en terre
  // cuite des maisons (ROOF_PARAMS.house) et la couleur de l'eau ne
  // changent pas — ils fonctionnaient déjà bien.
  const groundGeom = areaShapeGeometry(data.boundary, 0);
  const ground = new THREE.Mesh(
    groundGeom ?? new THREE.PlaneGeometry(data.halfSizeM.x * 2, data.halfSizeM.y * 2),
    toonMaterial({ color: 0xd9ddbf, side: THREE.DoubleSide })
  );
  if (!groundGeom) ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const water = buildAreaMesh(data.water, 0.03, 0x6fa8d6);
  if (water) scene.add(water);

  const parks = buildAreaMesh(data.parks, 0.02, 0xa3c17f);
  if (parks) scene.add(parks);

  // Site d'hôpital tagué `amenity=hospital` sans `building` propre (contour
  // de tout le campus, pas une simple bâtisse) : sans cette forme au sol,
  // seul le badge flottait au-dessus de rien de visible.
  const hospitals = buildAreaMesh(data.hospitals, 0.025, 0xe3e2d6);
  if (hospitals) scene.add(hospitals);

  // Équipements sportifs "dessinés au sol" (règle produit), une couleur
  // distincte par type pour rester lisible à côté des parcs : vert plus
  // franc pour un terrain engazonné, bleu pour un court de tennis (plutôt
  // qu'une terre battue orange, moins lisible juste à côté de la piste),
  // terre cuite/ocre pour une piste d'athlétisme.
  const sportsPitches = buildAreaMesh(data.sportsPitches, 0.022, 0x5fbf4a);
  if (sportsPitches) scene.add(sportsPitches);
  const tennisCourts = buildAreaMesh(data.tennisCourts, 0.022, 0x4aa8c9);
  if (tennisCourts) scene.add(tennisCourts);
  const athleticsTracks = buildAreaMesh(data.athleticsTracks, 0.022, 0xcc6b3f);
  if (athleticsTracks) scene.add(athleticsTracks);

  const vegetation = buildVegetation(data);
  if (vegetation) scene.add(vegetation);

  const railways = buildRibbonMesh(
    data.railways.map((r) => ({ hw: 'rail', p: r.p })),
    0.12,
    () => 2.5,
    0x5a5248
  );
  if (railways) scene.add(railways);

  // Tramway (ex. T6) : couleur distincte du rail lourd, légèrement plus
  // étroit (voie tram standard plus fine qu'une voie ferrée classique).
  const tramways = buildRibbonMesh(
    (data.tramways ?? []).map((r) => ({ hw: 'tram', p: r.p })),
    0.13,
    () => 1.6,
    0x4a5a66
  );
  if (tramways) scene.add(tramways);

  const roads = buildRibbonMesh(
    data.roads,
    0.1,
    (hw) => ROAD_WIDTH_BY_TYPE[hw] ?? DEFAULT_ROAD_WIDTH,
    0x9c9488
  );
  if (roads) scene.add(roads);

  const dashes = buildRoadDashes(data.roads, 0.11);
  if (dashes) scene.add(dashes);

  const { main, civic, outline } = buildBuildingsMesh(data);
  if (outline) scene.add(outline);
  if (main) scene.add(main);
  if (civic) scene.add(civic);
}
