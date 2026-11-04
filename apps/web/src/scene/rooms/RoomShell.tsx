import { useMemo } from 'react';
import {
  DOOR,
  ROOM_FLOOR_HEIGHT,
  ROOM_SIZE,
  WALL,
  wallHeight,
  type SpacePlacement,
} from '../layout/agencyLayout';
import { PALETTE, getMaterial } from '../materials';
import { Box } from '../props/primitives';
import { FLOOR_SIZE, wallSegments } from './roomGeometry';
import type { SpaceTheme } from './roomDesigns';

/** Sol et murs d'une salle (coordonnées locales, origine au centre, y = 0 au niveau du couloir). */

const W = ROOM_SIZE.width;
const D = ROOM_SIZE.depth;
const T = WALL.thickness;

function Floor({ theme }: { theme: SpaceTheme }) {
  const stripes = useMemo(() => {
    if (theme.floorStyle === 'carpet') return [];
    const count = theme.floorStyle === 'planks' ? 14 : 7;
    const horizontal = theme.floorStyle === 'planks';
    const span = horizontal ? D : W;
    // Les bandes restent sur la dalle : aucune ne touche la face extérieure d'un mur.
    const limit = (horizontal ? FLOOR_SIZE.depth : FLOOR_SIZE.width) / 2;
    const step = span / count;
    return Array.from({ length: count }, (_, i) => i)
      .filter((i) => i % 2 === 1)
      .map((i) => {
        const from = Math.max(-limit, -span / 2 + step * i);
        const to = Math.min(limit, -span / 2 + step * (i + 1));
        return { i, offset: (from + to) / 2, size: to - from, horizontal };
      });
  }, [theme.floorStyle]);

  return (
    <group>
      <Box
        size={[FLOOR_SIZE.width, FLOOR_SIZE.height, FLOOR_SIZE.depth]}
        position={[0, FLOOR_SIZE.height / 2, 0]}
        color={theme.floor}
        shadows={false}
      />
      {stripes.map(({ i, offset, size, horizontal }) => (
        <Box
          key={i}
          size={horizontal ? [FLOOR_SIZE.width, 0.004, size] : [size, 0.004, FLOOR_SIZE.depth]}
          position={
            horizontal
              ? [0, ROOM_FLOOR_HEIGHT + 0.002, offset]
              : [offset, ROOM_FLOOR_HEIGHT + 0.002, 0]
          }
          color={theme.floorAlt}
          shadows={false}
        />
      ))}
    </group>
  );
}

export function RoomShell({ placement, theme }: { placement: SpacePlacement; theme: SpaceTheme }) {
  const segments = useMemo(() => wallSegments(placement), [placement]);

  const doorZ = placement.door === 'south' ? D / 2 - T / 2 : -D / 2 + T / 2;
  const doorHeight = wallHeight(placement, placement.door);

  return (
    <group>
      <Floor theme={theme} />
      {segments.map((s) => (
        <group key={s.key}>
          <Box size={s.size} position={s.position} material={getMaterial(PALETTE.wall)} />
          {/* Chaperon en bois sur le haut du mur. */}
          <Box size={s.cap.size} position={s.cap.position} color={PALETTE.wallCap} />
        </group>
      ))}
      {/* Montants de porte à la couleur de la salle. */}
      {[-DOOR.width / 2, DOOR.width / 2].map((x) => (
        <Box
          key={x}
          size={[0.1, doorHeight + 0.08, T + 0.06]}
          position={[x, (doorHeight + 0.08) / 2, doorZ]}
          color={theme.accent}
        />
      ))}
      {/* Paillasson devant la porte, côté couloir. */}
      <Box
        size={[DOOR.width * 0.8, 0.012, 0.5]}
        position={[0, 0.006, placement.door === 'south' ? D / 2 + 0.3 : -D / 2 - 0.3]}
        color={theme.accent}
        shadows={false}
      />
    </group>
  );
}
