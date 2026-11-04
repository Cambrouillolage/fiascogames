// Étape 4 du plan SimCity : niveau de détail lié au zoom. Les bâtiments
// emblématiques (civic) sont déjà fusionnés dans le mesh statique de la
// ville (src/cityBuilder.ts) — coût de rendu négligeable quel que soit le
// zoom (~150 lieux sur 14 500 bâtiments), pas besoin de les cacher. Ce qui
// a un vrai coût dynamique, ce sont les voitures/piétons (src/traffic.ts,
// src/pedestrians.ts) : simulés ET rendus à chaque frame. Ce module se
// contente donc de les faire disparaître en fondu (pas de pop brutal) et de
// suspendre leur simulation dès qu'ils sont invisibles — réutilisé pour les
// deux systèmes via la même interface `{ setOpacity }`.

export interface Fadable {
  setOpacity(value: number): void;
}

const FADE_DURATION_S = 0.25;

export interface LodFader {
  /** À appeler chaque frame avec la cible (0 ou 1) et le delta-temps. */
  tick(targetOpacity: 0 | 1, deltaSeconds: number): void;
}

export function createLodFader(target: Fadable, initialOpacity: 0 | 1 = 1): LodFader {
  let current: number = initialOpacity;
  target.setOpacity(current);
  return {
    tick(targetOpacity: 0 | 1, deltaSeconds: number) {
      if (current === targetOpacity) return;
      const step = deltaSeconds / FADE_DURATION_S;
      current =
        targetOpacity > current ? Math.min(targetOpacity, current + step) : Math.max(targetOpacity, current - step);
      target.setOpacity(current);
    },
  };
}
