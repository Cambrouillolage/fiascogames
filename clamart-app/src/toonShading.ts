import * as THREE from 'three';

// MeshToonMaterial a besoin d'une "gradient map" explicite pour un vrai
// rendu à paliers (sans, le dégradé est trop doux et ressemble à du
// Lambert standard) : une mini-texture 4 pixels, filtrage au plus proche
// (pas d'interpolation), partagée par tous les matériaux toon de la scène.
let sharedGradientMap: THREE.DataTexture | null = null;

export function getToonGradientMap(): THREE.DataTexture {
  if (sharedGradientMap) return sharedGradientMap;
  const levels = new Uint8Array([60, 130, 190, 255]);
  const tex = new THREE.DataTexture(levels, levels.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  sharedGradientMap = tex;
  return tex;
}

export function toonMaterial(options: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ gradientMap: getToonGradientMap(), ...options });
}
