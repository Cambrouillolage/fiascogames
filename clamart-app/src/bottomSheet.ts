// Bottom sheet minimal : glisse depuis le bas, affiche le nom (+ catégorie)
// du lieu sur lequel on a tapé/cliqué un badge. Pas de dépendance, juste du
// DOM + CSS.

const CATEGORY_LABEL: Record<string, string> = {
  townhall: 'Mairie',
  church: 'Église',
  school: 'École',
  post_office: 'Poste',
  park: 'Parc',
  station: 'Gare',
  parking: 'Parking',
  hospital: 'Hôpital',
};

let sheetEl: HTMLDivElement;
let backdropEl: HTMLDivElement;
let titleEl: HTMLDivElement;
let subtitleEl: HTMLDivElement;

function ensureSheet() {
  if (sheetEl) return;
  backdropEl = document.createElement('div');
  backdropEl.id = 'bottom-sheet-backdrop';
  backdropEl.className = 'sheetBackdrop';
  backdropEl.addEventListener('click', hideBottomSheet);
  document.body.appendChild(backdropEl);

  sheetEl = document.createElement('div');
  sheetEl.id = 'bottom-sheet';
  sheetEl.innerHTML = `
    <button type="button" class="bottomSheetClose" aria-label="Fermer">×</button>
    <div class="bottomSheetHandle"></div>
    <div class="bottomSheetTitle"></div>
    <div class="bottomSheetSubtitle"></div>
  `;
  document.body.appendChild(sheetEl);
  titleEl = sheetEl.querySelector('.bottomSheetTitle')!;
  subtitleEl = sheetEl.querySelector('.bottomSheetSubtitle')!;
  sheetEl.querySelector('.bottomSheetClose')!.addEventListener('click', hideBottomSheet);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideBottomSheet();
  });
}

export function showBottomSheet(name: string, category: string) {
  ensureSheet();
  titleEl.textContent = name;
  subtitleEl.textContent = CATEGORY_LABEL[category] ?? category;
  sheetEl.classList.add('isOpen');
  backdropEl.classList.add('isOpen');
}

export function hideBottomSheet() {
  if (sheetEl) sheetEl.classList.remove('isOpen');
  if (backdropEl) backdropEl.classList.remove('isOpen');
}
