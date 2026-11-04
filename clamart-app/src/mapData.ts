// Types + chargement de public/data/clamart.json, généré par
// scripts/fetch-osm.ts (clés volontairement courtes, voir ce script).

export type BuildingType =
  | 'house'
  | 'apartment'
  | 'commerce'
  | 'church'
  | 'mosque'
  | 'school'
  | 'townhall'
  | 'police'
  | 'fire_station';

export interface MapBuilding {
  t: BuildingType;
  h: number;
  f: [number, number][];
}

export interface MapRoad {
  hw: string;
  p: [number, number][];
}

export interface MapArea {
  p: [number, number][];
}

export type LandmarkCategory =
  | 'townhall'
  | 'church'
  | 'mosque'
  | 'school'
  | 'college'
  | 'post_office'
  | 'park'
  | 'station'
  | 'hospital'
  | 'police'
  | 'fire_station'
  | 'sports_pitch'
  | 'sports_tennis'
  | 'sports_track'
  | 'sports_hall';

export interface MapLandmark {
  c: LandmarkCategory;
  n: string;
  pos: [number, number];
  h: number;
}

export interface MapStreet {
  n: string;
  center: [number, number];
}

export interface MapData {
  center: { lat: number; lon: number };
  halfSizeM: { x: number; y: number };
  boundary: [number, number][];
  buildings: MapBuilding[];
  roads: MapRoad[];
  parks: MapArea[];
  water: MapArea[];
  railways: MapArea[];
  tramways: MapArea[];
  hospitals: MapArea[];
  sportsPitches: MapArea[];
  tennisCourts: MapArea[];
  athleticsTracks: MapArea[];
  landmarks: MapLandmark[];
  streets: MapStreet[];
}

export async function loadMapData(): Promise<MapData> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/clamart.json`);
  if (!res.ok) {
    throw new Error(`Impossible de charger clamart.json (HTTP ${res.status})`);
  }
  return (await res.json()) as MapData;
}
