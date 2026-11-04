import { describe, expect, it } from 'vitest';
import {
  PANEL_WIDTH,
  ZOOM_LIMITS,
  fitZoom,
  focalOffsetFor,
  HUD_LEFT_WIDTH,
  overviewInset,
  panelInset,
  projectedSize,
  viewOffset,
} from './cameraMath';

const room = { min: [-3.5, 0, -3] as const, max: [3.5, 1.5, 3] as const };
const agency = { min: [-15.5, -0.6, -8.3] as const, max: [15.5, 1.5, 8.3] as const };

describe('cadrage isométrique', () => {
  it('place la caméra au-dessus, côté sud-est', () => {
    const v = viewOffset();
    expect(v.x).toBeGreaterThan(0);
    expect(v.y).toBeGreaterThan(0);
    expect(v.z).toBeGreaterThan(0);
    expect(v.length()).toBeCloseTo(1);
    expect(v.x).toBeCloseTo(v.z);
  });

  it('une boîte plus grande occupe plus de place à l’écran', () => {
    expect(projectedSize(agency).width).toBeGreaterThan(projectedSize(room).width);
  });

  it('le zoom fait tenir la boîte dans la zone visible', () => {
    const zoom = fitZoom(agency, 1600, 900);
    const { width, height } = projectedSize(agency);
    expect(width * zoom).toBeLessThanOrEqual(1600);
    expect(height * zoom).toBeLessThanOrEqual(900);
  });

  it('le zoom reste dans les limites autorisées', () => {
    expect(fitZoom(agency, 50, 50)).toBe(ZOOM_LIMITS.min);
    expect(fitZoom(room, 100_000, 100_000)).toBe(ZOOM_LIMITS.max);
  });
});

describe('zone libre à côté du panneau', () => {
  it('réserve la largeur du panneau sur écran large', () => {
    expect(panelInset(1600, 900)).toEqual({ left: 0, right: PANEL_WIDTH + 24, bottom: 0 });
  });

  it('réserve le bas de l’écran sur écran étroit', () => {
    expect(panelInset(600, 1000)).toEqual({ left: 0, right: 0, bottom: 550 });
  });

  it('décale la caméra de la moitié de l’espace occupé', () => {
    expect(focalOffsetFor({ left: 0, right: 400, bottom: 0 }, 50)).toEqual({ x: 4, y: -0 });
    expect(focalOffsetFor({ left: 0, right: 0, bottom: 300 }, 30)).toEqual({ x: 0, y: -5 });
    expect(focalOffsetFor({ left: 300, right: 0, bottom: 0 }, 30)).toEqual({ x: -5, y: -0 });
  });

  it('réserve la liste des salles en vue d’ensemble, sauf sur écran étroit', () => {
    expect(overviewInset(1600).left).toBe(HUD_LEFT_WIDTH);
    expect(overviewInset(700).left).toBe(0);
  });
});
