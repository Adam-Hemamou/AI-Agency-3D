import { ROOM_LABELS } from '@agency/shared';
import type { SpaceId } from '../layout/agencyLayout';
import type { DeskAccessory, FloorPropKind, ScreenContent, WallPropKind } from '../props/catalog';

/**
 * Aménagement de chaque espace (données pures) : couleurs, sol, mobilier et objets muraux.
 * Coordonnées locales à la salle : x ∈ [-3.35, 3.35], z ∈ [-2.85, 2.85].
 * La cohérence (pas de débordement, pas de chevauchement, portes dégagées)
 * est vérifiée par roomDesigns.test.ts.
 */

export type QuarterTurn = 0 | 1 | 2 | 3;

export interface FloorPlacement {
  kind: FloorPropKind;
  at: readonly [number, number];
  /** Quarts de tour : 0 = face au sud (caméra), 1 = face à l'est. */
  rot?: QuarterTurn;
  /** Dimensions explicites (tapis uniquement). */
  size?: readonly [number, number];
  color?: string;
  screen?: ScreenContent;
  accessory?: DeskAccessory;
}

export interface WallPlacement {
  kind: WallPropKind;
  wall: 'north' | 'west';
  /** Position du centre le long du mur (x pour le mur nord, z pour le mur ouest). */
  offset: number;
  width: number;
  /** Hauteur du centre de l'objet. */
  y: number;
  screen?: ScreenContent;
}

export type FloorStyle = 'tiles' | 'planks' | 'carpet';

export interface SpaceTheme {
  floor: string;
  floorAlt: string;
  floorStyle: FloorStyle;
  /** Couleur d'identité de la salle (signalétique, surbrillance, accents). */
  accent: string;
}

export interface SpaceDesign {
  id: SpaceId;
  label: string;
  /** Pictogramme affiché sur l'étiquette. */
  icon: string;
  theme: SpaceTheme;
  props: readonly FloorPlacement[];
  wallProps: readonly WallPlacement[];
}

export const SPACE_DESIGNS: Record<SpaceId, SpaceDesign> = {
  prospecting: {
    id: 'prospecting',
    label: ROOM_LABELS.prospecting,
    icon: '🔍',
    theme: { floor: '#cfe8e1', floorAlt: '#c1dfd7', floorStyle: 'tiles', accent: '#2a9d8f' },
    props: [
      { kind: 'rug', at: [0.3, 0.3], size: [2.6, 1.8], color: '#9fd1c6' },
      { kind: 'workstation', at: [-2.6, -1.2], rot: 1, screen: 'play', accessory: 'mug' },
      { kind: 'workstation', at: [-2.6, 0.7], rot: 1, screen: 'thumbnails', accessory: 'papers' },
      { kind: 'workstation', at: [2.3, 0.3], screen: 'play', accessory: 'mug' },
      { kind: 'beanBag', at: [1.9, -2.0], color: '#2a9d8f' },
      { kind: 'plantTall', at: [3.0, -2.5] },
      { kind: 'filingCabinet', at: [2.95, 2.4], rot: 3 },
      { kind: 'plantSmall', at: [-1.2, 2.5] },
    ],
    wallProps: [
      { kind: 'wallScreen', wall: 'north', offset: 0, width: 2.6, y: 0.95, screen: 'thumbnails' },
      { kind: 'corkboard', wall: 'north', offset: -2.5, width: 1.2, y: 0.95 },
    ],
  },

  analysis: {
    id: 'analysis',
    label: ROOM_LABELS.analysis,
    icon: '🌍',
    theme: { floor: '#d6e4f5', floorAlt: '#c8daef', floorStyle: 'tiles', accent: '#3d7cc9' },
    props: [
      { kind: 'rug', at: [-0.4, -0.2], size: [3.0, 2.8], color: '#b3cbea' },
      { kind: 'meetingTable', at: [-0.4, -0.2] },
      { kind: 'workstation', at: [-2.6, 1.5], rot: 1, screen: 'chart', accessory: 'papers' },
      { kind: 'workstation', at: [2.3, 1.3], screen: 'barChart', accessory: 'mug' },
      { kind: 'globeStand', at: [2.6, -0.6] },
      { kind: 'plant', at: [-3.0, -2.5] },
      { kind: 'plantSmall', at: [3.05, -2.55] },
      { kind: 'filingCabinet', at: [0.55, -2.5] },
    ],
    wallProps: [
      { kind: 'wallScreen', wall: 'north', offset: -1.2, width: 2.4, y: 0.95, screen: 'worldMap' },
      { kind: 'wallScreen', wall: 'north', offset: 1.9, width: 1.6, y: 0.95, screen: 'barChart' },
    ],
  },

  director: {
    id: 'director',
    label: ROOM_LABELS.director,
    icon: '✅',
    theme: { floor: '#d9b48a', floorAlt: '#cda57a', floorStyle: 'planks', accent: '#c08a2b' },
    props: [
      { kind: 'rug', at: [-1.6, 1.6], size: [2.4, 2.2], color: '#9c4f3f' },
      { kind: 'bookshelf', at: [-2.4, -2.6] },
      { kind: 'executiveDesk', at: [0.2, -1.2] },
      // Chaises visiteurs tournées vers le bureau (dossier côté sud).
      { kind: 'chair', at: [-0.3, 0.3], color: '#7a5c45' },
      { kind: 'chair', at: [0.7, 0.3], color: '#7a5c45' },
      { kind: 'sofa', at: [-2.3, 1.6], rot: 1, color: '#3f6b5a' },
      { kind: 'coffeeTable', at: [-1.2, 1.6], rot: 1 },
      { kind: 'floorLamp', at: [-3.0, 2.5] },
      { kind: 'plantTall', at: [3.0, -2.5] },
      { kind: 'plant', at: [2.9, 2.4] },
    ],
    wallProps: [
      { kind: 'painting', wall: 'north', offset: 0.2, width: 1.2, y: 1.05 },
      { kind: 'checkSign', wall: 'north', offset: 2.2, width: 0.8, y: 1.05 },
    ],
  },

  dubbing: {
    id: 'dubbing',
    label: ROOM_LABELS.dubbing,
    icon: '🎙️',
    theme: { floor: '#4b4266', floorAlt: '#443b5d', floorStyle: 'carpet', accent: '#9b6dff' },
    props: [
      { kind: 'rug', at: [-1.4, -1.3], size: [2.2, 1.6], color: '#2f2945' },
      { kind: 'greenScreen', at: [1.9, -2.45] },
      { kind: 'micStand', at: [-1.8, -1.3] },
      { kind: 'micStand', at: [-0.8, -1.1] },
      { kind: 'cameraTripod', at: [1.9, -0.6], rot: 2 },
      { kind: 'softbox', at: [0.75, -1.5], rot: 2 },
      { kind: 'softbox', at: [3.0, -1.5], rot: 2 },
      { kind: 'mixingDesk', at: [-2.0, 1.4], screen: 'wave' },
      { kind: 'plant', at: [2.9, 2.4] },
    ],
    wallProps: [
      { kind: 'acousticPanels', wall: 'north', offset: -1.6, width: 2.6, y: 0.85 },
      { kind: 'onAirSign', wall: 'north', offset: 0.2, width: 0.8, y: 1.25 },
    ],
  },

  copywriting: {
    id: 'copywriting',
    label: ROOM_LABELS.copywriting,
    icon: '✍️',
    theme: { floor: '#f7dccf', floorAlt: '#f1cebe', floorStyle: 'tiles', accent: '#e76f51' },
    props: [
      { kind: 'longTable', at: [0, 0.6] },
      { kind: 'whiteboardStand', at: [-2.2, -2.3] },
      { kind: 'easel', at: [2.5, -2.2] },
      { kind: 'workstation', at: [2.5, 1.9], screen: 'doc', accessory: 'mug' },
      { kind: 'printer', at: [-2.8, 2.4], rot: 2 },
      { kind: 'plantTall', at: [-3.0, 0.6] },
      { kind: 'plantSmall', at: [1.3, -2.4] },
      { kind: 'waterCooler', at: [3.05, 0.0], rot: 3 },
    ],
    wallProps: [],
  },

  email_review: {
    id: 'email_review',
    label: ROOM_LABELS.email_review,
    icon: '📨',
    theme: { floor: '#f8ecc4', floorAlt: '#f2e1ad', floorStyle: 'tiles', accent: '#e0a100' },
    props: [
      { kind: 'rug', at: [0, 0.1], size: [6.0, 1.9], color: '#efd27c' },
      { kind: 'workstation', at: [-2.1, 0.0], screen: 'mail', accessory: 'trays' },
      { kind: 'workstation', at: [0.0, 0.0], screen: 'inbox', accessory: 'trays' },
      { kind: 'workstation', at: [2.1, 0.0], screen: 'mail', accessory: 'papers' },
      { kind: 'mailboxRack', at: [-2.2, -2.45] },
      { kind: 'screenStand', at: [1.6, -2.4], screen: 'inbox' },
      { kind: 'printer', at: [2.95, -2.4] },
      { kind: 'armchair', at: [-2.6, 2.1], rot: 2, color: '#d98c2b' },
      { kind: 'plantSmall', at: [-1.4, 2.4] },
      { kind: 'plant', at: [2.95, 2.45] },
    ],
    wallProps: [],
  },

  followup: {
    id: 'followup',
    label: ROOM_LABELS.followup,
    icon: '📞',
    theme: { floor: '#dcefd2', floorAlt: '#cee6c2', floorStyle: 'tiles', accent: '#43a047' },
    props: [
      { kind: 'kanbanStand', at: [-2.05, -2.3] },
      { kind: 'workstation', at: [-1.6, 0.3], screen: 'kanban', accessory: 'papers' },
      { kind: 'workstation', at: [1.6, -0.3], screen: 'phone', accessory: 'headset' },
      { kind: 'sofa', at: [1.6, 2.2], rot: 2, color: '#4f7f6a' },
      { kind: 'coffeeTable', at: [1.6, 1.3] },
      { kind: 'plantTall', at: [3.0, -2.5] },
      { kind: 'filingCabinet', at: [-3.0, 2.4], rot: 2 },
      { kind: 'plantSmall', at: [-2.0, 2.5] },
    ],
    wallProps: [],
  },

  lounge: {
    id: 'lounge',
    label: 'Accueil',
    icon: '☕',
    theme: { floor: '#ece4d8', floorAlt: '#e3d8c8', floorStyle: 'planks', accent: '#8d7b68' },
    props: [
      { kind: 'rug', at: [0.0, 1.5], size: [3.4, 2.2], color: '#c9b8a3' },
      // Comptoir tourné vers la porte (nord) : l'hôte d'accueil se tient côté salon.
      { kind: 'receptionDesk', at: [1.6, -0.9], rot: 2 },
      { kind: 'kitchenette', at: [-3.0, -0.6], rot: 1 },
      { kind: 'waterCooler', at: [-3.05, -2.4], rot: 1 },
      { kind: 'sofa', at: [0.6, 2.2], rot: 2, color: '#b0674f' },
      { kind: 'armchair', at: [-1.4, 1.4], rot: 1, color: '#d0a35f' },
      { kind: 'coffeeTable', at: [0.6, 1.2] },
      { kind: 'plantTall', at: [2.9, -2.4] },
      { kind: 'plant', at: [-2.9, 2.5] },
    ],
    wallProps: [
      { kind: 'window', wall: 'west', offset: 1.2, width: 1.4, y: 0.95 },
      { kind: 'clock', wall: 'west', offset: 2.4, width: 0.45, y: 1.25 },
    ],
  },
};
