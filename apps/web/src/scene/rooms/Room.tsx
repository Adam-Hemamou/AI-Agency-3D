import { memo, useRef } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import type { RoomId } from '@agency/shared';
import { useAgencyStore } from '../../stores/agencyStore';
import {
  ROOM_FLOOR_HEIGHT,
  ROOM_SIZE,
  WALL,
  wallHeight,
  type SpacePlacement,
  type WallSide,
} from '../layout/agencyLayout';
import { getMaterial } from '../materials';
import { FloorProp, WallProp } from '../props/registry';
import { MergeStatic } from '../performance/MergeStatic';
import { RoomShell } from './RoomShell';
import type { SpaceDesign } from './roomDesigns';

/** Contenu figé d'une salle (sol, murs, mobilier) : ne se redessine pas au survol. */
const RoomContents = memo(function RoomContents({
  design,
  placement,
}: {
  design: SpaceDesign;
  placement: SpacePlacement;
}) {
  return (
    <MergeStatic>
      <RoomShell placement={placement} theme={design.theme} />
      <group position={[0, ROOM_FLOOR_HEIGHT, 0]}>
        {design.props.map((p, i) => (
          <FloorProp key={i} placement={p} accent={design.theme.accent} />
        ))}
      </group>
      {design.wallProps.map((w, i) => (
        <WallProp key={i} placement={w} accent={design.theme.accent} />
      ))}
    </MergeStatic>
  );
});

/** Teinte posée sur le sol et liseré sur le haut des murs quand la salle est survolée ou choisie. */
function Highlight({
  accent,
  level,
  placement,
}: {
  accent: string;
  level: 'hover' | 'selected';
  placement: SpacePlacement;
}) {
  const opacity = level === 'selected' ? 0.22 : 0.12;
  const frame = getMaterial(accent, {
    emissive: accent,
    emissiveIntensity: level === 'selected' ? 0.9 : 0.5,
  });
  const top = (side: WallSide) => wallHeight(placement, side) + 0.07;
  const w = ROOM_SIZE.width;
  const d = ROOM_SIZE.depth;
  const t = 0.07;
  return (
    <group>
      <mesh
        position={[0, ROOM_FLOOR_HEIGHT + 0.03, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={1}
      >
        <planeGeometry args={[w - 0.3, d - 0.3]} />
        <meshBasicMaterial color={accent} transparent opacity={opacity} depthWrite={false} />
      </mesh>
      {/* Liseré lumineux tout autour de la salle. */}
      {[
        { size: [w, t, t], pos: [0, top('north'), -(d - WALL.thickness) / 2] },
        { size: [w, t, t], pos: [0, top('south'), (d - WALL.thickness) / 2] },
        { size: [t, t, d], pos: [-(w - WALL.thickness) / 2, top('west'), 0] },
        { size: [t, t, d], pos: [(w - WALL.thickness) / 2, top('east'), 0] },
      ].map(({ size, pos }, i) => (
        <mesh key={i} position={pos as [number, number, number]} material={frame}>
          <boxGeometry args={size as [number, number, number]} />
        </mesh>
      ))}
    </group>
  );
}

const hitMaterial = getMaterial('#ffffff', { opacity: 0 });
hitMaterial.depthWrite = false;

/** Distance (px) au-delà de laquelle un clic est considéré comme un déplacement de caméra. */
const DRAG_THRESHOLD = 6;

interface RoomProps {
  design: SpaceDesign;
  placement: SpacePlacement;
  /** Absent pour l'accueil, purement décoratif. */
  roomId?: RoomId;
}

export function Room({ design, placement, roomId }: RoomProps) {
  const hovered = useAgencyStore((s) => roomId !== undefined && s.hoveredRoom === roomId);
  const selected = useAgencyStore((s) => roomId !== undefined && s.selectedRoom === roomId);
  const setHoveredRoom = useAgencyStore((s) => s.setHoveredRoom);
  const selectRoom = useAgencyStore((s) => s.selectRoom);
  const pointerDown = useRef<{ x: number; y: number } | null>(null);

  const interactive = roomId !== undefined;
  const [cx, cz] = placement.center;

  const handlers = interactive
    ? {
        onPointerOver: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          setHoveredRoom(roomId);
          document.body.style.cursor = 'pointer';
        },
        onPointerOut: () => {
          if (useAgencyStore.getState().hoveredRoom === roomId) setHoveredRoom(null);
          document.body.style.cursor = '';
        },
        onPointerDown: (e: ThreeEvent<PointerEvent>) => {
          pointerDown.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
        },
        onClick: (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          const start = pointerDown.current;
          const moved = start
            ? Math.hypot(e.nativeEvent.clientX - start.x, e.nativeEvent.clientY - start.y)
            : 0;
          if (moved > DRAG_THRESHOLD) return;
          selectRoom(roomId);
        },
      }
    : {};

  return (
    <group position={[cx, 0, cz]} name={`space-${design.id}`}>
      <RoomContents design={design} placement={placement} />
      {(hovered || selected) && (
        <Highlight
          accent={design.theme.accent}
          level={selected ? 'selected' : 'hover'}
          placement={placement}
        />
      )}
      {interactive && (
        // Volume invisible couvrant toute la salle : survol et clic, même entre les meubles.
        <mesh position={[0, 0.9, 0]} material={hitMaterial} {...handlers}>
          <boxGeometry args={[ROOM_SIZE.width, 1.8, ROOM_SIZE.depth]} />
        </mesh>
      )}
    </group>
  );
}
