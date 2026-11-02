import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuildingType, MapArea, MapData, MapRoad } from './mapData.ts';
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

const ROAD_WIDTH_BY_TYPE: Record<string, number> = {
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
const DEFAULT_ROAD_WIDTH = 4;

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
  const material = toonMaterial({ color: 0xffffff });
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
  house: { wallFraction: 0.62, shrink: 0.5, roofColor: 0xa8553a },
  apartment: { wallFraction: 0.94, shrink: 0.9, roofColor: 0x8d8d86 },
  commerce: { wallFraction: 0.84, shrink: 0.82, roofColor: 0x6e6659 },
  church: { wallFraction: 1, shrink: 1, roofColor: 0x463a5c },
  school: { wallFraction: 1, shrink: 1, roofColor: 0x3f6b74 },
  townhall: { wallFraction: 1, shrink: 1, roofColor: 0x7a3f3f },
};

const WALL_COLOR_BY_TYPE: Record<BuildingType, number> = {
  house: 0xe3d2ab,
  apartment: 0xcfc6b8,
  commerce: 0xe0a35c,
  church: 0xcbbfe0,
  school: 0xb9dbe3,
  townhall: 0xe3b0b0,
};

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
  paintVertexColors(wallsGeom, new THREE.Color(WALL_COLOR_BY_TYPE[type]));

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

  // --- Porte/fenêtres : juste pour maison et immeuble (demande explicite,
  // et ce sont les deux types les plus nombreux donc les plus visibles) ---
  let detailGeoms: THREE.BufferGeometry[] = [];
  if (type === 'house') {
    detailGeoms = buildHouseDetails(pts, wallH);
  } else if (type === 'apartment') {
    detailGeoms = buildApartmentDetails(pts, wallH);
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

// ===== Arbres "boules" dans les parcs (InstancedMesh) =====
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

function scatterInPolygon(poly: [number, number][], density: number, max: number): [number, number][] {
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
  const area = (maxX - minX) * (maxY - minY);
  const target = Math.min(max, Math.max(1, Math.round(area * density)));
  const points: [number, number][] = [];
  let attempts = 0;
  while (points.length < target && attempts < target * 20) {
    attempts++;
    const x = minX + Math.random() * (maxX - minX);
    const y = minY + Math.random() * (maxY - minY);
    if (pointInPolygon(x, y, poly)) points.push([x, y]);
  }
  return points;
}

function buildTrees(parks: MapArea[]): THREE.Group | null {
  const positions: [number, number][] = [];
  for (const park of parks) {
    const pts = dedupeClosed(park.p);
    if (pts.length < 3) continue;
    positions.push(...scatterInPolygon(pts, 1 / 220, 60));
  }
  if (!positions.length) return null;

  const group = new THREE.Group();
  const trunkGeom = new THREE.CylinderGeometry(0.25, 0.3, 2.2, 6);
  trunkGeom.translate(0, 1.1, 0);
  const trunkMat = toonMaterial({ color: 0x6b4a2f });
  const trunks = new THREE.InstancedMesh(trunkGeom, trunkMat, positions.length);

  const foliageGeom = new THREE.IcosahedronGeometry(1.6, 0);
  const foliageMat = toonMaterial({ color: 0x5fa85a });
  const foliage = new THREE.InstancedMesh(foliageGeom, foliageMat, positions.length);

  const m = new THREE.Matrix4();
  positions.forEach(([x, y], i) => {
    const wx = x;
    const wz = -y;
    const scale = 0.8 + Math.random() * 0.6;
    m.compose(
      new THREE.Vector3(wx, 0, wz),
      new THREE.Quaternion(),
      new THREE.Vector3(scale, scale, scale)
    );
    trunks.setMatrixAt(i, m);
    m.compose(
      new THREE.Vector3(wx, 2.2 * scale, wz),
      new THREE.Quaternion(),
      new THREE.Vector3(scale, scale, scale)
    );
    foliage.setMatrixAt(i, m);
  });
  trunks.instanceMatrix.needsUpdate = true;
  foliage.instanceMatrix.needsUpdate = true;

  group.add(trunks, foliage);
  return group;
}

export function buildCity(data: MapData, scene: THREE.Scene): void {
  // Le sol épouse le vrai contour administratif de Clamart (pas un simple
  // rectangle) : au-delà de cette forme, plus rien n'est dessiné — c'est
  // ce qui fait que seule Clamart s'affiche, pas les communes voisines
  // tombées dans la bbox de requête (déjà filtrées côté données, mais le
  // sol rectangulaire les aurait quand même laissé deviner en silhouette).
  const groundGeom = areaShapeGeometry(data.boundary, 0);
  const ground = new THREE.Mesh(
    groundGeom ?? new THREE.PlaneGeometry(data.halfSizeM.x * 2, data.halfSizeM.y * 2),
    toonMaterial({ color: 0xcfe8d8, side: THREE.DoubleSide })
  );
  if (!groundGeom) ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const water = buildAreaMesh(data.water, 0.03, 0x6fa8d6);
  if (water) scene.add(water);

  const parks = buildAreaMesh(data.parks, 0.02, 0x8fc77a);
  if (parks) scene.add(parks);

  // Site d'hôpital tagué `amenity=hospital` sans `building` propre (contour
  // de tout le campus, pas une simple bâtisse) : sans cette forme au sol,
  // seul le badge flottait au-dessus de rien de visible.
  const hospitals = buildAreaMesh(data.hospitals, 0.025, 0xdce7ef);
  if (hospitals) scene.add(hospitals);

  const trees = buildTrees(data.parks);
  if (trees) scene.add(trees);

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
    0x8a8a84
  );
  if (roads) scene.add(roads);

  const dashes = buildRoadDashes(data.roads, 0.11);
  if (dashes) scene.add(dashes);

  const { main, civic, outline } = buildBuildingsMesh(data);
  if (outline) scene.add(outline);
  if (main) scene.add(main);
  if (civic) scene.add(civic);
}
