// Masque temporairement la top bar / la jauge de déblocage / le bouton
// sticky pendant que l'utilisateur déplace la carte (pan, pincement, molette),
// pour ne pas gêner la lecture de la 3D — réapparition automatique après un
// court délai d'inactivité. Générique : ne connaît rien du contenu des
// éléments qu'on lui passe, juste leur visibilité.

export interface AutoHideController {
  markMoving(): void;
  markIdle(): void;
}

export function createAutoHide(elements: HTMLElement[], idleDelayMs = 500): AutoHideController {
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let isHidden = false;

  function setHidden(hidden: boolean) {
    if (hidden === isHidden) return;
    isHidden = hidden;
    for (const el of elements) {
      el.classList.toggle('isHiddenByDrag', hidden);
    }
  }

  return {
    markMoving() {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      setHidden(true);
    },
    markIdle() {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setHidden(false), idleDelayMs);
    },
  };
}
