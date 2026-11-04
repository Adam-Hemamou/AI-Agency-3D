import type { ReactNode } from 'react';
import type { Material } from 'three';
import { getMaterial } from '../materials';

/**
 * Formes de base du mobilier low-poly. Toutes projettent et reçoivent les ombres.
 * Les positions sont celles du centre de la forme.
 */

type Vec3 = readonly [number, number, number];

interface ShapeProps {
  position?: Vec3;
  rotation?: Vec3;
  color?: string;
  material?: Material;
  shadows?: boolean;
}

function materialOf({ color, material }: ShapeProps): Material {
  return material ?? getMaterial(color ?? '#cccccc');
}

export function Box({ size, shadows = true, ...props }: ShapeProps & { size: Vec3 }) {
  return (
    <mesh
      position={props.position as [number, number, number] | undefined}
      rotation={props.rotation as [number, number, number] | undefined}
      material={materialOf(props)}
      castShadow={shadows}
      receiveShadow
    >
      <boxGeometry args={size as [number, number, number]} />
    </mesh>
  );
}

export function Cylinder({
  radiusTop,
  radiusBottom = radiusTop,
  height,
  segments = 8,
  shadows = true,
  ...props
}: ShapeProps & { radiusTop: number; radiusBottom?: number; height: number; segments?: number }) {
  return (
    <mesh
      position={props.position as [number, number, number] | undefined}
      rotation={props.rotation as [number, number, number] | undefined}
      material={materialOf(props)}
      castShadow={shadows}
      receiveShadow
    >
      <cylinderGeometry args={[radiusTop, radiusBottom, height, segments]} />
    </mesh>
  );
}

export function Sphere({
  radius,
  detail = 0,
  scale,
  shadows = true,
  ...props
}: ShapeProps & { radius: number; detail?: number; scale?: Vec3 }) {
  return (
    <mesh
      position={props.position as [number, number, number] | undefined}
      rotation={props.rotation as [number, number, number] | undefined}
      scale={scale as [number, number, number] | undefined}
      material={materialOf(props)}
      castShadow={shadows}
      receiveShadow
    >
      <icosahedronGeometry args={[radius, detail]} />
    </mesh>
  );
}

/** Surface plane verticale (contenu d'écran, affiche…), face vers +z. */
export function Panel({ size, ...props }: ShapeProps & { size: readonly [number, number] }) {
  return (
    <mesh
      position={props.position as [number, number, number] | undefined}
      rotation={props.rotation as [number, number, number] | undefined}
      material={materialOf(props)}
    >
      <planeGeometry args={size as [number, number]} />
    </mesh>
  );
}

/** Groupe positionné et orienté. */
export function At({
  position,
  rotationY = 0,
  children,
}: {
  position?: Vec3;
  rotationY?: number;
  children: ReactNode;
}) {
  return (
    <group position={position as [number, number, number] | undefined} rotation={[0, rotationY, 0]}>
      {children}
    </group>
  );
}
