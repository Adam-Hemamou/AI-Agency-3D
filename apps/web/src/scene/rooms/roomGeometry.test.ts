import { describe, expect, it } from 'vitest';
import {
  DOOR,
  ROOM_SIZE,
  SPACE_PLACEMENTS,
  WALL,
  wallHeight,
  type SpaceId,
  type WallSide,
} from '../layout/agencyLayout';
import { FLOOR_INSET, FLOOR_SIZE, wallSegments, type WallSegment } from './roomGeometry';

/**
 * Jonctions propres entre sol et murs : aucun volume ni aucune face en double,
 * ce qui provoquerait du z-fighting (bandes qui scintillent).
 */

interface Aabb {
  min: [number, number, number];
  max: [number, number, number];
}

const EPS = 1e-6;
const W = ROOM_SIZE.width;
const D = ROOM_SIZE.depth;
const T = WALL.thickness;

function aabb(size: readonly number[], position: readonly number[]): Aabb {
  const half = size.map((s) => s / 2);
  return {
    min: [0, 1, 2].map((i) => position[i]! - half[i]!) as Aabb['min'],
    max: [0, 1, 2].map((i) => position[i]! + half[i]!) as Aabb['max'],
  };
}

const overlap = (a: Aabb, b: Aabb) =>
  [0, 1, 2].every((i) => a.min[i]! < b.max[i]! - EPS && b.min[i]! < a.max[i]! - EPS);

const wallBox = (s: WallSegment) => aabb(s.size, s.position);
const capBox = (s: WallSegment) => aabb(s.cap.size, s.cap.position);
const spaces = Object.keys(SPACE_PLACEMENTS) as SpaceId[];

describe.each(spaces)('murs et sol : %s', (id) => {
  const placement = SPACE_PLACEMENTS[id];
  const segments = wallSegments(placement);

  it('aucun mur ne chevauche un autre mur', () => {
    for (const [i, a] of segments.entries()) {
      for (const b of segments.slice(i + 1)) {
        expect(overlap(wallBox(a), wallBox(b)), `${a.key} / ${b.key}`).toBe(false);
      }
    }
  });

  it('aucun chaperon ne chevauche un autre chaperon ni un mur', () => {
    for (const [i, a] of segments.entries()) {
      for (const b of segments.slice(i + 1)) {
        expect(overlap(capBox(a), capBox(b)), `chaperons ${a.key} / ${b.key}`).toBe(false);
      }
      for (const b of segments) {
        expect(overlap(capBox(a), wallBox(b)), `chaperon ${a.key} / mur ${b.key}`).toBe(false);
      }
    }
  });

  it('chaque angle est occupé par un seul mur, le plus haut', () => {
    const corners: [WallSide, WallSide, number, number][] = [
      ['north', 'west', -W / 2 + T / 2, -D / 2 + T / 2],
      ['north', 'east', W / 2 - T / 2, -D / 2 + T / 2],
      ['south', 'west', -W / 2 + T / 2, D / 2 - T / 2],
      ['south', 'east', W / 2 - T / 2, D / 2 - T / 2],
    ];
    for (const [a, b, x, z] of corners) {
      const column = aabb([T * 0.5, 0.01, T * 0.5], [x, 0.005, z]);
      const owners = segments.filter((s) => overlap(wallBox(s), column));
      expect(owners, `angle ${a}-${b}`).toHaveLength(1);
      const expected = Math.max(wallHeight(placement, a), wallHeight(placement, b));
      expect(owners[0]!.height).toBe(expected);
    }
  });

  it('les murs ferment tout le pourtour, sauf l’ouverture de la porte', () => {
    // Échantillonne le pourtour, au milieu de l'épaisseur des murs.
    for (let t = -0.5; t <= 0.5; t += 0.01) {
      const points: [WallSide, number, number][] = [
        ['north', t * W, -D / 2 + T / 2],
        ['south', t * W, D / 2 - T / 2],
        ['west', -W / 2 + T / 2, t * D],
        ['east', W / 2 - T / 2, t * D],
      ];
      for (const [side, x, z] of points) {
        const inDoor = side === placement.door && Math.abs(x) < DOOR.width / 2 - EPS;
        const probe = aabb([0.001, 0.001, 0.001], [x, 0.03, z]);
        const covered = segments.some((s) => overlap(wallBox(s), probe));
        expect(covered, `${side} en ${x.toFixed(2)}, ${z.toFixed(2)}`).toBe(!inDoor);
      }
    }
  });

  it('le bord du sol est caché dans l’épaisseur des murs, sans face commune', () => {
    expect(FLOOR_INSET).toBeGreaterThan(0.001);
    expect(FLOOR_INSET).toBeLessThan(T);
    expect(FLOOR_SIZE.width).toBeCloseTo(W - 2 * FLOOR_INSET);
    expect(FLOOR_SIZE.depth).toBeCloseTo(D - 2 * FLOOR_INSET);
  });
});
