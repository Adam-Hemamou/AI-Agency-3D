import type { RoomId } from '@agency/shared';

/**
 * Plan de l'agence (données pures, sans Three.js) : dimensions, position des salles,
 * murs et portes. Unité : 1 = 1 mètre environ. Axe x vers l'est, axe z vers le sud
 * (vers la caméra), y vers le haut.
 *
 *            NORD (murs hauts)
 *   ┌───────────┬───────────┬───────────┬───────────┐
 *   │Prospection│  Analyse  │ Mon bureau│  Doublage │   rangée du fond
 *   └─────┬─────┴─────┬─────┴─────┬─────┴─────┬─────┘
 *   ════ couloir ══════════════════════════════════  (le flux du pipeline fait un U)
 *   ┌─────┴─────┬─────┴─────┬─────┴─────┬─────┴─────┐
 *   │  Accueil  │   Suivi   │  E-mails  │Commerciale│   rangée de devant
 *   └───────────┴───────────┴───────────┴───────────┘
 *            SUD (côté caméra)
 */

export type WallSide = 'north' | 'south' | 'east' | 'west';

export const ROOM_SIZE = { width: 7, depth: 6 } as const;
export const ROOM_SPACING_X = 7.5;
export const ROW_Z = { back: -4.5, front: 4.5 } as const;
export const CORRIDOR = { minZ: -1.5, maxZ: 1.5 } as const;

export const WALL = {
  thickness: 0.15,
  /** Murs du pourtour nord et ouest : ils ferment le décor sans masquer l'intérieur. */
  tallHeight: 1.5,
  /** Tous les autres murs restent bas pour voir l'intérieur des pièces. */
  lowHeight: 0.5,
} as const;

export const DOOR = { width: 1.6, clearanceDepth: 1.2 } as const;

/** Hauteur du sol des salles (légèrement surélevé par rapport au couloir). */
export const ROOM_FLOOR_HEIGHT = 0.06;

/** Emprise du socle de l'agence. */
export const AGENCY_BOUNDS = { minX: -15.25, maxX: 15.25, minZ: -8, maxZ: 8 } as const;

/** Intérieur d'une salle en coordonnées locales (centre de la salle = origine). */
export const ROOM_INTERIOR = {
  minX: -ROOM_SIZE.width / 2 + WALL.thickness,
  maxX: ROOM_SIZE.width / 2 - WALL.thickness,
  minZ: -ROOM_SIZE.depth / 2 + WALL.thickness,
  maxZ: ROOM_SIZE.depth / 2 - WALL.thickness,
} as const;

/** Identifiant d'un espace : une salle du CRM, ou l'accueil (décoratif, non interactif). */
export type SpaceId = RoomId | 'lounge';

export interface SpacePlacement {
  id: SpaceId;
  /** Centre de la salle (x, z) en coordonnées monde. */
  center: readonly [number, number];
  /** Côté de la porte : toujours vers le couloir. */
  door: 'north' | 'south';
  /** Murs hauts (pourtour de l'agence). */
  tallWalls: readonly WallSide[];
}

const COLUMNS_X = [-1.5, -0.5, 0.5, 1.5].map((i) => i * ROOM_SPACING_X);

function place(id: SpaceId, column: number, row: 'back' | 'front'): SpacePlacement {
  const tallWalls: WallSide[] = [];
  if (row === 'back') tallWalls.push('north');
  if (column === 0) tallWalls.push('west');
  return {
    id,
    center: [COLUMNS_X[column] ?? 0, ROW_Z[row]],
    door: row === 'back' ? 'south' : 'north',
    tallWalls,
  };
}

/**
 * Disposition en U, dans l'ordre du pipeline : rangée du fond de gauche à droite,
 * puis rangée de devant de droite à gauche.
 */
export const SPACE_PLACEMENTS: Record<SpaceId, SpacePlacement> = {
  prospecting: place('prospecting', 0, 'back'),
  analysis: place('analysis', 1, 'back'),
  director: place('director', 2, 'back'),
  dubbing: place('dubbing', 3, 'back'),
  copywriting: place('copywriting', 3, 'front'),
  email_review: place('email_review', 2, 'front'),
  followup: place('followup', 1, 'front'),
  lounge: place('lounge', 0, 'front'),
};

/** Zone à laisser libre devant la porte (coordonnées locales). */
export function doorClearance(door: 'north' | 'south') {
  const half = DOOR.width / 2;
  return door === 'south'
    ? {
        minX: -half,
        maxX: half,
        minZ: ROOM_INTERIOR.maxZ - DOOR.clearanceDepth,
        maxZ: ROOM_INTERIOR.maxZ,
      }
    : {
        minX: -half,
        maxX: half,
        minZ: ROOM_INTERIOR.minZ,
        maxZ: ROOM_INTERIOR.minZ + DOOR.clearanceDepth,
      };
}

/** Hauteur d'un mur selon son côté. */
export function wallHeight(placement: SpacePlacement, side: WallSide): number {
  return placement.tallWalls.includes(side) ? WALL.tallHeight : WALL.lowHeight;
}
