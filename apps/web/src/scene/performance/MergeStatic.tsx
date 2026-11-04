import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useThree } from '@react-three/fiber';
import { Matrix4, Mesh, type BufferGeometry, type Group, type Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Optimisation du rendu : fusionne les objets immobiles d'un groupe en un maillage par
 * matériau. Une salle passe ainsi de plusieurs centaines d'appels de dessin à quelques
 * dizaines, sans rien changer à l'apparence.
 * Les objets marqués `userData.keepSeparate` (interactifs ou animés) ne sont pas fusionnés.
 */
export function MergeStatic({ children }: { children: ReactNode }) {
  const ref = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.updateWorldMatrix(true, true);
    const toLocal = new Matrix4().copy(root.matrixWorld).invert();

    const buckets = new Map<
      string,
      { material: Material; cast: boolean; geometries: BufferGeometry[] }
    >();
    const originals: Mesh[] = [];

    root.traverse((object) => {
      if (!(object instanceof Mesh) || !object.visible || object.userData.keepSeparate) return;
      if (Array.isArray(object.material)) return;
      const material = object.material as Material;
      const source = object.geometry as BufferGeometry;
      const geometry = source.index ? source.toNonIndexed() : source.clone();
      // Seuls position et normale sont utiles (aucune texture) : attributs identiques pour tous.
      for (const name of Object.keys(geometry.attributes)) {
        if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
      }
      geometry.applyMatrix4(new Matrix4().multiplyMatrices(toLocal, object.matrixWorld));
      const key = `${material.uuid}|${object.castShadow}`;
      const bucket = buckets.get(key) ?? { material, cast: object.castShadow, geometries: [] };
      bucket.geometries.push(geometry);
      buckets.set(key, bucket);
      originals.push(object);
    });

    const merged: Mesh[] = [];
    for (const { material, cast, geometries } of buckets.values()) {
      const geometry = mergeGeometries(geometries, false);
      geometries.forEach((g) => g.dispose());
      if (!geometry) continue;
      const mesh = new Mesh(geometry, material);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      mesh.userData.merged = true;
      merged.push(mesh);
    }

    // Les originaux restent en place (gérés par React) mais ne sont plus dessinés.
    originals.forEach((o) => (o.visible = false));
    merged.forEach((m) => root.add(m));
    invalidate();

    return () => {
      merged.forEach((m) => {
        root.remove(m);
        m.geometry.dispose();
      });
      originals.forEach((o) => (o.visible = true));
      invalidate();
    };
  }, [invalidate]);

  return <group ref={ref}>{children}</group>;
}
