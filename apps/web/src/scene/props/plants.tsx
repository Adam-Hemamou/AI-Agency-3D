import { PALETTE, getMaterial } from '../materials';
import { Box, Cylinder, Sphere } from './primitives';

/** Plantes low-poly : pot à facettes et feuillage en icosaèdres. */

const POT_SEGMENTS = 7;
const POT_TAPER = 0.75;
const SOIL_THICKNESS = 0.03;

/** Hauteur du dessus de la terre : en retrait sous le bord du pot. */
function soilLevel(potHeight: number): number {
  return potHeight * 0.88;
}

/**
 * Pot ouvert (sans couvercle) et terre posée à l'intérieur, sous le bord.
 * Aucune face de la terre n'est dans le même plan qu'une face du pot :
 * c'est ce qui évite le scintillement (z-fighting) quand la caméra bouge.
 */
function Pot({
  radius,
  height,
  color = PALETTE.pot,
}: {
  radius: number;
  height: number;
  color?: string;
}) {
  const bottomRadius = radius * POT_TAPER;
  // Rayon intérieur du pot à une hauteur donnée, légèrement réduit pour ne pas toucher la paroi.
  const innerRadius = (y: number) => (bottomRadius + (radius - bottomRadius) * (y / height)) * 0.94;
  const soilTop = soilLevel(height);
  const soilBottom = soilTop - SOIL_THICKNESS;
  return (
    <group>
      <mesh
        position={[0, height / 2, 0]}
        material={getMaterial(color, { doubleSided: true })}
        castShadow
        receiveShadow
      >
        <cylinderGeometry args={[radius, bottomRadius, height, POT_SEGMENTS, 1, true]} />
      </mesh>
      <Cylinder
        radiusTop={innerRadius(soilTop)}
        radiusBottom={innerRadius(soilBottom)}
        height={SOIL_THICKNESS}
        segments={POT_SEGMENTS}
        position={[0, soilBottom + SOIL_THICKNESS / 2, 0]}
        color="#6b4f3a"
        shadows={false}
      />
    </group>
  );
}

/** Plante de taille moyenne. Emprise 0.6 × 0.6. */
export function Plant() {
  return (
    <group>
      <Pot radius={0.22} height={0.4} />
      <Sphere radius={0.3} position={[0, 0.68, 0]} color={PALETTE.leaf} />
      <Sphere radius={0.2} position={[0.13, 0.86, 0.06]} color={PALETTE.leafLight} />
      <Sphere radius={0.18} position={[-0.12, 0.8, -0.08]} color={PALETTE.leafDark} />
    </group>
  );
}

/** Petite plante. Emprise 0.45 × 0.45. */
export function PlantSmall() {
  return (
    <group>
      <Pot radius={0.16} height={0.28} color={PALETTE.potDark} />
      <Sphere radius={0.2} position={[0, 0.44, 0]} color={PALETTE.leafLight} />
      <Sphere radius={0.12} position={[0.08, 0.55, 0.04]} color={PALETTE.leaf} />
    </group>
  );
}

/** Grande plante (type ficus). Emprise 0.6 × 0.6. */
export function PlantTall() {
  const potHeight = 0.42;
  // Le tronc part de la terre (légèrement enfoncé) et monte jusqu'au feuillage.
  const trunkBottom = soilLevel(potHeight) - 0.01;
  const trunkTop = 1.1;
  return (
    <group>
      <Pot radius={0.24} height={potHeight} color="#e9e4dc" />
      <Box
        size={[0.04, trunkTop - trunkBottom, 0.04]}
        position={[0, (trunkTop + trunkBottom) / 2, 0]}
        color={PALETTE.woodDark}
      />
      <Sphere radius={0.28} position={[0, 1.1, 0]} color={PALETTE.leafDark} />
      <Sphere radius={0.22} position={[0.14, 1.32, 0.05]} color={PALETTE.leaf} />
      <Sphere radius={0.18} position={[-0.12, 1.4, -0.06]} color={PALETTE.leafLight} />
      <Sphere radius={0.15} position={[0.05, 1.5, -0.1]} color={PALETTE.leaf} />
    </group>
  );
}

/** Arbre extérieur (décor autour de l'agence). */
export function Tree({ scale = 1 }: { scale?: number }) {
  return (
    <group scale={scale}>
      <Cylinder
        radiusTop={0.12}
        radiusBottom={0.16}
        height={1.0}
        segments={6}
        position={[0, 0.5, 0]}
        color={PALETTE.woodDark}
      />
      <mesh position={[0, 1.6, 0]} castShadow receiveShadow>
        <coneGeometry args={[0.9, 1.6, 7]} />
        <meshStandardMaterial color={PALETTE.leafDark} flatShading roughness={0.9} />
      </mesh>
      <mesh position={[0, 2.3, 0]} castShadow>
        <coneGeometry args={[0.65, 1.2, 7]} />
        <meshStandardMaterial color={PALETTE.leaf} flatShading roughness={0.9} />
      </mesh>
    </group>
  );
}
