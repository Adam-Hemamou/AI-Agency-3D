import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Grid, MapControls, OrthographicCamera } from '@react-three/drei';
import type { Mesh } from 'three';

/**
 * Scène de vérification de la phase 0 : elle prouve que la chaîne 3D fonctionne
 * (rendu, caméra isométrique orthographique, contrôles). Ce n'est pas encore l'agence :
 * les salles seront construites en phase 2.
 */
function PlaceholderBlock() {
  const ref = useRef<Mesh>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.4;
  });
  return (
    <mesh ref={ref} position={[0, 0.6, 0]} castShadow>
      <boxGeometry args={[1.2, 1.2, 1.2]} />
      <meshStandardMaterial color="#6d5efc" roughness={0.4} />
    </mesh>
  );
}

export function FoundationScene() {
  return (
    <Canvas shadows dpr={[1, 2]}>
      <color attach="background" args={['#0f1117']} />
      {/* Vue isométrique : caméra orthographique placée en diagonale. */}
      <OrthographicCamera makeDefault position={[10, 10, 10]} zoom={60} near={0.1} far={100} />
      <MapControls enableRotate={false} minZoom={25} maxZoom={150} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 4]} intensity={1.6} castShadow />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#1a1d27" />
      </mesh>
      <Grid
        args={[20, 20]}
        position={[0, 0.01, 0]}
        cellColor="#2a2f3d"
        sectionColor="#3b4256"
        fadeDistance={40}
      />
      <PlaceholderBlock />
    </Canvas>
  );
}
