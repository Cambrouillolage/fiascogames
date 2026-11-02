// Chargement de public/data/quartiers.json : GeoJSON des quartiers de
// Clamart fourni par l'utilisateur (limites PROVISOIRES et NON OFFICIELLES,
// voir `quality`/`note` de chaque feature — pas générées par ce projet, pas
// à présenter comme une source officielle, voir le disclaimer affiché par
// quartiers.ts quand la couche est visible).

export interface QuartierFeature {
  id: string;
  name: string;
  color: string;
  ring: [number, number][]; // [lon, lat], premier anneau du polygone
}

interface GeoJsonFeature {
  properties: {
    id: string;
    name_fr?: string;
    name?: string;
    color?: string;
  };
  geometry:
    | { type: 'Polygon'; coordinates: [number, number][][] }
    | { type: 'MultiPolygon'; coordinates: [number, number][][][] };
}

export async function loadQuartiers(): Promise<QuartierFeature[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/quartiers.json`);
  if (!res.ok) {
    throw new Error(`Impossible de charger quartiers.json (HTTP ${res.status})`);
  }
  const geojson = (await res.json()) as { features: GeoJsonFeature[] };
  return geojson.features.map((f) => {
    const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
    return {
      id: f.properties.id,
      name: f.properties.name_fr ?? f.properties.name ?? f.properties.id,
      color: f.properties.color ?? '#9ca3af',
      ring,
    };
  });
}
