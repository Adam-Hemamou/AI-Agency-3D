import { Vector3 } from 'three';

/**
 * Calculs de cadrage de la caméra isométrique (fonctions pures, testables).
 * Caméra orthographique : le « zoom » est le nombre de pixels par unité de scène.
 */

/** Orientation isométrique : 45° autour de l'axe vertical, 55° depuis la verticale. */
export const ISO_AZIMUTH = Math.PI / 4;
export const ISO_POLAR = (55 * Math.PI) / 180;
/** Distance caméra–cible (sans effet sur la taille en projection orthographique). */
export const CAMERA_DISTANCE = 60;

export const ZOOM_LIMITS = { min: 12, max: 160 } as const;

/** Vecteur unitaire allant de la cible vers la caméra. */
export function viewOffset(azimuth = ISO_AZIMUTH, polar = ISO_POLAR): Vector3 {
  return new Vector3(
    Math.sin(polar) * Math.sin(azimuth),
    Math.cos(polar),
    Math.sin(polar) * Math.cos(azimuth),
  );
}

export interface Box3D {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

function corners({ min, max }: Box3D): Vector3[] {
  const out: Vector3[] = [];
  for (const x of [min[0], max[0]])
    for (const y of [min[1], max[1]])
      for (const z of [min[2], max[2]]) out.push(new Vector3(x, y, z));
  return out;
}

/** Taille (largeur, hauteur) d'une boîte une fois projetée sur l'écran, en unités de scène. */
export function projectedSize(box: Box3D, azimuth = ISO_AZIMUTH, polar = ISO_POLAR) {
  const forward = viewOffset(azimuth, polar).negate();
  const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
  const up = new Vector3().crossVectors(right, forward).normalize();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of corners(box)) {
    const x = c.dot(right);
    const y = c.dot(up);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { width: maxX - minX, height: maxY - minY };
}

/** Zoom pour que la boîte tienne dans la zone visible (en px), avec une marge relative. */
export function fitZoom(box: Box3D, viewWidth: number, viewHeight: number, margin = 0.08): number {
  const { width, height } = projectedSize(box);
  const zoom = Math.min(viewWidth / width, viewHeight / height) * (1 - margin * 2);
  return Math.min(ZOOM_LIMITS.max, Math.max(ZOOM_LIMITS.min, zoom));
}

/** Espace occupé par les éléments d'interface (en px) autour de la scène. */
export interface ScreenInset {
  left: number;
  right: number;
  bottom: number;
}

export const PANEL_WIDTH = 420;
/** Largeur de la liste des salles, à gauche (marges comprises). */
export const HUD_LEFT_WIDTH = 292;
export const NARROW_BREAKPOINT = 900;

/** Place prise par le panneau de salle (à droite, ou en bas sur écran étroit). */
export function panelInset(viewWidth: number, viewHeight: number): ScreenInset {
  return viewWidth >= NARROW_BREAKPOINT
    ? { left: 0, right: PANEL_WIDTH + 24, bottom: 0 }
    : { left: 0, right: 0, bottom: Math.round(viewHeight * 0.55) };
}

/** Place prise par la liste des salles en vue d'ensemble (masquée sur écran étroit). */
export function overviewInset(viewWidth: number): ScreenInset {
  return { left: viewWidth >= NARROW_BREAKPOINT ? HUD_LEFT_WIDTH : 0, right: 0, bottom: 0 };
}

/**
 * Décalage de la caméra (en unités de scène, repère caméra) pour centrer la cible
 * dans la zone laissée libre par l'interface.
 */
export function focalOffsetFor(inset: ScreenInset, zoom: number) {
  return { x: (inset.right - inset.left) / 2 / zoom, y: -inset.bottom / 2 / zoom };
}
