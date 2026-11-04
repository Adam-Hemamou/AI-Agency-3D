/**
 * Catalogue du mobilier (données pures) : emprise au sol et hauteur de chaque meuble,
 * utilisées pour vérifier automatiquement qu'aucun objet ne déborde ni ne se chevauche.
 * Orientation 0 : le meuble « regarde » vers le sud (+z), donc vers la caméra.
 */

export const FLOOR_PROPS = {
  workstation: { w: 1.6, d: 1.5, h: 1.3 },
  executiveDesk: { w: 2.2, d: 1.8, h: 1.1 },
  receptionDesk: { w: 2.0, d: 0.8, h: 1.0 },
  chair: { w: 0.6, d: 0.6, h: 0.95 },
  plant: { w: 0.6, d: 0.6, h: 1.0 },
  plantSmall: { w: 0.45, d: 0.45, h: 0.6 },
  plantTall: { w: 0.6, d: 0.6, h: 1.6 },
  bookshelf: { w: 1.4, d: 0.45, h: 1.4 },
  sofa: { w: 2.0, d: 0.9, h: 0.8 },
  armchair: { w: 0.9, d: 0.9, h: 0.8 },
  coffeeTable: { w: 1.0, d: 0.6, h: 0.45 },
  floorLamp: { w: 0.45, d: 0.45, h: 1.6 },
  meetingTable: { w: 2.6, d: 2.6, h: 1.1 },
  longTable: { w: 3.2, d: 2.3, h: 1.0 },
  filingCabinet: { w: 0.55, d: 0.6, h: 0.9 },
  micStand: { w: 0.6, d: 0.6, h: 1.6 },
  cameraTripod: { w: 0.8, d: 0.8, h: 1.5 },
  softbox: { w: 0.7, d: 0.7, h: 1.8 },
  mixingDesk: { w: 1.8, d: 1.6, h: 1.2 },
  greenScreen: { w: 2.4, d: 0.4, h: 1.7 },
  easel: { w: 0.8, d: 0.6, h: 1.6 },
  printer: { w: 0.7, d: 0.55, h: 0.9 },
  beanBag: { w: 0.8, d: 0.8, h: 0.5 },
  globeStand: { w: 0.7, d: 0.7, h: 1.2 },
  waterCooler: { w: 0.5, d: 0.5, h: 1.2 },
  kitchenette: { w: 1.8, d: 0.65, h: 1.1 },
  whiteboardStand: { w: 2.0, d: 0.6, h: 1.7 },
  kanbanStand: { w: 2.4, d: 0.6, h: 1.7 },
  screenStand: { w: 1.6, d: 0.5, h: 1.6 },
  mailboxRack: { w: 1.6, d: 0.5, h: 1.3 },
  bench: { w: 1.4, d: 0.5, h: 0.5 },
  /** Tapis : posé à plat, il peut passer sous les meubles. */
  rug: { w: 1, d: 1, h: 0.02, flat: true },
} as const satisfies Record<string, { w: number; d: number; h: number; flat?: boolean }>;

export type FloorPropKind = keyof typeof FLOOR_PROPS;

/** Objets fixés aux murs hauts : largeur le long du mur et hauteur. */
export const WALL_PROPS = {
  wallScreen: { h: 1.0 },
  corkboard: { h: 0.8 },
  acousticPanels: { h: 1.1 },
  painting: { h: 0.6 },
  checkSign: { h: 0.6 },
  onAirSign: { h: 0.3 },
  window: { h: 0.9 },
  clock: { h: 0.45 },
} as const satisfies Record<string, { h: number }>;

export type WallPropKind = keyof typeof WALL_PROPS;

/** Contenu affiché sur un écran. */
export type ScreenContent =
  | 'play'
  | 'thumbnails'
  | 'chart'
  | 'barChart'
  | 'worldMap'
  | 'wave'
  | 'mail'
  | 'inbox'
  | 'doc'
  | 'kanban'
  | 'phone';

/** Accessoire posé sur un bureau. */
export type DeskAccessory = 'mug' | 'trays' | 'headset' | 'papers' | 'none';
