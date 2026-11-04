import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

/**
 * Le décor est immobile et la lumière fixe : les ombres sont calculées une seule fois,
 * au lieu de l'être à chaque image. Placé après le décor pour s'exécuter une fois celui-ci prêt.
 */
export function StaticShadows() {
  const get = useThree((s) => s.get);

  useEffect(() => {
    const { gl, invalidate } = get();
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    invalidate();
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [get]);

  return null;
}
