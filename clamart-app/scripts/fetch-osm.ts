// Récupère en un seul appel Overpass les bâtiments, routes, parcs/espaces
// verts, eau et voie ferrée de Clamart, et génère un JSON compact dans
// public/data/clamart.json. Le site ne doit JAMAIS appeler Overpass au
// runtime : ce script ne tourne qu'au moment du build / de la régénération
// des données (`npm run fetch-data`).

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Cache local des réponses Overpass brutes (pas commité, juste /tmp) : les
// serveurs publics sont lents/instables pour une requête portant sur toute
// la commune, et on a besoin de réitérer sur la simplification/tolérance
// sans refaire l'appel réseau à chaque fois. Supprimer ces fichiers pour
// forcer un vrai rafraîchissement depuis OSM.
const CACHE_DIR = join(tmpdir(), 'clamart-osm-cache');
function cachedFetch(cacheKey: string, query: string): Promise<OverpassResponse> {
  const cachePath = join(CACHE_DIR, `${cacheKey}.json`);
  if (existsSync(cachePath)) {
    console.log(`(cache) ${cacheKey}`);
    return Promise.resolve(JSON.parse(readFileSync(cachePath, 'utf8')));
  }
  return fetchOverpass(query).then((res) => {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cachePath, JSON.stringify(res));
    return res;
  });
}

// ===== Zone couverte : la commune de Clamart entière =====
// Le centre et la bbox sont calculés à partir du contour administratif réel
// (relation OSM boundary=administrative, admin_level=8, voir
// fetchClamartBoundary ci-dessous), pas d'un centre+rayon devinés à la
// main. Ça garantit à la fois une bbox de requête qui couvre tout le
// territoire ET un polygone exact pour ne garder, au filtrage, que ce qui
// est vraiment dans Clamart (pas les communes voisines qui déborderaient
// dans une simple bbox rectangulaire).
let CENTER_LAT = 0;
let CENTER_LON = 0;
const M_PER_DEG_LAT = 111_320;
function metersPerDegLon(): number {
  return M_PER_DEG_LAT * Math.cos((CENTER_LAT * Math.PI) / 180);
}

// Centre-ville dense (~10k bâtiments rien que pour le centre) : pour toute
// la commune, rester sous l'objectif de 2 Mo demande un arrondi à 10cm
// (largement suffisant pour un rendu cartoon) et une simplification
// Douglas-Peucker des polylignes/polygones plutôt que de garder tous les
// nœuds OSM.
// COORD_PRECISION_M doit diviser 1 proprement (1/x exact) : sinon
// l'arrondi produit du bruit flottant (ex. 0.15 -> 123.44999999999999 au
// lieu de 123.45), qui gonfle le JSON au lieu de le réduire. Découvert en
// testant 0.15 : le fichier avait grossi au lieu de rétrécir.
const COORD_PRECISION_M = 0.2;
const SIMPLIFY_TOLERANCE_M = 0.6;
const BBOX_PADDING_M = 150; // marge autour du contour exact pour la requête Overpass

const OUTPUT_PATH = new URL('../public/data/clamart.json', import.meta.url);

function toLocalMeters(lat: number, lon: number): [number, number] {
  const x = (lon - CENTER_LON) * metersPerDegLon();
  const y = (lat - CENTER_LAT) * M_PER_DEG_LAT;
  return [round(x), round(y)];
}

function round(n: number): number {
  const scale = 1 / COORD_PRECISION_M;
  return Math.round(n * scale) / scale;
}

// Douglas-Peucker : retire les points quasi-alignés, garde la forme
// générale. Les 2 extrémités sont toujours conservées.
function simplify(points: [number, number][], tolerance: number): [number, number][] {
  if (points.length <= 2) return points;

  function perpendicularDist(
    p: [number, number],
    a: [number, number],
    b: [number, number]
  ): number {
    const [px, py] = p;
    const [ax, ay] = a;
    const [bx, by] = b;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    const t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  function recurse(pts: [number, number][]): [number, number][] {
    if (pts.length <= 2) return pts;
    let maxDist = 0;
    let maxIdx = 0;
    const first = pts[0];
    const last = pts[pts.length - 1];
    for (let i = 1; i < pts.length - 1; i++) {
      const d = perpendicularDist(pts[i], first, last);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > tolerance) {
      const left = recurse(pts.slice(0, maxIdx + 1));
      const right = recurse(pts.slice(maxIdx));
      return left.slice(0, -1).concat(right);
    }
    return [first, last];
  }

  return recurse(points);
}

// Ray casting standard : point dans un polygone fermé (mêmes mètres locaux
// que le reste des données). Utilisé pour ne garder que les éléments
// réellement dans Clamart une fois la bbox (rectangulaire, forcément plus
// large que le contour réel) interrogée.
function pointInPolygon(p: [number, number], poly: [number, number][]): boolean {
  const [x, y] = p;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function fetchOverpass(query: string): Promise<OverpassResponse> {
  let lastError: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        if (attempt > 0) {
          const waitMs = 2 ** attempt * 1000;
          console.log(`  retry ${attempt} dans ${waitMs}ms...`);
          await new Promise((r) => setTimeout(r, waitMs));
        }
        console.log(`Requête Overpass sur ${endpoint}...`);
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'clamart-map-fetch-osm/1.0 (dev script, one-off)',
          },
          body: 'data=' + encodeURIComponent(query),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        return (await res.json()) as OverpassResponse;
      } catch (err) {
        lastError = err;
        console.warn(`  échec: ${(err as Error).message}`);
      }
    }
  }
  throw new Error(
    `Impossible d'interroger Overpass après plusieurs tentatives: ${lastError}`
  );
}

// ===== Contour administratif de Clamart =====
// La relation OSM est un multipolygone découpé en ~38 tronçons ("outer")
// qu'il faut rejoindre bout à bout pour reformer un seul anneau fermé
// (vérifié manuellement : Clamart n'a ni trou ni enclave, un seul anneau
// suffit). Si un jour ce n'est plus vrai (relation modifiée sur OSM), le
// avertissement ci-dessous permet de s'en rendre compte plutôt que de
// produire un contour silencieusement faux.
interface LatLon {
  lat: number;
  lon: number;
}

function keyOf(p: LatLon, prec = 6): string {
  return `${p.lat.toFixed(prec)},${p.lon.toFixed(prec)}`;
}

function assembleRing(segments: LatLon[][]): LatLon[] {
  const remaining = segments.map((s) => s.slice());
  const ring = remaining.shift()!.slice();
  while (remaining.length) {
    const tail = keyOf(ring[ring.length - 1]);
    let found = false;
    for (let i = 0; i < remaining.length; i++) {
      const seg = remaining[i];
      if (keyOf(seg[0]) === tail) {
        ring.push(...seg.slice(1));
        remaining.splice(i, 1);
        found = true;
        break;
      }
      if (keyOf(seg[seg.length - 1]) === tail) {
        ring.push(...seg.slice(0, -1).reverse());
        remaining.splice(i, 1);
        found = true;
        break;
      }
    }
    if (!found) {
      console.warn(
        `⚠️  Contour de Clamart : ${remaining.length} tronçon(s) non reliés (relation OSM modifiée ?). Le contour utilisé sera incomplet.`
      );
      break;
    }
  }
  return ring;
}

async function fetchClamartBoundary(): Promise<LatLon[]> {
  const query = `
[out:json][timeout:60];
relation["boundary"="administrative"]["name"="Clamart"]["admin_level"="8"];
out geom;
`.trim();
  const data = await cachedFetch('boundary', query);
  const relation = data.elements.find((el) => el.type === 'relation') as OverpassRelation | undefined;
  if (!relation) {
    throw new Error("Impossible de trouver la relation de contour administratif de Clamart sur Overpass.");
  }
  const outerWays = relation.members.filter((m) => m.type === 'way' && m.role === 'outer' && m.geometry);
  const segments = outerWays.map((m) => m.geometry!.map((p) => ({ lat: p.lat, lon: p.lon })));
  const ring = assembleRing(segments);
  console.log(`Contour de Clamart : ${outerWays.length} tronçons, ${ring.length} points.`);
  return ring;
}

// ===== Types bruts Overpass =====
interface OverpassTags {
  [key: string]: string;
}
interface OverpassGeomPoint {
  lat: number;
  lon: number;
}
interface OverpassNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: OverpassTags;
}
interface OverpassWay {
  type: 'way';
  id: number;
  tags?: OverpassTags;
  geometry?: OverpassGeomPoint[];
}
interface OverpassRelationMember {
  type: 'way' | 'node';
  ref: number;
  role: string;
  geometry?: OverpassGeomPoint[];
}
interface OverpassRelation {
  type: 'relation';
  id: number;
  tags?: OverpassTags;
  members: OverpassRelationMember[];
}
type OverpassElement = OverpassNode | OverpassWay | OverpassRelation;
interface OverpassResponse {
  elements: OverpassElement[];
}

// ===== Types de sortie (clés courtes : des milliers d'éléments, chaque
// octet compte pour rester sous l'objectif de taille) =====
type BuildingType =
  | 'house'
  | 'apartment'
  | 'commerce'
  | 'church'
  | 'school'
  | 'townhall';

interface OutBuilding {
  t: BuildingType;
  h: number; // hauteur en m
  f: [number, number][]; // footprint, mètres locaux
}
interface OutRoad {
  hw: string; // tag OSM highway brut
  p: [number, number][];
}
interface OutArea {
  p: [number, number][];
}

// Lieux emblématiques pour les badges cliquables (mairie, église, école,
// poste, parc, gare, parking, hôpital).
export type LandmarkCategory =
  | 'townhall'
  | 'church'
  | 'school'
  | 'post_office'
  | 'park'
  | 'station'
  | 'parking'
  | 'hospital';

interface OutLandmark {
  c: LandmarkCategory;
  n: string; // nom affiché
  pos: [number, number];
  h: number; // hauteur du badge (sommet du bâtiment + marge, ou valeur par défaut)
}

// Index pour la recherche de rue côté client : une rue OSM est presque
// toujours découpée en plusieurs tronçons (un par intersection) — on les
// regroupe ici par nom une bonne fois pour toutes, plutôt que de le refaire
// au runtime à chaque recherche. `center` sert à centrer/zoomer la caméra
// dessus (moyenne de tous les points de tous les tronçons).
interface OutStreet {
  n: string;
  center: [number, number];
}

interface OutputData {
  center: { lat: number; lon: number };
  halfSizeM: { x: number; y: number };
  boundary: [number, number][]; // contour de la commune, mètres locaux — sert à découper le sol au rendu
  buildings: OutBuilding[];
  roads: OutRoad[];
  parks: OutArea[];
  water: OutArea[];
  railways: OutArea[];
  tramways: OutArea[];
  hospitals: OutArea[];
  landmarks: OutLandmark[];
  streets: OutStreet[];
}

function wayPoints(way: OverpassWay): [number, number][] {
  if (!way.geometry) return [];
  const raw = way.geometry.map((p) => toLocalMeters(p.lat, p.lon));
  return simplify(raw, SIMPLIFY_TOLERANCE_M);
}

function polygonAreaM2(points: [number, number][]): number {
  // Formule du lacet (shoelace) — suffisant pour une estimation de surface,
  // pas besoin de précision géodésique ici.
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2);
}

function classifyBuilding(
  tags: OverpassTags,
  areaM2: number,
  levels: number | null
): BuildingType {
  const amenity = tags.amenity;
  const building = tags.building;

  if (amenity === 'townhall' || building === 'townhall') return 'townhall';
  if (amenity === 'place_of_worship' || building === 'church')
    return 'church';
  if (amenity === 'school' || building === 'school') return 'school';

  if (
    building &&
    ['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'cabin'].includes(
      building
    )
  ) {
    return 'house';
  }
  if (tags.shop || ['retail', 'commercial', 'supermarket'].includes(building ?? '')) {
    return 'commerce';
  }
  if (building && ['apartments', 'residential', 'dormitory'].includes(building)) {
    return 'apartment';
  }

  // Repli : pas de tag assez précis -> heuristique surface/étages.
  if (areaM2 < 150 && (levels === null || levels <= 2)) return 'house';
  if ((levels ?? 0) >= 3) return 'apartment';
  return areaM2 < 300 ? 'house' : 'apartment';
}

const DEFAULT_HEIGHT_BY_TYPE: Record<BuildingType, number> = {
  house: 6,
  apartment: 15,
  commerce: 5,
  church: 18,
  school: 9,
  townhall: 12,
};

function resolveHeight(
  tags: OverpassTags,
  type: BuildingType,
  levels: number | null
): number {
  if (tags.height) {
    const parsed = parseFloat(tags.height);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  if (levels !== null && levels > 0) return levels * 3;
  return DEFAULT_HEIGHT_BY_TYPE[type];
}

function parseLevels(tags: OverpassTags): number | null {
  const raw = tags['building:levels'];
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function centroid(points: [number, number][]): [number, number] {
  let sx = 0;
  let sy = 0;
  for (const [x, y] of points) {
    sx += x;
    sy += y;
  }
  return [round(sx / points.length), round(sy / points.length)];
}

const DEFAULT_LANDMARK_NAME: Record<LandmarkCategory, string> = {
  townhall: 'Mairie',
  church: 'Église',
  school: 'École',
  post_office: 'Poste',
  park: 'Parc',
  station: 'Gare',
  parking: 'Parking',
  hospital: 'Hôpital',
};

const LANDMARK_BADGE_CLEARANCE_M = 8;
const DEFAULT_BADGE_HEIGHT_M = 15;
const PARKING_MIN_AREA_M2 = 400; // ~20 places ; exclut les allées/places privées
const NEAREST_STREET_MAX_DIST_M = 150;

// Nom le plus précis possible : au-delà du tag `name` (souvent absent pour
// une école/un parking), on tente d'autres tags qui portent parfois un nom
// utilisable avant de retomber sur le libellé générique de la catégorie.
function resolveLandmarkName(tags: OverpassTags, category: LandmarkCategory): string {
  return (
    tags.name ??
    tags.official_name ??
    tags.operator ??
    tags.alt_name ??
    tags.brand ??
    DEFAULT_LANDMARK_NAME[category]
  );
}

function pointToSegmentDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

async function main() {
  const boundaryLatLon = await fetchClamartBoundary();
  const lats = boundaryLatLon.map((p) => p.lat);
  const lons = boundaryLatLon.map((p) => p.lon);
  const southRaw = Math.min(...lats);
  const northRaw = Math.max(...lats);
  const westRaw = Math.min(...lons);
  const eastRaw = Math.max(...lons);

  CENTER_LAT = (southRaw + northRaw) / 2;
  CENTER_LON = (westRaw + eastRaw) / 2;

  const latPad = BBOX_PADDING_M / M_PER_DEG_LAT;
  const lonPad = BBOX_PADDING_M / metersPerDegLon();
  const south = southRaw - latPad;
  const north = northRaw + latPad;
  const west = westRaw - lonPad;
  const east = eastRaw + lonPad;
  const BBOX = `${south},${west},${north},${east}`;

  const boundaryLocal = boundaryLatLon.map((p) => toLocalMeters(p.lat, p.lon));
  const halfSizeM = {
    x: Math.max(...boundaryLocal.map(([x]) => Math.abs(x))),
    y: Math.max(...boundaryLocal.map(([, y]) => Math.abs(y))),
  };

  console.log(
    `Zone : centre (${CENTER_LAT.toFixed(5)}, ${CENTER_LON.toFixed(5)}), bbox ${BBOX}, demi-taille approx ${halfSizeM.x.toFixed(0)}x${halfSizeM.y.toFixed(0)}m`
  );

  // Certains plans d'eau (ex. l'étang du Panorama) sont mappés comme un
  // multipolygone OSM plutôt qu'un simple way "natural=water" (pour un plan
  // d'eau irrégulier) — sans les deux clauses "relation" ci-dessous, ils
  // étaient silencieusement absents du JSON généré (toute relation était
  // ignorée au traitement, voir plus bas / fonction relationOuterRingPoints).
  const QUERY = `
[out:json][timeout:180];
(
  way["building"](${BBOX});
  way["highway"](${BBOX});
  way["leisure"="park"](${BBOX});
  way["landuse"~"^(grass|forest|meadow|recreation_ground)$"](${BBOX});
  way["natural"~"^(wood|water)$"](${BBOX});
  way["waterway"="riverbank"](${BBOX});
  way["railway"="rail"](${BBOX});
  way["railway"="tram"](${BBOX});
  relation["natural"="water"](${BBOX});
  relation["leisure"="park"](${BBOX});
  node["amenity"="post_office"](${BBOX});
  way["amenity"="post_office"](${BBOX});
  node["amenity"="parking"](${BBOX});
  way["amenity"="parking"](${BBOX});
  node["railway"="station"](${BBOX});
  node["amenity"="townhall"](${BBOX});
  node["amenity"="hospital"](${BBOX});
  way["amenity"="hospital"](${BBOX});
);
out geom;
`.trim();

  const data = await cachedFetch('main', QUERY);
  console.log(`${data.elements.length} éléments reçus d'Overpass.`);

  const buildings: OutBuilding[] = [];
  const roads: OutRoad[] = [];
  const parks: OutArea[] = [];
  const water: OutArea[] = [];
  const railways: OutArea[] = [];
  const tramways: OutArea[] = [];
  const hospitals: OutArea[] = [];
  const landmarks: OutLandmark[] = [];
  // Une rue OSM est découpée en plusieurs tronçons (un par intersection) :
  // on accumule tous les points de tous les tronçons partageant le même
  // nom, puis on en fait la moyenne une fois à la fin (voir après la
  // boucle) pour obtenir un point central par rue, pas par tronçon. Aussi
  // utilisé pour nommer les lieux emblématiques sans nom propre (ex.
  // "Parking" -> "Parking – rue de la Porte").
  const streetPoints = new Map<string, [number, number][]>();
  const namedSegments: { name: string; a: [number, number]; b: [number, number] }[] = [];

  function pushLandmark(category: LandmarkCategory, tags: OverpassTags, pos: [number, number], heightM: number) {
    if (!pointInPolygon(pos, boundaryLocal)) return;
    landmarks.push({
      c: category,
      n: resolveLandmarkName(tags, category),
      pos,
      h: heightM,
    });
  }

  // Reconstruit l'anneau extérieur d'un multipolygone OSM (eau/parc) à
  // partir de ses tronçons "outer", même technique que assembleRing/
  // fetchClamartBoundary ci-dessus — ignore les "inner" (îlots/trous),
  // comme le contour de la commune le fait déjà, acceptable à cette échelle.
  function relationOuterRingPoints(relation: OverpassRelation): [number, number][] {
    const outerWays = relation.members.filter((m) => m.type === 'way' && m.role === 'outer' && m.geometry);
    if (!outerWays.length) return [];
    const segments = outerWays.map((m) => m.geometry!.map((p) => ({ lat: p.lat, lon: p.lon })));
    const ring = assembleRing(segments);
    return simplify(
      ring.map((p) => toLocalMeters(p.lat, p.lon)),
      SIMPLIFY_TOLERANCE_M
    );
  }

  for (const el of data.elements) {
    if (el.type === 'relation') {
      if (!el.tags) continue;
      const points = relationOuterRingPoints(el);
      if (points.length >= 3 && points.some((p) => pointInPolygon(p, boundaryLocal))) {
        if (el.tags.natural === 'water') water.push({ p: points });
        else if (el.tags.leisure === 'park') parks.push({ p: points });
      }
      continue;
    }
    if (!el.tags) continue;
    const tags = el.tags;

    // ----- Nœuds isolés (pas de géométrie de way) : gare, poste, mairie -----
    // (le parking en nœud isolé est quasi toujours une place/entrée privée
    // mineure, pas un vrai parking public — on ne le badge pas.)
    // La mairie de Clamart elle-même n'est taguée que sur un nœud
    // (amenity=townhall), pas sur le bâtiment — vérifié via Overpass, d'où
    // ce cas à part (church/school sont eux bien présents comme bâtiments).
    if (el.type === 'node') {
      const pos = toLocalMeters(el.lat, el.lon);
      if (tags.railway === 'station') {
        pushLandmark('station', tags, pos, DEFAULT_BADGE_HEIGHT_M);
      } else if (tags.amenity === 'post_office') {
        pushLandmark('post_office', tags, pos, DEFAULT_BADGE_HEIGHT_M);
      } else if (tags.amenity === 'townhall') {
        pushLandmark('townhall', tags, pos, DEFAULT_BADGE_HEIGHT_M);
      } else if (tags.amenity === 'hospital') {
        pushLandmark('hospital', tags, pos, DEFAULT_BADGE_HEIGHT_M);
      }
      continue;
    }

    if (!el.geometry || el.geometry.length < 2) continue;
    const points = wayPoints(el);
    if (points.length < 2) continue;
    // La bbox de requête déborde volontairement du contour exact (marge +
    // rectangle englobant un polygone irrégulier) : on ne garde que ce qui
    // touche vraiment Clamart, pas les communes voisines qui tombent dans
    // ce même rectangle.
    if (!points.some((p) => pointInPolygon(p, boundaryLocal))) continue;

    if (tags.building) {
      const area = polygonAreaM2(points);
      const levels = parseLevels(tags);
      const type = classifyBuilding(tags, area, levels);
      const heightM = resolveHeight(tags, type, levels);
      buildings.push({ t: type, h: heightM, f: points });

      if (type === 'townhall' || type === 'church' || type === 'school') {
        pushLandmark(type, tags, centroid(points), heightM + LANDMARK_BADGE_CLEARANCE_M);
      }
    } else if (tags.highway) {
      roads.push({ hw: tags.highway, p: points });
      if (tags.name) {
        const existing = streetPoints.get(tags.name);
        if (existing) existing.push(...points);
        else streetPoints.set(tags.name, [...points]);
        for (let i = 0; i < points.length - 1; i++) {
          namedSegments.push({ name: tags.name, a: points[i], b: points[i + 1] });
        }
      }
    } else if (
      tags.leisure === 'park' ||
      ['grass', 'forest', 'meadow', 'recreation_ground'].includes(tags.landuse ?? '') ||
      tags.natural === 'wood'
    ) {
      parks.push({ p: points });
      // Seuls les vrais parcs nommés deviennent des badges "Parc" — sinon
      // chaque bande de pelouse en aurait un (51 polygones verts rien que
      // pour le centre-ville), bien plus que des lieux "emblématiques".
      if (tags.leisure === 'park' && tags.name) {
        pushLandmark('park', tags, centroid(points), DEFAULT_BADGE_HEIGHT_M);
      }
    } else if (tags.natural === 'water' || tags.waterway === 'riverbank') {
      water.push({ p: points });
    } else if (tags.railway === 'rail') {
      railways.push({ p: points });
    } else if (tags.railway === 'tram') {
      tramways.push({ p: points });
    }

    if (tags.amenity === 'post_office') {
      pushLandmark('post_office', tags, centroid(points), DEFAULT_BADGE_HEIGHT_M);
    } else if (tags.amenity === 'parking') {
      // La plupart des `amenity=parking` d'OSM sont de toutes petites
      // places privées (allée, 2-3 places) : sans filtre on se retrouve
      // avec >1000 badges "Parking". Seuil pour ne garder que les vrais
      // parkings publics (~20+ places).
      if (polygonAreaM2(points) >= PARKING_MIN_AREA_M2) {
        pushLandmark('parking', tags, centroid(points), DEFAULT_BADGE_HEIGHT_M);
      }
    } else if (tags.amenity === 'hospital') {
      pushLandmark('hospital', tags, centroid(points), DEFAULT_BADGE_HEIGHT_M);
      // Beaucoup d'hôpitaux sont tagués `amenity=hospital` sur le contour de
      // tout le site (pas un `building`) : sans ça, le polygone n'était
      // jamais dessiné nulle part, juste un badge flottant au centre. Un
      // hôpital déjà tagué comme bâtiment (building=hospital/yes) a déjà sa
      // vraie forme via buildings[] plus haut — pas besoin de doublon.
      if (!tags.building) {
        hospitals.push({ p: points });
      }
    }
  }

  // Lieux sans nom propre (toujours sur le libellé générique de la
  // catégorie) : on les complète avec la rue la plus proche, pour les
  // distinguer les uns des autres (ex. 21 écoles qui s'appelaient toutes
  // juste "École").
  for (const lm of landmarks) {
    if (lm.n !== DEFAULT_LANDMARK_NAME[lm.c]) continue;
    let best: { name: string; dist: number } | null = null;
    for (const seg of namedSegments) {
      const d = pointToSegmentDist(lm.pos, seg.a, seg.b);
      if (!best || d < best.dist) best = { name: seg.name, dist: d };
    }
    if (best && best.dist <= NEAREST_STREET_MAX_DIST_M) {
      lm.n = `${lm.n} – ${best.name}`;
    }
  }

  const streets: OutStreet[] = Array.from(streetPoints.entries()).map(([n, pts]) => ({
    n,
    center: centroid(pts),
  }));

  const output: OutputData = {
    center: { lat: CENTER_LAT, lon: CENTER_LON },
    halfSizeM,
    boundary: simplify(boundaryLocal, 2), // contour simplifié un peu plus fort : juste la forme du sol, pas besoin du cm près
    buildings,
    roads,
    parks,
    water,
    railways,
    tramways,
    hospitals,
    landmarks,
    streets,
  };

  const json = JSON.stringify(output);
  const outPath = fileURLToPath(OUTPUT_PATH);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, json);

  const sizeKb = Buffer.byteLength(json) / 1024;
  console.log(
    `Écrit ${outPath} (${sizeKb.toFixed(0)} Ko) — ${buildings.length} bâtiments, ${roads.length} routes, ${parks.length} parcs, ${water.length} plans d'eau, ${railways.length} voies ferrées, ${tramways.length} voies de tram, ${hospitals.length} sites hospitaliers, ${landmarks.length} lieux emblématiques, ${streets.length} rues nommées.`
  );
  for (const l of landmarks) {
    console.log(`  badge [${l.c}] ${l.n} @ (${l.pos[0]}, ${l.pos[1]})`);
  }
  if (sizeKb > 2048) {
    console.warn(
      `⚠️  Fichier au-dessus de l'objectif de 2 Mo (${sizeKb.toFixed(0)} Ko) — envisager de réduire la zone ou la tolérance de simplification.`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
