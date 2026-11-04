import { describe, expect, it } from 'vitest';
import { ROOM_IDS } from '@agency/shared';
import {
  AGENCY_BOUNDS,
  CORRIDOR,
  ROOM_INTERIOR,
  ROOM_SIZE,
  SPACE_PLACEMENTS,
  WALL,
  doorClearance,
  wallHeight,
  type SpaceId,
} from '../layout/agencyLayout';
import { FLOOR_PROPS, WALL_PROPS } from '../props/catalog';
import { SPACE_DESIGNS, type FloorPlacement } from './roomDesigns';

/**
 * Vérifie la cohérence spatiale de l'agence : aucun meuble ne déborde, ne se chevauche,
 * ne bloque une porte ni ne traverse un objet mural.
 */

interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const EPS = 1e-6;

function footprint(p: FloorPlacement): Rect {
  const base = FLOOR_PROPS[p.kind];
  const [w0, d0] = p.size ?? [base.w, base.d];
  const swapped = (p.rot ?? 0) % 2 === 1;
  const w = swapped ? d0 : w0;
  const d = swapped ? w0 : d0;
  return {
    minX: p.at[0] - w / 2,
    maxX: p.at[0] + w / 2,
    minZ: p.at[1] - d / 2,
    maxZ: p.at[1] + d / 2,
  };
}

const overlaps = (a: Rect, b: Rect) =>
  a.minX < b.maxX - EPS && b.minX < a.maxX - EPS && a.minZ < b.maxZ - EPS && b.minZ < a.maxZ - EPS;

const inside = (r: Rect, bounds: Rect) =>
  r.minX >= bounds.minX - EPS &&
  r.maxX <= bounds.maxX + EPS &&
  r.minZ >= bounds.minZ - EPS &&
  r.maxZ <= bounds.maxZ + EPS;

const isFlat = (p: FloorPlacement) => 'flat' in FLOOR_PROPS[p.kind];
const label = (p: FloorPlacement) => `${p.kind}@${p.at.join(',')}`;

const spaces = Object.keys(SPACE_DESIGNS) as SpaceId[];

describe('plan de l’agence', () => {
  it('place les sept salles du CRM, plus l’accueil', () => {
    const roomSpaces = spaces.filter((id) => id !== 'lounge');
    expect([...roomSpaces].sort()).toEqual([...ROOM_IDS].sort());
    expect(Object.keys(SPACE_PLACEMENTS).sort()).toEqual([...spaces].sort());
  });

  it('les salles ne se chevauchent pas et restent sur le socle', () => {
    const rects = spaces.map((id) => {
      const [cx, cz] = SPACE_PLACEMENTS[id].center;
      return {
        id,
        rect: {
          minX: cx - ROOM_SIZE.width / 2,
          maxX: cx + ROOM_SIZE.width / 2,
          minZ: cz - ROOM_SIZE.depth / 2,
          maxZ: cz + ROOM_SIZE.depth / 2,
        },
      };
    });
    for (const [i, a] of rects.entries()) {
      expect(inside(a.rect, AGENCY_BOUNDS), `${a.id} hors du socle`).toBe(true);
      for (const b of rects.slice(i + 1)) {
        expect(overlaps(a.rect, b.rect), `${a.id} chevauche ${b.id}`).toBe(false);
      }
    }
  });

  it('chaque porte donne sur le couloir', () => {
    for (const id of spaces) {
      const { center, door } = SPACE_PLACEMENTS[id];
      const doorZ = center[1] + (door === 'south' ? ROOM_SIZE.depth / 2 : -ROOM_SIZE.depth / 2);
      expect(doorZ === CORRIDOR.minZ || doorZ === CORRIDOR.maxZ, `${id} : porte hors couloir`).toBe(
        true,
      );
    }
  });

  it('seuls les murs du pourtour nord et ouest sont hauts', () => {
    for (const id of spaces) {
      const { center, tallWalls } = SPACE_PLACEMENTS[id];
      for (const side of tallWalls) {
        if (side === 'north') expect(center[1]).toBeLessThan(0);
        if (side === 'west') expect(center[0] - ROOM_SIZE.width / 2).toBe(AGENCY_BOUNDS.minX + 0.5);
        expect(['north', 'west']).toContain(side);
      }
    }
  });
});

describe.each(spaces)('aménagement : %s', (id) => {
  const design = SPACE_DESIGNS[id];
  const placement = SPACE_PLACEMENTS[id];
  const solids = design.props.filter((p) => !isFlat(p));

  it('tous les meubles restent à l’intérieur des murs', () => {
    for (const p of design.props) {
      expect(inside(footprint(p), ROOM_INTERIOR), `${label(p)} déborde`).toBe(true);
    }
  });

  it('aucun meuble n’en chevauche un autre', () => {
    for (const [i, a] of solids.entries()) {
      for (const b of solids.slice(i + 1)) {
        expect(overlaps(footprint(a), footprint(b)), `${label(a)} chevauche ${label(b)}`).toBe(
          false,
        );
      }
    }
  });

  it('l’accès à la porte reste dégagé', () => {
    const clearance = doorClearance(placement.door);
    for (const p of solids) {
      expect(overlaps(footprint(p), clearance), `${label(p)} bloque la porte`).toBe(false);
    }
  });

  it('les objets muraux sont sur des murs hauts, sans dépasser ni se chevaucher', () => {
    for (const w of design.wallProps) {
      expect(placement.tallWalls, `${w.kind} sur un mur bas`).toContain(w.wall);
      const half = w.wall === 'north' ? ROOM_INTERIOR.maxX : ROOM_INTERIOR.maxZ;
      expect(Math.abs(w.offset) + w.width / 2, `${w.kind} dépasse du mur`).toBeLessThanOrEqual(
        half + EPS,
      );
      const { h } = WALL_PROPS[w.kind];
      expect(w.y - h / 2, `${w.kind} touche le sol`).toBeGreaterThan(0.2);
      expect(w.y + h / 2, `${w.kind} dépasse le haut du mur`).toBeLessThanOrEqual(
        wallHeight(placement, w.wall) - 0.02,
      );
    }
    const byWall = (wall: 'north' | 'west') => design.wallProps.filter((w) => w.wall === wall);
    for (const wall of ['north', 'west'] as const) {
      const items = byWall(wall);
      for (const [i, a] of items.entries()) {
        for (const b of items.slice(i + 1)) {
          const apart = Math.abs(a.offset - b.offset) >= (a.width + b.width) / 2 - EPS;
          expect(apart, `${a.kind} chevauche ${b.kind}`).toBe(true);
        }
      }
    }
  });

  it('aucun meuble haut ne traverse un objet mural', () => {
    for (const w of design.wallProps) {
      const bottom = w.y - WALL_PROPS[w.kind].h / 2;
      const band: Rect =
        w.wall === 'north'
          ? {
              minX: w.offset - w.width / 2,
              maxX: w.offset + w.width / 2,
              minZ: ROOM_INTERIOR.minZ,
              maxZ: ROOM_INTERIOR.minZ + 0.5,
            }
          : {
              minX: ROOM_INTERIOR.minX,
              maxX: ROOM_INTERIOR.minX + 0.5,
              minZ: w.offset - w.width / 2,
              maxZ: w.offset + w.width / 2,
            };
      for (const p of solids) {
        if (!overlaps(footprint(p), band)) continue;
        expect(FLOOR_PROPS[p.kind].h, `${label(p)} traverse ${w.kind}`).toBeLessThan(bottom);
      }
    }
  });

  it('le mur nord d’une salle de devant porte la porte, donc reste bas', () => {
    if (placement.door === 'north') expect(wallHeight(placement, 'north')).toBe(WALL.lowHeight);
  });
});
