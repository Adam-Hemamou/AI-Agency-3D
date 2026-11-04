import { PALETTE, getMaterial } from '../materials';
import { Box, Cylinder, Sphere } from './primitives';

/** Mobilier de détente et de décoration. Origine : centre de l'emprise, au sol. */

/** Canapé, assise tournée vers +z. Emprise 2.0 × 0.9. */
export function Sofa({ color }: { color: string }) {
  return (
    <group>
      <Box size={[2.0, 0.3, 0.85]} position={[0, 0.2, 0]} color={color} />
      <Box size={[2.0, 0.55, 0.22]} position={[0, 0.5, -0.33]} color={color} />
      <Box size={[0.2, 0.42, 0.85]} position={[-0.9, 0.42, 0]} color={color} />
      <Box size={[0.2, 0.42, 0.85]} position={[0.9, 0.42, 0]} color={color} />
      <Box size={[0.78, 0.12, 0.6]} position={[-0.4, 0.41, 0.06]} color={color} />
      <Box size={[0.78, 0.12, 0.6]} position={[0.4, 0.41, 0.06]} color={color} />
      <Box
        size={[0.36, 0.3, 0.1]}
        position={[-0.55, 0.62, -0.18]}
        rotation={[-0.2, 0.15, 0]}
        color="#f1e3c8"
      />
      {[-0.9, 0.9].map((x) =>
        [-0.34, 0.34].map((z) => (
          <Box
            key={`${x}${z}`}
            size={[0.06, 0.06, 0.06]}
            position={[x, 0.03, z]}
            color={PALETTE.woodDark}
          />
        )),
      )}
    </group>
  );
}

/** Fauteuil. Emprise 0.9 × 0.9. */
export function Armchair({ color }: { color: string }) {
  return (
    <group>
      <Box size={[0.85, 0.3, 0.8]} position={[0, 0.2, 0]} color={color} />
      <Box size={[0.85, 0.5, 0.2]} position={[0, 0.5, -0.3]} color={color} />
      <Box size={[0.16, 0.38, 0.8]} position={[-0.35, 0.42, 0]} color={color} />
      <Box size={[0.16, 0.38, 0.8]} position={[0.35, 0.42, 0]} color={color} />
      <Box size={[0.54, 0.1, 0.56]} position={[0, 0.4, 0.06]} color={color} />
    </group>
  );
}

/** Table basse avec quelques objets. Emprise 1.0 × 0.6. */
export function CoffeeTable({ accent }: { accent: string }) {
  return (
    <group>
      <Box size={[1.0, 0.05, 0.6]} position={[0, 0.4, 0]} color={PALETTE.wood} />
      <Box size={[0.9, 0.03, 0.5]} position={[0, 0.12, 0]} color={PALETTE.woodDark} />
      {[-0.45, 0.45].map((x) =>
        [-0.25, 0.25].map((z) => (
          <Box
            key={`${x}${z}`}
            size={[0.05, 0.4, 0.05]}
            position={[x, 0.2, z]}
            color={PALETTE.woodDark}
          />
        )),
      )}
      <Box
        size={[0.3, 0.03, 0.22]}
        position={[-0.2, 0.44, 0]}
        rotation={[0, 0.3, 0]}
        color={accent}
      />
      <Cylinder
        radiusTop={0.05}
        radiusBottom={0.04}
        height={0.1}
        position={[0.25, 0.47, 0.05]}
        color={PALETTE.white}
      />
    </group>
  );
}

/** Lampadaire à abat-jour lumineux. Emprise 0.45 × 0.45. */
export function FloorLamp() {
  return (
    <group>
      <Cylinder
        radiusTop={0.16}
        radiusBottom={0.18}
        height={0.04}
        segments={8}
        position={[0, 0.02, 0]}
        color={PALETTE.dark}
      />
      <Cylinder radiusTop={0.02} height={1.3} position={[0, 0.67, 0]} color={PALETTE.dark} />
      <mesh
        position={[0, 1.42, 0]}
        material={getMaterial('#ffe7b0', { emissive: '#ffd27a', emissiveIntensity: 0.7 })}
        castShadow
      >
        <cylinderGeometry args={[0.12, 0.2, 0.3, 8, 1, true]} />
      </mesh>
    </group>
  );
}

/** Tapis plat, dimensions libres. */
export function Rug({ size, color }: { size: readonly [number, number]; color: string }) {
  const [w, d] = size;
  return (
    <group>
      <Box size={[w, 0.015, d]} position={[0, 0.008, 0]} color={color} shadows={false} />
      <Box
        size={[w - 0.25, 0.017, d - 0.25]}
        position={[0, 0.01, 0]}
        color={PALETTE.white}
        material={getMaterial(color, {
          roughness: 1,
          emissive: '#ffffff',
          emissiveIntensity: 0.06,
        })}
        shadows={false}
      />
    </group>
  );
}

/** Pouf. Emprise 0.8 × 0.8. */
export function BeanBag({ color }: { color: string }) {
  return (
    <Sphere radius={0.4} detail={1} position={[0, 0.24, 0]} scale={[1, 0.6, 1]} color={color} />
  );
}

/** Fontaine à eau. Emprise 0.5 × 0.5. */
export function WaterCooler() {
  return (
    <group>
      <Box size={[0.4, 0.8, 0.4]} position={[0, 0.4, 0]} color={PALETTE.white} />
      <Box size={[0.12, 0.08, 0.06]} position={[0, 0.6, 0.21]} color="#4ea8de" />
      <mesh
        position={[0, 0.98, 0]}
        material={getMaterial('#9fd3f5', { opacity: 0.75, roughness: 0.2 })}
        castShadow
      >
        <cylinderGeometry args={[0.14, 0.15, 0.36, 10]} />
      </mesh>
    </group>
  );
}

/** Coin café : comptoir, machine à café, tasses. Emprise 1.8 × 0.65. */
export function Kitchenette({ accent }: { accent: string }) {
  return (
    <group>
      <Box size={[1.8, 0.86, 0.6]} position={[0, 0.43, 0]} color={PALETTE.white} />
      <Box size={[1.84, 0.05, 0.65]} position={[0, 0.885, 0]} color={PALETTE.woodDark} />
      {[-0.6, 0, 0.6].map((x) => (
        <Box key={x} size={[0.54, 0.7, 0.02]} position={[x, 0.42, 0.305]} color="#efe9e0" />
      ))}
      <group position={[-0.45, 0.91, -0.05]}>
        <Box size={[0.36, 0.42, 0.34]} position={[0, 0.21, 0]} color={PALETTE.dark} />
        <Box size={[0.2, 0.08, 0.06]} position={[0, 0.3, 0.18]} color={accent} />
        <Cylinder
          radiusTop={0.045}
          height={0.08}
          position={[0, 0.06, 0.12]}
          color={PALETTE.white}
        />
      </group>
      {[0.25, 0.42, 0.59].map((x, i) => (
        <Cylinder
          key={x}
          radiusTop={0.045}
          height={0.09}
          position={[x, 0.955, 0.1]}
          color={i === 1 ? accent : PALETTE.white}
        />
      ))}
      <Sphere radius={0.12} position={[0.4, 1.0, -0.15]} scale={[1, 0.6, 1]} color="#f4a259" />
    </group>
  );
}

/** Banc de couloir. Emprise 1.4 × 0.5. */
export function Bench() {
  return (
    <group>
      <Box size={[1.4, 0.08, 0.45]} position={[0, 0.42, 0]} color={PALETTE.wood} />
      <Box size={[0.08, 0.4, 0.4]} position={[-0.6, 0.2, 0]} color={PALETTE.dark} />
      <Box size={[0.08, 0.4, 0.4]} position={[0.6, 0.2, 0]} color={PALETTE.dark} />
    </group>
  );
}
