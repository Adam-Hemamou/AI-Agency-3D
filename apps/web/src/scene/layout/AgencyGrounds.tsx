import { memo } from 'react';
import { PALETTE, getMaterial } from '../materials';
import { Bench } from '../props/lounge';
import { Plant, PlantSmall, PlantTall, Tree } from '../props/plants';
import { At, Box } from '../props/primitives';
import { AGENCY_BOUNDS, CORRIDOR } from './agencyLayout';

/** Socle de l'agence, couloir central, décor du couloir et abords extérieurs. */

const WIDTH = AGENCY_BOUNDS.maxX - AGENCY_BOUNDS.minX;
const DEPTH = AGENCY_BOUNDS.maxZ - AGENCY_BOUNDS.minZ;
const RUNNER = '#c7714d';

/** Niveau du terrain : le socle et les arbres y reposent exactement. */
const GROUND_Y = -0.6;
/** Dessus clair du socle (le sol du couloir est posé dessus, à y = 0). */
const PLINTH_TOP = { bottom: -0.06, top: 0 } as const;

export const AgencyGrounds = memo(function AgencyGrounds() {
  return (
    <group>
      {/* Terrain autour de l'agence. */}
      <mesh
        position={[0, GROUND_Y, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        material={getMaterial('#dfe8d2', { roughness: 1 })}
      >
        <circleGeometry args={[70, 48]} />
      </mesh>

      {/* Socle façon maquette : base foncée et dessus clair (le sol du couloir). */}
      <Box
        size={[WIDTH + 0.6, PLINTH_TOP.bottom - GROUND_Y, DEPTH + 0.6]}
        position={[0, (GROUND_Y + PLINTH_TOP.bottom) / 2, 0]}
        color={PALETTE.plinthDark}
      />
      <Box
        size={[WIDTH + 0.3, PLINTH_TOP.top - PLINTH_TOP.bottom, DEPTH + 0.3]}
        position={[0, (PLINTH_TOP.top + PLINTH_TOP.bottom) / 2, 0]}
        color={PALETTE.plinth}
        shadows={false}
      />
      <Box
        size={[WIDTH, 0.02, CORRIDOR.maxZ - CORRIDOR.minZ]}
        position={[0, 0.0, 0]}
        color={PALETTE.corridor}
        shadows={false}
      />

      {/* Tapis de couloir. */}
      <Box
        size={[WIDTH - 1.2, 0.012, 1.1]}
        position={[0, 0.016, 0]}
        color={RUNNER}
        shadows={false}
      />
      <Box
        size={[WIDTH - 1.5, 0.014, 0.8]}
        position={[0, 0.018, 0]}
        color="#e3a27f"
        shadows={false}
      />

      {/* Décor du couloir, entre les portes. */}
      {[-7.5, 7.5].map((x) =>
        [-1.1, 1.1].map((z) => (
          <At key={`${x}${z}`} position={[x, 0, z]}>
            <Plant />
          </At>
        )),
      )}
      <At position={[0, 0, -1.15]}>
        <Bench />
      </At>
      <At position={[0, 0, 1.15]} rotationY={Math.PI}>
        <Bench />
      </At>
      {[-1.1, 1.1].map((z) => (
        <At key={`w${z}`} position={[AGENCY_BOUNDS.minX + 0.4, 0, z]}>
          <PlantSmall />
        </At>
      ))}

      {/* Entrée de l'agence, à l'est du couloir. */}
      <Box
        size={[0.9, 0.014, 1.6]}
        position={[AGENCY_BOUNDS.maxX - 0.5, 0.02, 0]}
        color={PALETTE.woodDark}
        shadows={false}
      />
      {[-1.2, 1.2].map((z) => (
        <At key={`e${z}`} position={[AGENCY_BOUNDS.maxX - 0.4, 0, z]}>
          <PlantTall />
        </At>
      ))}

      {/* Abords extérieurs. */}
      {(
        [
          [-18.5, -10, 1.2],
          [-20.5, -6, 0.9],
          [18.8, -10.5, 1.1],
          [21, -6.5, 0.8],
          [-19, 9.5, 1],
          [19.5, 10, 1.15],
          [0, -11.5, 0.9],
          [-7, -11.8, 1.05],
          [8, -11.6, 0.95],
        ] as const
      ).map(([x, z, s]) => (
        <At key={`t${x}${z}`} position={[x, GROUND_Y, z]}>
          <Tree scale={s} />
        </At>
      ))}
    </group>
  );
});
