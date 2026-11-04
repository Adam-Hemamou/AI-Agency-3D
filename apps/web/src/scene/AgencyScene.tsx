import { Canvas } from '@react-three/fiber';
import { ROOM_IDS } from '@agency/shared';
import { AgencyCamera } from './camera/AgencyCamera';
import { DevProbe } from './debug/DevProbe';
import { LabelProjector } from './labels/LabelProjector';
import { AgencyGrounds } from './layout/AgencyGrounds';
import { MergeStatic } from './performance/MergeStatic';
import { StaticShadows } from './performance/StaticShadows';
import { SPACE_PLACEMENTS } from './layout/agencyLayout';
import { Room } from './rooms/Room';
import { SPACE_DESIGNS } from './rooms/roomDesigns';

/**
 * Agence en 3D, vue isométrique. Rendu « à la demande » : une image n'est calculée
 * que lorsque quelque chose change (caméra, survol…), ce qui économise le processeur graphique.
 */
export function AgencyScene() {
  return (
    <Canvas
      orthographic
      shadows="percentage"
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ position: [40, 40, 40], zoom: 25, near: 0.1, far: 300 }}
      gl={{ antialias: true, alpha: true }}
    >
      <hemisphereLight args={['#fff7ea', '#c9b59a', 1.1]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[14, 26, 10]}
        intensity={1.9}
        color="#fff3e0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-22}
        shadow-camera-right={22}
        shadow-camera-top={22}
        shadow-camera-bottom={-22}
        shadow-camera-near={1}
        shadow-camera-far={80}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-12, 10, -6]} intensity={0.35} color="#dce8ff" />

      <MergeStatic>
        <AgencyGrounds />
      </MergeStatic>
      {ROOM_IDS.map((id) => (
        <Room key={id} roomId={id} design={SPACE_DESIGNS[id]} placement={SPACE_PLACEMENTS[id]} />
      ))}
      <Room design={SPACE_DESIGNS.lounge} placement={SPACE_PLACEMENTS.lounge} />

      <StaticShadows />
      <LabelProjector />
      <AgencyCamera />
      {import.meta.env.DEV && <DevProbe />}
    </Canvas>
  );
}
