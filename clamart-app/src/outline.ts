import * as THREE from 'three';

// Contour "cartoon" par expansion des faces arrière : on duplique la
// géométrie, on pousse chaque sommet vers l'extérieur le long de sa
// normale, et on affiche uniquement les faces arrière (BackSide) en noir
// uni. Vu de face, seul le léger débord derrière la silhouette d'origine
// est visible : ça forme le contour. Calculé une fois en JS sur la
// géométrie fusionnée (statique), pas de coût de shader par frame — adapté
// à InstancedMesh/mobile contrairement à un post-processing d'outline.
export function buildOutlineMesh(geometry: THREE.BufferGeometry, thickness: number): THREE.Mesh {
  const outlineGeom = geometry.clone();
  if (!outlineGeom.getAttribute('normal')) {
    outlineGeom.computeVertexNormals();
  }
  const position = outlineGeom.getAttribute('position');
  const normal = outlineGeom.getAttribute('normal');
  for (let i = 0; i < position.count; i++) {
    position.setXYZ(
      i,
      position.getX(i) + normal.getX(i) * thickness,
      position.getY(i) + normal.getY(i) * thickness,
      position.getZ(i) + normal.getZ(i) * thickness
    );
  }
  position.needsUpdate = true;

  const material = new THREE.MeshBasicMaterial({ color: 0x1a1308, side: THREE.BackSide });
  return new THREE.Mesh(outlineGeom, material);
}
