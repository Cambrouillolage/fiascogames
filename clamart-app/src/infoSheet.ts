// Bottom sheet générique (fond cliquable + glissement depuis le bas) pour
// les modales d'info simples du site (contact, explications...) — même
// structure que bottomSheet.ts/merchantCard.ts, factorisée ici à partir de
// la 3e utilisation (boutique manquante, revendeurs GAV, événement GAV)
// pour ne pas tripler le même HTML/CSS à chaque nouvelle modale.

export interface InfoSheet {
  setContent(html: string): void;
  show(): void;
  hide(): void;
  root: HTMLDivElement;
}

export function createInfoSheet(id: string): InfoSheet {
  const backdrop = document.createElement('div');
  backdrop.id = `${id}-backdrop`;
  backdrop.className = 'sheetBackdrop infoSheetBackdrop';
  document.body.appendChild(backdrop);

  const sheet = document.createElement('div');
  sheet.id = id;
  sheet.className = 'infoSheet';
  sheet.innerHTML = `
    <button type="button" class="infoSheetClose" aria-label="Fermer">×</button>
    <div class="infoSheetHandle"></div>
    <div class="infoSheetBody"></div>
  `;
  document.body.appendChild(sheet);

  const bodyEl = sheet.querySelector<HTMLDivElement>('.infoSheetBody')!;

  function hide() {
    sheet.classList.remove('isOpen');
    backdrop.classList.remove('isOpen');
  }
  function show() {
    sheet.classList.add('isOpen');
    backdrop.classList.add('isOpen');
  }

  backdrop.addEventListener('click', hide);
  sheet.querySelector('.infoSheetClose')!.addEventListener('click', hide);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheet.classList.contains('isOpen')) hide();
  });

  return {
    setContent: (html: string) => {
      bodyEl.innerHTML = html;
    },
    show,
    hide,
    root: sheet,
  };
}
