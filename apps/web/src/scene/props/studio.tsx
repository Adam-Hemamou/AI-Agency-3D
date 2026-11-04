import { PALETTE, getMaterial, screenMaterial } from '../materials';
import type { ScreenContent } from './catalog';
import { OfficeChair } from './office';
import { Box, Cylinder, Panel, Sphere } from './primitives';
import { ScreenDisplay } from './screens';

/** Matériel du studio de doublage. Origine : centre de l'emprise, au sol. */

function Tripod({ height, spread = 0.28 }: { height: number; spread?: number }) {
  return (
    <>
      {[0, 1, 2].map((i) => {
        const a = (i * Math.PI * 2) / 3;
        return (
          <Box
            key={i}
            size={[0.035, height, 0.035]}
            position={[Math.sin(a) * spread * 0.5, height / 2 - 0.02, Math.cos(a) * spread * 0.5]}
            rotation={[Math.cos(a) * 0.32, 0, -Math.sin(a) * 0.32]}
            color={PALETTE.dark}
          />
        );
      })}
    </>
  );
}

/** Micro sur pied avec filtre anti-pop. Emprise 0.6 × 0.6. */
export function MicStand({ accent }: { accent: string }) {
  return (
    <group>
      <Tripod height={0.5} />
      <Cylinder radiusTop={0.02} height={1.0} position={[0, 0.95, 0]} color={PALETTE.metal} />
      <Box
        size={[0.03, 0.03, 0.4]}
        position={[0, 1.43, 0.15]}
        rotation={[-0.3, 0, 0]}
        color={PALETTE.metal}
      />
      <Cylinder
        radiusTop={0.05}
        height={0.16}
        position={[0, 1.5, 0.32]}
        rotation={[0.4, 0, 0]}
        color={PALETTE.dark}
      />
      <Sphere radius={0.055} position={[0, 1.58, 0.35]} color={PALETTE.metal} />
      <mesh position={[0, 1.55, 0.48]} material={getMaterial(accent, { opacity: 0.6 })}>
        <torusGeometry args={[0.08, 0.01, 4, 12]} />
      </mesh>
    </group>
  );
}

/** Caméra sur trépied ; l'objectif vise +z. Emprise 0.8 × 0.8. */
export function CameraTripod() {
  return (
    <group>
      <Tripod height={1.15} spread={0.6} />
      <Box size={[0.12, 0.08, 0.12]} position={[0, 1.18, 0]} color={PALETTE.dark} />
      <Box size={[0.22, 0.2, 0.34]} position={[0, 1.32, 0]} color="#3a3f4b" />
      <Cylinder
        radiusTop={0.08}
        height={0.18}
        position={[0, 1.32, 0.25]}
        rotation={[Math.PI / 2, 0, 0]}
        color={PALETTE.dark}
      />
      <Sphere
        radius={0.025}
        position={[0.08, 1.44, 0.12]}
        material={getMaterial('#ff3b30', { emissive: '#ff3b30', emissiveIntensity: 1 })}
      />
    </group>
  );
}

/** Projecteur à boîte diffuseuse ; la face lumineuse vise +z. Emprise 0.7 × 0.7. */
export function Softbox() {
  return (
    <group>
      <Tripod height={0.9} spread={0.5} />
      <Cylinder radiusTop={0.02} height={0.8} position={[0, 1.25, 0]} color={PALETTE.dark} />
      <group position={[0, 1.6, 0]} rotation={[0.3, 0, 0]}>
        <Box size={[0.6, 0.45, 0.25]} color={PALETTE.dark} />
        <Panel
          size={[0.54, 0.39]}
          position={[0, 0, 0.126]}
          material={getMaterial('#ffffff', { emissive: '#fff4dc', emissiveIntensity: 0.9 })}
        />
      </group>
    </group>
  );
}

/** Console de mixage avec écrans et enceintes. Emprise 1.8 × 1.6. */
export function MixingDesk({
  accent,
  screen = 'wave',
}: {
  accent: string;
  screen?: ScreenContent;
}) {
  return (
    <group>
      <group position={[0, 0, -0.35]}>
        <Box size={[1.8, 0.7, 0.8]} position={[0, 0.35, 0]} color="#2c2840" />
        <Box
          size={[1.7, 0.08, 0.7]}
          position={[0, 0.75, 0.02]}
          rotation={[0.18, 0, 0]}
          color="#3b3556"
        />
        {Array.from({ length: 10 }, (_, i) => (
          <group key={i} position={[-0.72 + i * 0.16, 0.8, 0.05]}>
            <Box size={[0.03, 0.02, 0.4]} rotation={[0.18, 0, 0]} color={PALETTE.dark} />
            <Box
              size={[0.07, 0.05, 0.05]}
              position={[0, 0.03, -0.12 + ((i * 7) % 5) * 0.06]}
              color={i % 3 === 0 ? accent : PALETTE.white}
            />
          </group>
        ))}
        {[-0.5, 0.5].map((x) => (
          <group key={x} position={[x, 1.12, -0.25]} rotation={[0, x < 0 ? 0.15 : -0.15, 0]}>
            <Box size={[0.7, 0.42, 0.04]} color={PALETTE.screenFrame} />
            <group position={[0, 0, 0.021]}>
              <ScreenDisplay
                content={x < 0 ? screen : 'play'}
                width={0.64}
                height={0.36}
                accent={accent}
              />
            </group>
          </group>
        ))}
        {[-0.98, 0.98].map((x) => (
          <group key={`s${x}`} position={[x, 0, 0]}>
            <Box size={[0.22, 0.36, 0.22]} position={[0, 0.88, 0]} color={PALETTE.dark} />
            <Cylinder
              radiusTop={0.07}
              height={0.02}
              position={[0, 0.84, 0.115]}
              rotation={[Math.PI / 2, 0, 0]}
              color={PALETTE.metal}
            />
          </group>
        ))}
      </group>
      <group position={[0, 0, 0.42]}>
        <OfficeChair color={accent} />
      </group>
    </group>
  );
}

/** Fond vert sur deux pieds. Emprise 2.4 × 0.4. */
export function GreenScreen() {
  return (
    <group>
      {[-1.12, 1.12].map((x) => (
        <group key={x}>
          <Box size={[0.05, 1.7, 0.05]} position={[x, 0.85, 0]} color={PALETTE.metal} />
          <Box size={[0.06, 0.04, 0.36]} position={[x, 0.02, 0]} color={PALETTE.metal} />
        </group>
      ))}
      <Box size={[2.3, 0.05, 0.05]} position={[0, 1.68, 0]} color={PALETTE.metal} />
      <mesh position={[0, 0.88, 0.04]} material={screenMaterial('#3fbf5f')} receiveShadow>
        <boxGeometry args={[2.2, 1.56, 0.02]} />
      </mesh>
    </group>
  );
}
