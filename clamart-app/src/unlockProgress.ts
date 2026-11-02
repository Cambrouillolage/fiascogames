import type { Merchant } from './merchants.ts';

// Jauge "ville" : nombre de commerces déverrouillés sur le total, calculée
// une fois au chargement (pas recalculée par les filtres de la bottom sheet
// — c'est un indicateur global, pas un résultat de recherche).
export function setupUnlockProgress(merchants: Merchant[]): HTMLElement {
  const unlocked = merchants.filter((m) => !m.is_locked).length;
  const total = merchants.length;
  const pct = total > 0 ? Math.round((unlocked / total) * 100) : 0;

  const el = document.createElement('div');
  el.id = 'unlock-progress';
  el.innerHTML = `
    <div class="unlockProgressLabel">${unlocked} / ${total} commerces débloqués</div>
    <div class="unlockProgressTrack"><div class="unlockProgressFill" style="width:${pct}%"></div></div>
  `;
  document.body.appendChild(el);
  return el;
}
