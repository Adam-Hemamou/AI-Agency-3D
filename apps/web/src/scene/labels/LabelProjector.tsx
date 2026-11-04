import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { SPACE_PLACEMENTS } from '../layout/agencyLayout';
import { labelRegistry } from './labelRegistry';

/** Hauteur, au-dessus du sol, du point d'ancrage des étiquettes. */
const LABEL_HEIGHT = 2.1;

/** Positionne les étiquettes HTML au-dessus de leur salle, à chaque image rendue. */
export function LabelProjector() {
  const invalidate = useThree((s) => s.invalidate);
  const anchors = useMemo(
    () =>
      new Map(
        Object.values(SPACE_PLACEMENTS).map((p) => [
          p.id,
          new Vector3(p.center[0], LABEL_HEIGHT, p.center[1]),
        ]),
      ),
    [],
  );
  const projected = useMemo(() => new Vector3(), []);

  useEffect(() => {
    labelRegistry.setFrameRequester(invalidate);
    invalidate();
    return () => labelRegistry.setFrameRequester(null);
  }, [invalidate]);

  useFrame(({ camera, size }) => {
    for (const [id, element] of labelRegistry.entries()) {
      const anchor = anchors.get(id);
      if (!anchor) continue;
      projected.copy(anchor).project(camera);
      const x = ((projected.x + 1) / 2) * size.width;
      const y = ((1 - projected.y) / 2) * size.height;
      const onScreen =
        projected.x > -1.2 && projected.x < 1.2 && projected.y > -1.2 && projected.y < 1.2;
      element.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      element.style.visibility = onScreen ? 'visible' : 'hidden';
    }
  });

  return null;
}
