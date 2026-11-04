import {
  DOOR,
  ROOM_FLOOR_HEIGHT,
  ROOM_SIZE,
  WALL,
  wallHeight,
  type SpacePlacement,
  type WallSide,
} from '../layout/agencyLayout';

/**
 * Géométrie du sol et des murs d'une salle (données pures, testées par roomGeometry.test.ts).
 * Coordonnées locales : origine au centre de la salle, y = 0 au niveau du couloir.
 *
 * Deux règles garantissent des jonctions propres, sans surfaces superposées (z-fighting) :
 * - le sol est légèrement en retrait sous les murs : ses bords sont cachés dans l'épaisseur
 *   des murs et ne coïncident jamais avec leurs faces extérieures ;
 * - chaque angle appartient à un seul mur (le plus haut ; à égalité, le mur nord ou sud),
 *   l'autre s'arrête contre lui : aucun volume n'est compté deux fois.
 */

const W = ROOM_SIZE.width;
const D = ROOM_SIZE.depth;
const T = WALL.thickness;

/** Retrait du bord du sol par rapport à la face extérieure des murs. */
export const FLOOR_INSET = 0.01;

/** Dimensions de la dalle de sol. */
export const FLOOR_SIZE = {
  width: W - FLOOR_INSET * 2,
  depth: D - FLOOR_INSET * 2,
  height: ROOM_FLOOR_HEIGHT,
} as const;

/** Chaperon (couvertine) en bois posé sur le haut des murs. */
export const CAP = { height: 0.04, overhang: 0.01 } as const;

type Vec3 = [number, number, number];

export interface WallSegment {
  key: string;
  side: WallSide;
  height: number;
  size: Vec3;
  position: Vec3;
  cap: { size: Vec3; position: Vec3 };
}

const isHorizontal = (side: WallSide) => side === 'north' || side === 'south';

/** Murs voisins aux deux extrémités d'un mur (début = côté x ou z négatif). */
const NEIGHBOURS: Record<WallSide, [WallSide, WallSide]> = {
  north: ['west', 'east'],
  south: ['west', 'east'],
  west: ['north', 'south'],
  east: ['north', 'south'],
};

/** Le mur `side` occupe-t-il l'angle qu'il partage avec `other` ? */
function ownsCorner(placement: SpacePlacement, side: WallSide, other: WallSide): boolean {
  const mine = wallHeight(placement, side);
  const theirs = wallHeight(placement, other);
  return isHorizontal(side) ? mine >= theirs : mine > theirs;
}

/**
 * Prolongement (ou retrait, si négatif) du chaperon à une extrémité de mur qui touche un angle.
 * - Mur qui occupe l'angle : le chaperon déborde comme sur ses côtés.
 * - Contre un mur de même hauteur : il s'arrête bord à bord avec le chaperon voisin.
 * - Contre un mur plus haut : il s'arrête contre la face intérieure de ce mur.
 */
function capExtension(placement: SpacePlacement, side: WallSide, other: WallSide): number {
  if (ownsCorner(placement, side, other)) return CAP.overhang;
  return wallHeight(placement, side) === wallHeight(placement, other) ? -CAP.overhang : 0;
}

/** Découpe les quatre murs en segments (ouverture de porte comprise). */
export function wallSegments(placement: SpacePlacement): WallSegment[] {
  return (['north', 'south', 'east', 'west'] as const).flatMap((side) => {
    const horizontal = isHorizontal(side);
    const length = horizontal ? W : D;
    const height = wallHeight(placement, side);
    const [startNeighbour, endNeighbour] = NEIGHBOURS[side];
    const ownsStart = ownsCorner(placement, side, startNeighbour);
    const ownsEnd = ownsCorner(placement, side, endNeighbour);
    const fixed =
      side === 'north'
        ? -D / 2 + T / 2
        : side === 'south'
          ? D / 2 - T / 2
          : side === 'west'
            ? -W / 2 + T / 2
            : W / 2 - T / 2;

    const from = -length / 2 + (ownsStart ? 0 : T);
    const to = length / 2 - (ownsEnd ? 0 : T);
    const startExt = capExtension(placement, side, startNeighbour);
    const endExt = capExtension(placement, side, endNeighbour);

    // [début, fin, prolongement du chaperon au début, à la fin]
    const ranges: [number, number, number, number][] =
      side === placement.door
        ? [
            [from, -DOOR.width / 2, startExt, CAP.overhang],
            [DOOR.width / 2, to, CAP.overhang, endExt],
          ]
        : [[from, to, startExt, endExt]];

    return ranges.map(([a, b, extA, extB], i) => {
      const len = b - a;
      const mid = (a + b) / 2;
      const capFrom = a - extA;
      const capTo = b + extB;
      const capLen = capTo - capFrom;
      const capMid = (capFrom + capTo) / 2;
      const capThickness = T + CAP.overhang * 2;
      const capY = height + CAP.height / 2;
      return {
        key: `${side}-${i}`,
        side,
        height,
        size: horizontal ? [len, height, T] : [T, height, len],
        position: horizontal ? [mid, height / 2, fixed] : [fixed, height / 2, mid],
        cap: {
          size: horizontal
            ? [capLen, CAP.height, capThickness]
            : [capThickness, CAP.height, capLen],
          position: horizontal ? [capMid, capY, fixed] : [fixed, capY, capMid],
        },
      } satisfies WallSegment;
    });
  });
}
