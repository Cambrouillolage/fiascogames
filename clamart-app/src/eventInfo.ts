// Modale "Événement GAV" ouverte depuis l'encart de la bottom sheet de
// filtres (voir filtersSheet.ts) quand un commerce a une date d'événement
// renseignée (gav_event_date) : détaille l'événement, avec un lien vers
// GAV et un raccourci pour aller voir le commerce sur la carte.
import type { Merchant } from './merchants.ts';
import { createInfoSheet } from './infoSheet.ts';

let sheet: ReturnType<typeof createInfoSheet> | null = null;

function formatEventDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function ensureSheet() {
  if (sheet) return sheet;
  sheet = createInfoSheet('event-info-sheet');
  return sheet;
}

export function showEventInfo(merchant: Merchant, onViewMerchant: (merchant: Merchant) => void) {
  const s = ensureSheet();
  s.setContent(`
    <h2 class="infoSheetTitle">Événement GAV chez ${merchant.name}</h2>
    <p class="infoSheetText">
      📅 ${merchant.gav_event_date ? formatEventDate(merchant.gav_event_date) : ''}<br />
      On fait une soirée où on présente GAV, c'est à partir de 19h, pensez
      à réserver !
    </p>
    <div class="infoSheetActions">
      <a class="infoSheetActionBtn infoSheetActionBtn--secondary" href="/gav/" target="_blank" rel="noopener">Voir GAV</a>
      <button type="button" class="infoSheetActionBtn infoSheetActionBtn--primary" id="eventInfoViewMerchantBtn">Voir ${merchant.name}</button>
    </div>
  `);
  s.root.querySelector<HTMLButtonElement>('#eventInfoViewMerchantBtn')!.addEventListener('click', () => {
    s.hide();
    onViewMerchant(merchant);
  });
  s.show();
}

export function hideEventInfo() {
  sheet?.hide();
}
