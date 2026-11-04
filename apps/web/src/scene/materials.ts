import { DoubleSide, FrontSide, MeshStandardMaterial } from 'three';

/**
 * Matériaux partagés : un seul matériau par couleur pour toute la scène.
 * Le rendu « low-poly » vient de l'ombrage plat (flatShading).
 */

interface MaterialOptions {
  emissive?: string;
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  /** Faces visibles des deux côtés : pour un objet ouvert dont on voit l'intérieur (pot). */
  doubleSided?: boolean;
}

const cache = new Map<string, MeshStandardMaterial>();

export function getMaterial(color: string, options: MaterialOptions = {}): MeshStandardMaterial {
  const key = `${color}|${JSON.stringify(options)}`;
  let material = cache.get(key);
  if (!material) {
    material = new MeshStandardMaterial({
      color,
      flatShading: true,
      roughness: options.roughness ?? 0.85,
      metalness: options.metalness ?? 0,
      emissive: options.emissive ?? '#000000',
      emissiveIntensity: options.emissiveIntensity ?? 1,
      transparent: options.opacity !== undefined,
      opacity: options.opacity ?? 1,
      side: options.doubleSided ? DoubleSide : FrontSide,
    });
    cache.set(key, material);
  }
  return material;
}

/** Écran allumé : légèrement lumineux. */
export function screenMaterial(color: string): MeshStandardMaterial {
  return getMaterial(color, { emissive: color, emissiveIntensity: 0.55, roughness: 0.4 });
}

/** Couleurs communes à toute l'agence. */
export const PALETTE = {
  wall: '#f6f1ea',
  wallCap: '#c9a27e',
  corridor: '#eee6da',
  corridorAlt: '#e6dccd',
  plinth: '#cdbca6',
  plinthDark: '#b7a48c',
  wood: '#c8996b',
  woodDark: '#8a6446',
  metal: '#9aa1ab',
  dark: '#2d3038',
  screenFrame: '#23262d',
  white: '#fbfaf7',
  paper: '#fffdf6',
  pot: '#e2d6c6',
  potDark: '#b9876a',
  leaf: '#5fa86b',
  leafDark: '#3f8a52',
  leafLight: '#86c37b',
  fabric: '#7d8aa3',
} as const;
