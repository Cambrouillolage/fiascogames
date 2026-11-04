import * as THREE from 'three';
import type { QuartierFeature } from './quartiersData.ts';
import { latLonToLocalMeters } from './merchants.ts';

// Zones de quartier colorées, visibles seulement très dézoomé (bascule
// pilotée depuis main.ts, selon IsoCameraRig#getZoomFraction) : polygone
// semi-transparent + étiquette du nom au centroïde. depthTest désactivé
// comme les badges/pins (src/badges.ts, src/merchantPins.ts) pour rester
// lisibles par-dessus les bâtiments même si la couche flotte bas.

function ringCentroidLonLat(ring: [number, number][]): [number, number] {
  // Centroïde par la formule du lacet (shoelace), même technique que celle
  // utilisée hors-ligne pour calculer l'orientation par défaut de la caméra
  // (voir le commentaire sur isoDir dans cameraRig.ts).
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-12) {
    const n = ring.length;
    const sx = ring.reduce((s, p) => s + p[0], 0);
    const sy = ring.reduce((s, p) => s + p[1], 0);
    return [sx / n, sy / n];
  }
  return [cx / (6 * a), cy / (6 * a)];
}

function flatPolygonGeometry(ringWorldXZ: [number, number][], y: number): THREE.BufferGeometry | null {
  if (ringWorldXZ.length < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(ringWorldXZ[0][0], ringWorldXZ[0][1]);
  for (let i = 1; i < ringWorldXZ.length; i++) {
    shape.lineTo(ringWorldXZ[i][0], ringWorldXZ[i][1]);
  }
  shape.closePath();
  const geom = new THREE.ShapeGeometry(shape);
  geom.deleteAttribute('uv');
  const pos = geom.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vz = pos.getY(i);
    pos.setXYZ(i, vx, y, vz);
  }
  geom.computeVertexNormals();
  return geom;
}

function labelTexture(text: string, accentColor: string): THREE.CanvasTexture {
  const scale = 4; // texture nette même en gros plan transitoire (fondu)
  const fontSize = 30;
  const paddingX = 22;
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = `800 ${fontSize * scale}px system-ui, sans-serif`;
  const textWidth = measure.measureText(text).width;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(textWidth + paddingX * 2 * scale);
  canvas.height = Math.ceil((fontSize + paddingX) * scale);
  const ctx = canvas.getContext('2d')!;
  const r = canvas.height / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, r);
  ctx.fill();
  ctx.lineWidth = 5 * scale;
  ctx.strokeStyle = accentColor;
  ctx.stroke();
  ctx.fillStyle = '#1a1a1a';
  ctx.font = `800 ${fontSize * scale}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2 * scale);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface QuartiersLayer {
  setVisible(visible: boolean): void;
}

/**
 * Point dans un polygone (ray-casting), mêmes unités (mètres locaux) des
 * deux côtés. Exportée : aussi utilisée par src/traffic.ts et
 * src/pedestrians.ts pour restreindre voitures/piétons au quartier pilote.
 */
export function pointInRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Identifiant du quartier contenant (lat, lon), ou `null` si aucun (filtre
 * "par quartier", voir src/filtersSheet.ts — pas de champ quartier stocké en
 * base, un commerce est rattaché à un quartier par simple test géométrique).
 */
export function quartierIdForLatLon(
  lat: number,
  lon: number,
  features: QuartierFeature[],
  center: { lat: number; lon: number }
): string | null {
  const [x, y] = latLonToLocalMeters(lat, lon, center);
  for (const f of features) {
    const ring = f.ring.map(([flon, flat]) => latLonToLocalMeters(flat, flon, center));
    if (pointInRing(x, y, ring)) return f.id;
  }
  return null;
}

const ZONE_Y = 0.6; // juste au-dessus du sol/parcs ; depthTest désactivé, donc toujours visible par-dessus les bâtiments
const LABEL_Y = 40;
// Taille en unités-monde (pas en pixels) : ce mode n'est visible qu'à un
// zoom très dézoomé (voir QUARTIER_MODE_ZOOM_THRESHOLD dans main.ts), donc
// une étiquette doit être nettement plus grande qu'un badge de commerce
// (PIN_SIZE=22 dans merchantPins.ts, pensé pour un zoom rapproché) pour
// rester lisible à l'échelle de la ville entière.
const LABEL_HEIGHT = 100;

export function buildQuartiers(
  features: QuartierFeature[],
  center: { lat: number; lon: number },
  scene: THREE.Scene
): QuartiersLayer {
  const objects: THREE.Object3D[] = [];

  for (const f of features) {
    const ringWorldXZ: [number, number][] = f.ring.map(([lon, lat]) => {
      const [x, y] = latLonToLocalMeters(lat, lon, center);
      return [x, -y];
    });
    const geom = flatPolygonGeometry(ringWorldXZ, ZONE_Y);
    if (geom) {
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(f.color),
        transparent: true,
        opacity: 0.45,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geom, material);
      mesh.renderOrder = 500;
      mesh.visible = false;
      scene.add(mesh);
      objects.push(mesh);
    }

    const [lonC, latC] = ringCentroidLonLat(f.ring);
    const [xC, yC] = latLonToLocalMeters(latC, lonC, center);
    const tex = labelTexture(f.name, f.color);
    const material = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
    const sprite = new THREE.Sprite(material);
    const aspect = tex.image.width / tex.image.height;
    sprite.scale.set(LABEL_HEIGHT * aspect, LABEL_HEIGHT, 1);
    sprite.position.set(xC, LABEL_Y, -yC);
    sprite.renderOrder = 501;
    sprite.visible = false;
    scene.add(sprite);
    objects.push(sprite);
  }

  return {
    setVisible(visible: boolean) {
      for (const o of objects) o.visible = visible;
    },
  };
}
