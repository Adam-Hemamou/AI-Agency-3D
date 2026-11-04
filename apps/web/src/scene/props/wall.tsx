import { PALETTE, getMaterial, screenMaterial } from '../materials';
import type { ScreenContent } from './catalog';
import { Box, Cylinder, Panel } from './primitives';
import { ScreenDisplay } from './screens';

/**
 * Objets muraux. Origine : centre de l'objet, contre la surface du mur ; la face visible
 * est tournée vers +z (l'intérieur de la salle). `width` = largeur le long du mur.
 */

interface WallPropProps {
  width: number;
  accent: string;
  screen?: ScreenContent;
}

export function WallScreen({ width, accent, screen = 'play' }: WallPropProps) {
  const h = 1.0;
  return (
    <group position={[0, 0, 0.04]}>
      <Box size={[width, h, 0.06]} color={PALETTE.screenFrame} />
      <group position={[0, 0, 0.031]}>
        <ScreenDisplay content={screen} width={width - 0.1} height={h - 0.1} accent={accent} />
      </group>
    </group>
  );
}

export function Corkboard({ width, accent }: WallPropProps) {
  const notes = ['#ffe08a', '#a8dadc', '#f4a6a6', accent, '#b5e48c'];
  return (
    <group position={[0, 0, 0.025]}>
      <Box size={[width, 0.8, 0.04]} color={PALETTE.woodDark} />
      <Panel size={[width - 0.08, 0.72]} position={[0, 0, 0.021]} color="#c9a173" />
      {notes.map((c, i) => (
        <group
          key={i}
          position={[-width / 2 + 0.2 + i * ((width - 0.4) / 4), i % 2 ? -0.12 : 0.14, 0.023]}
          rotation={[0, 0, (i % 3) * 0.08 - 0.08]}
        >
          <Panel size={[0.18, 0.16]} color={c} />
          <Cylinder
            radiusTop={0.015}
            height={0.02}
            position={[0, 0.06, 0.01]}
            rotation={[Math.PI / 2, 0, 0]}
            color="#d62828"
          />
        </group>
      ))}
    </group>
  );
}

export function AcousticPanels({ width, accent }: WallPropProps) {
  const cols = 6;
  const rows = 3;
  const cw = width / cols;
  return (
    <group position={[0, 0, 0.04]}>
      {Array.from({ length: cols * rows }, (_, i) => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const raised = (c + r) % 2 === 0;
        return (
          <Box
            key={i}
            size={[cw - 0.03, 0.33, raised ? 0.08 : 0.05]}
            position={[-width / 2 + cw * (c + 0.5), 0.37 - r * 0.37, raised ? 0.015 : 0]}
            color={raised ? '#2f2945' : accent}
          />
        );
      })}
    </group>
  );
}

export function Painting({ width }: WallPropProps) {
  return (
    <group position={[0, 0, 0.025]}>
      <Box size={[width, 0.6, 0.04]} color="#d4af37" />
      <Panel size={[width - 0.1, 0.5]} position={[0, 0, 0.021]} color="#f3ead8" />
      <Panel size={[width * 0.35, 0.3]} position={[-width * 0.18, 0.05, 0.022]} color="#e76f51" />
      <Panel size={[width * 0.3, 0.22]} position={[width * 0.15, -0.06, 0.023]} color="#2a9d8f" />
      <mesh position={[width * 0.25, 0.12, 0.024]} material={getMaterial('#e9c46a')}>
        <circleGeometry args={[0.08, 8]} />
      </mesh>
    </group>
  );
}

/** Pictogramme de validation (coche verte). */
export function CheckSign({ width }: WallPropProps) {
  const r = Math.min(width, 0.6) / 2;
  return (
    <group position={[0, 0, 0.03]}>
      <mesh material={screenMaterial('#3aa85c')} castShadow>
        <cylinderGeometry args={[r, r, 0.05, 12]} />
      </mesh>
      <group rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.03]}>
        <Box
          size={[r * 0.45, 0.02, r * 0.16]}
          position={[-r * 0.2, 0, -r * 0.08]}
          rotation={[0, 0.8, 0]}
          color={PALETTE.white}
        />
        <Box
          size={[r * 0.85, 0.02, r * 0.16]}
          position={[r * 0.15, 0, 0.05 * r]}
          rotation={[0, -0.85, 0]}
          color={PALETTE.white}
        />
      </group>
    </group>
  );
}

/** Voyant « en enregistrement ». */
export function OnAirSign({ width }: WallPropProps) {
  return (
    <group position={[0, 0, 0.05]}>
      <Box size={[width, 0.3, 0.08]} color={PALETTE.dark} />
      <mesh
        position={[0, 0, 0.041]}
        material={getMaterial('#ff4d4d', { emissive: '#ff2d2d', emissiveIntensity: 1.2 })}
      >
        <planeGeometry args={[width - 0.08, 0.22]} />
      </mesh>
      {[-0.22, -0.07, 0.08, 0.23].map((x) => (
        <Panel
          key={x}
          size={[0.09, 0.1]}
          position={[x * (width / 0.8), 0, 0.043]}
          material={getMaterial('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.9 })}
        />
      ))}
    </group>
  );
}

/** Fenêtre donnant sur l'extérieur. */
export function WallWindow({ width }: WallPropProps) {
  return (
    <group position={[0, 0, 0.02]}>
      <Box size={[width, 0.9, 0.05]} color={PALETTE.white} />
      <Panel
        size={[width - 0.1, 0.8]}
        position={[0, 0, 0.026]}
        material={getMaterial('#bfe3f5', {
          emissive: '#d9f0ff',
          emissiveIntensity: 0.5,
          roughness: 0.2,
        })}
      />
      <Box size={[0.04, 0.8, 0.03]} position={[0, 0, 0.04]} color={PALETTE.white} />
      <Box size={[width - 0.1, 0.04, 0.03]} position={[0, 0, 0.04]} color={PALETTE.white} />
      <Box size={[width + 0.1, 0.05, 0.14]} position={[0, -0.47, 0.06]} color={PALETTE.wood} />
    </group>
  );
}

export function WallClock({ width }: WallPropProps) {
  const r = width / 2;
  return (
    <group position={[0, 0, 0.03]} rotation={[Math.PI / 2, 0, 0]}>
      <Cylinder radiusTop={r} height={0.04} segments={14} color={PALETTE.dark} />
      <Cylinder radiusTop={r * 0.86} height={0.045} segments={14} color={PALETTE.white} />
      <Box size={[0.02, 0.05, r * 0.6]} position={[0, 0.03, -r * 0.28]} color={PALETTE.dark} />
      <Box size={[r * 0.45, 0.05, 0.02]} position={[r * 0.2, 0.03, 0]} color={PALETTE.dark} />
    </group>
  );
}
