import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { isRoomId } from '@agency/shared';
import { SPACE_PLACEMENTS } from '../layout/agencyLayout';

/**
 * Outil de test, actif UNIQUEMENT en développement (absent du build de production).
 * Expose `window.__agencyProbe` pour que les tests de navigateur automatisés puissent
 * viser une salle à l'écran et relever les statistiques de rendu.
 */

declare global {
  interface Window {
    __agencyProbe?: {
      roomScreenPoint: (room: string) => { x: number; y: number } | null;
      renderInfo: () => { calls: number; triangles: number; geometries: number; textures: number };
      zoom: () => number;
    };
  }
}

export function DevProbe() {
  const { camera, gl, size, invalidate } = useThree();

  useEffect(() => {
    window.__agencyProbe = {
      roomScreenPoint(room) {
        if (!isRoomId(room)) return null;
        const [x, z] = SPACE_PLACEMENTS[room].center;
        const p = new Vector3(x, 0.3, z).project(camera);
        const rect = gl.domElement.getBoundingClientRect();
        return {
          x: rect.left + ((p.x + 1) / 2) * size.width,
          y: rect.top + ((1 - p.y) / 2) * size.height,
        };
      },
      renderInfo() {
        invalidate();
        const { calls, triangles } = gl.info.render;
        return {
          calls,
          triangles,
          geometries: gl.info.memory.geometries,
          textures: gl.info.memory.textures,
        };
      },
      zoom: () => camera.zoom,
    };
    return () => {
      delete window.__agencyProbe;
    };
  }, [camera, gl, size, invalidate]);

  return null;
}
