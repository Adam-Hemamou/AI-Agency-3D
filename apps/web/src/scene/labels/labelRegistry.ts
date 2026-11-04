import type { SpaceId } from '../layout/agencyLayout';

/**
 * Lien entre les étiquettes HTML (affichées par-dessus la scène) et la scène 3D
 * qui calcule leur position à l'écran à chaque image rendue.
 * Volontairement hors de React : la mise à jour des positions ne provoque aucun rendu React.
 */

const elements = new Map<SpaceId, HTMLElement>();
let requestFrame: (() => void) | null = null;

export const labelRegistry = {
  register(id: SpaceId, element: HTMLElement | null) {
    if (element) elements.set(id, element);
    else elements.delete(id);
    requestFrame?.();
  },
  entries: () => elements.entries(),
  /** Appelé par la scène : permet de redemander une image quand une étiquette apparaît. */
  setFrameRequester(fn: (() => void) | null) {
    requestFrame = fn;
  },
};
