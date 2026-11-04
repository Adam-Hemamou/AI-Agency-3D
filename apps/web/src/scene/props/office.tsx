import type { ReactNode } from 'react';
import { PALETTE, getMaterial } from '../materials';
import type { DeskAccessory, ScreenContent } from './catalog';
import { At, Box, Cylinder, Panel, Sphere } from './primitives';
import { ScreenDisplay } from './screens';

/**
 * Mobilier de bureau. Origine : centre de l'emprise au sol, y = 0 au niveau du sol.
 * Orientation 0 : le meuble est tourné vers +z (vers la caméra).
 */

const DESK_H = 0.74;

function TableLegs({
  w,
  d,
  h = DESK_H,
  inset = 0.06,
  color = PALETTE.metal,
}: {
  w: number;
  d: number;
  h?: number;
  inset?: number;
  color?: string;
}) {
  const x = w / 2 - inset;
  const z = d / 2 - inset;
  return (
    <>
      {[
        [-x, -z],
        [x, -z],
        [-x, z],
        [x, z],
      ].map(([lx = 0, lz = 0], i) => (
        <Box key={i} size={[0.05, h, 0.05]} position={[lx, h / 2, lz]} color={color} />
      ))}
    </>
  );
}

/** Chaise de bureau à roulettes ; le dossier est du côté +z. */
export function OfficeChair({ color = PALETTE.dark }: { color?: string }) {
  return (
    <group>
      <Cylinder
        radiusTop={0.22}
        radiusBottom={0.24}
        height={0.05}
        segments={5}
        position={[0, 0.05, 0]}
        color={PALETTE.dark}
      />
      <Cylinder radiusTop={0.03} height={0.38} position={[0, 0.25, 0]} color={PALETTE.metal} />
      <Box size={[0.48, 0.08, 0.46]} position={[0, 0.46, 0]} color={color} />
      <Box
        size={[0.46, 0.46, 0.07]}
        position={[0, 0.76, 0.21]}
        rotation={[-0.08, 0, 0]}
        color={color}
      />
    </group>
  );
}

/** Chaise visiteur (pieds en bois) ; le dossier est du côté +z. */
export function Chair({ color = PALETTE.fabric }: { color?: string }) {
  return (
    <group>
      <TableLegs w={0.46} d={0.46} h={0.44} inset={0.04} color={PALETTE.woodDark} />
      <Box size={[0.5, 0.08, 0.5]} position={[0, 0.48, 0]} color={color} />
      <Box size={[0.5, 0.45, 0.07]} position={[0, 0.74, 0.22]} color={color} />
    </group>
  );
}

function Accessory({ kind, accent }: { kind: DeskAccessory; accent: string }) {
  switch (kind) {
    case 'mug':
      return (
        <Cylinder
          radiusTop={0.045}
          height={0.1}
          position={[0.6, DESK_H + 0.08, -0.15]}
          color={accent}
        />
      );
    case 'trays':
      return (
        <group position={[0.58, DESK_H + 0.03, -0.3]}>
          <Box size={[0.32, 0.04, 0.24]} position={[0, 0.02, 0]} color={PALETTE.dark} />
          <Box size={[0.26, 0.05, 0.2]} position={[0, 0.06, 0]} color={PALETTE.paper} />
          <Box size={[0.32, 0.04, 0.24]} position={[0, 0.11, 0]} color={accent} />
        </group>
      );
    case 'headset':
      return (
        <group position={[0.58, DESK_H + 0.12, -0.2]}>
          <mesh material={getMaterial(PALETTE.dark)} castShadow>
            <torusGeometry args={[0.09, 0.015, 4, 10, Math.PI]} />
          </mesh>
          <Box size={[0.05, 0.08, 0.06]} position={[-0.09, -0.02, 0]} color={accent} />
          <Box size={[0.05, 0.08, 0.06]} position={[0.09, -0.02, 0]} color={accent} />
        </group>
      );
    case 'papers':
      return (
        <group position={[-0.58, DESK_H + 0.02, -0.2]} rotation={[0, 0.2, 0]}>
          <Box size={[0.24, 0.02, 0.32]} color={PALETTE.paper} />
          <Box
            size={[0.24, 0.02, 0.32]}
            position={[0.02, 0.02, 0.02]}
            rotation={[0, -0.15, 0]}
            color={PALETTE.white}
          />
        </group>
      );
    case 'none':
      return null;
  }
}

/** Poste de travail : bureau, écran, clavier et chaise. Emprise 1.6 × 1.5. */
export function Workstation({
  screen,
  accent,
  accessory = 'none',
}: {
  screen: ScreenContent;
  accent: string;
  accessory?: DeskAccessory;
}) {
  return (
    <group>
      <group position={[0, 0, -0.35]}>
        <Box size={[1.6, 0.06, 0.8]} position={[0, DESK_H, 0]} color={PALETTE.wood} />
        <TableLegs w={1.6} d={0.8} />
        {/* Écran tourné vers la chaise (et vers la caméra). */}
        <Box size={[0.08, 0.22, 0.06]} position={[0, DESK_H + 0.12, -0.28]} color={PALETTE.dark} />
        <Box size={[0.3, 0.02, 0.18]} position={[0, DESK_H + 0.04, -0.28]} color={PALETTE.dark} />
        <group position={[0, DESK_H + 0.38, -0.25]}>
          <Box size={[0.78, 0.48, 0.04]} color={PALETTE.screenFrame} />
          <group position={[0, 0, 0.021]}>
            <ScreenDisplay content={screen} width={0.7} height={0.4} accent={accent} />
          </group>
        </group>
        <Box size={[0.5, 0.02, 0.16]} position={[0, DESK_H + 0.04, 0.12]} color={PALETTE.white} />
        <Box
          size={[0.08, 0.02, 0.12]}
          position={[0.36, DESK_H + 0.04, 0.14]}
          color={PALETTE.white}
        />
        <Accessory kind={accessory} accent={accent} />
      </group>
      <group position={[0, 0, 0.42]}>
        <OfficeChair color={accent} />
      </group>
    </group>
  );
}

/** Grand bureau de direction : fauteuil derrière (côté −z), face aux visiteurs. Emprise 2.2 × 1.8. */
export function ExecutiveDesk({ accent }: { accent: string }) {
  return (
    <group>
      <group position={[0, 0, 0.3]}>
        <Box size={[2.2, 0.08, 1.0]} position={[0, 0.76, 0]} color={PALETTE.woodDark} />
        <Box size={[0.08, 0.72, 0.9]} position={[-1.0, 0.36, 0]} color={PALETTE.woodDark} />
        <Box size={[0.08, 0.72, 0.9]} position={[1.0, 0.36, 0]} color={PALETTE.woodDark} />
        <Box size={[1.9, 0.5, 0.05]} position={[0, 0.47, 0.42]} color={PALETTE.wood} />
        {/* Ordinateur portable ouvert vers le fauteuil (côté −z) : charnière côté visiteurs. */}
        <Box size={[0.5, 0.02, 0.34]} position={[-0.45, 0.81, -0.1]} color={PALETTE.metal} />
        <Box
          size={[0.5, 0.32, 0.02]}
          position={[-0.45, 0.975, 0.11]}
          rotation={[0.25, 0, 0]}
          color={PALETTE.screenFrame}
        />
        {/* Dossiers à valider, avec un tampon. */}
        <Box size={[0.34, 0.06, 0.26]} position={[0.35, 0.83, 0.05]} color={accent} />
        <Box
          size={[0.32, 0.04, 0.24]}
          position={[0.37, 0.88, 0.04]}
          rotation={[0, 0.12, 0]}
          color={PALETTE.paper}
        />
        <Box
          size={[0.3, 0.04, 0.24]}
          position={[0.36, 0.92, 0.05]}
          rotation={[0, -0.08, 0]}
          color="#d9ecf7"
        />
        <Cylinder
          radiusTop={0.04}
          height={0.12}
          position={[0.75, 0.86, -0.1]}
          color={PALETTE.dark}
        />
        <Cylinder radiusTop={0.07} height={0.03} position={[0.75, 0.81, -0.1]} color="#4caf50" />
        <Box size={[0.36, 0.07, 0.04]} position={[0, 0.83, 0.42]} color="#e8c46a" />
      </group>
      <group position={[0, 0, -0.55]} rotation={[0, Math.PI, 0]}>
        <OfficeChair color="#5b3a29" />
      </group>
    </group>
  );
}

/** Comptoir d'accueil. Emprise 2.0 × 0.8. */
export function ReceptionDesk({ accent }: { accent: string }) {
  return (
    <group>
      <Box size={[2.0, 0.95, 0.5]} position={[0, 0.475, 0.12]} color={PALETTE.white} />
      <Box size={[2.04, 0.05, 0.62]} position={[0, 0.98, 0.1]} color={PALETTE.wood} />
      <Box size={[1.9, 0.12, 0.02]} position={[0, 0.6, 0.38]} color={accent} />
      <Box size={[1.9, 0.7, 0.3]} position={[0, 0.35, -0.22]} color={PALETTE.wood} />
      <Sphere radius={0.06} position={[0.7, 1.04, 0.15]} color="#d4af37" />
      <Box
        size={[0.4, 0.26, 0.02]}
        position={[-0.4, 1.12, 0.0]}
        rotation={[-0.2, 0, 0]}
        color={PALETTE.screenFrame}
      />
    </group>
  );
}

export function FilingCabinet() {
  return (
    <group>
      <Box size={[0.55, 0.9, 0.6]} position={[0, 0.45, 0]} color="#c3cad3" />
      {[0.22, 0.5, 0.78].map((y) => (
        <group key={y}>
          <Box size={[0.5, 0.01, 0.01]} position={[0, y + 0.13, 0.3]} color={PALETTE.metal} />
          <Box size={[0.14, 0.03, 0.03]} position={[0, y, 0.31]} color={PALETTE.dark} />
        </group>
      ))}
    </group>
  );
}

export function Printer() {
  return (
    <group>
      <Box size={[0.6, 0.5, 0.5]} position={[0, 0.25, 0]} color="#d9dde3" />
      <Box size={[0.62, 0.3, 0.52]} position={[0, 0.65, 0]} color={PALETTE.white} />
      <Box size={[0.36, 0.02, 0.24]} position={[0, 0.81, 0.08]} color={PALETTE.paper} />
      <Box size={[0.14, 0.04, 0.02]} position={[0.18, 0.7, 0.27]} color="#4caf50" />
    </group>
  );
}

const BOOK_COLORS = ['#c0392b', '#2e86ab', '#f4a259', '#5b8e7d', '#8e6c8a', '#e9c46a', '#264653'];

/** Bibliothèque garnie. Emprise 1.4 × 0.45. */
export function Bookshelf() {
  const shelves = [0.08, 0.5, 0.92];
  return (
    <group>
      <Box size={[1.4, 1.4, 0.06]} position={[0, 0.7, -0.19]} color={PALETTE.woodDark} />
      <Box size={[0.06, 1.4, 0.45]} position={[-0.67, 0.7, 0]} color={PALETTE.woodDark} />
      <Box size={[0.06, 1.4, 0.45]} position={[0.67, 0.7, 0]} color={PALETTE.woodDark} />
      {[...shelves, 1.37].map((y) => (
        <Box key={y} size={[1.3, 0.04, 0.42]} position={[0, y, 0]} color={PALETTE.wood} />
      ))}
      {shelves.map((y, row) =>
        Array.from({ length: 8 }, (_, i) => {
          const h = 0.26 + ((i * 7 + row * 3) % 5) * 0.03;
          return (
            <Box
              key={`${row}-${i}`}
              size={[0.1, h, 0.3]}
              position={[-0.52 + i * 0.13 + (row % 2) * 0.04, y + 0.02 + h / 2, 0.02]}
              rotation={[0, 0, i === 6 ? 0.25 : 0]}
              color={BOOK_COLORS[(i + row * 2) % BOOK_COLORS.length]}
            />
          );
        }),
      )}
    </group>
  );
}

/** Table ronde de réunion avec un globe et quatre chaises. Emprise 2.6 × 2.6. */
export function MeetingTable({ accent }: { accent: string }) {
  return (
    <group>
      <Cylinder
        radiusTop={0.8}
        height={0.06}
        segments={12}
        position={[0, 0.74, 0]}
        color={PALETTE.white}
      />
      <Cylinder radiusTop={0.08} height={0.7} position={[0, 0.37, 0]} color={PALETTE.metal} />
      <Cylinder
        radiusTop={0.35}
        height={0.04}
        segments={10}
        position={[0, 0.02, 0]}
        color={PALETTE.metal}
      />
      <group position={[0, 0.77, 0]} scale={0.55}>
        <Globe accent={accent} />
      </group>
      <Box
        size={[0.3, 0.02, 0.22]}
        position={[0.45, 0.78, 0.25]}
        rotation={[0, 0.4, 0]}
        color={PALETTE.paper}
      />
      <Box
        size={[0.3, 0.02, 0.22]}
        position={[-0.45, 0.78, -0.25]}
        rotation={[0, -0.3, 0]}
        color={PALETTE.paper}
      />
      {[0, 1, 2, 3].map((i) => {
        const angle = (i * Math.PI) / 2 + Math.PI / 4;
        return (
          <At
            key={i}
            position={[Math.sin(angle) * 1.0, 0, Math.cos(angle) * 1.0]}
            rotationY={angle}
          >
            <Chair color={accent} />
          </At>
        );
      })}
    </group>
  );
}

/** Globe terrestre stylisé posé sur un pied (hauteur ≈ 0.75). */
export function Globe({ accent }: { accent: string }) {
  return (
    <group>
      <Cylinder
        radiusTop={0.12}
        radiusBottom={0.16}
        height={0.05}
        position={[0, 0.025, 0]}
        color={PALETTE.woodDark}
      />
      <Cylinder radiusTop={0.025} height={0.2} position={[0, 0.13, 0]} color={PALETTE.woodDark} />
      <group position={[0, 0.48, 0]} rotation={[0, 0, 0.4]}>
        <Sphere radius={0.26} detail={1} color="#5aa9e6" />
        {[
          [0.12, 0.14, 0.16],
          [-0.18, 0.05, 0.14],
          [0.05, -0.12, 0.22],
          [-0.02, 0.2, -0.15],
          [0.2, -0.05, -0.12],
        ].map(([x = 0, y = 0, z = 0], i) => (
          <Sphere key={i} radius={0.09} position={[x, y, z]} scale={[1, 0.7, 1]} color="#7fc8a9" />
        ))}
        <mesh rotation={[Math.PI / 2, 0, 0]} material={getMaterial(accent)} castShadow>
          <torusGeometry args={[0.31, 0.012, 4, 24]} />
        </mesh>
      </group>
    </group>
  );
}

/** Globe sur pied, posé au sol. Emprise 0.7 × 0.7. */
export function GlobeStand({ accent }: { accent: string }) {
  return (
    <group>
      <Cylinder radiusTop={0.06} height={0.5} position={[0, 0.25, 0]} color={PALETTE.woodDark} />
      <Cylinder
        radiusTop={0.28}
        radiusBottom={0.32}
        height={0.05}
        segments={8}
        position={[0, 0.025, 0]}
        color={PALETTE.woodDark}
      />
      <group position={[0, 0.45, 0]}>
        <Globe accent={accent} />
      </group>
    </group>
  );
}

/** Grande table partagée avec ordinateurs portables et six chaises. Emprise 3.2 × 2.2. */
export function LongTable({ accent }: { accent: string }) {
  const seats = [-1.05, 0, 1.05];
  return (
    <group>
      <Box size={[3.2, 0.06, 0.9]} position={[0, DESK_H, 0]} color={PALETTE.white} />
      <TableLegs w={3.1} d={0.8} />
      <Box size={[3.0, 0.01, 0.12]} position={[0, DESK_H + 0.035, 0]} color={accent} />
      {seats.map((x) => (
        <group key={x}>
          {[1, -1].map((side) => (
            <group
              key={side}
              position={[x, 0, side * 0.82]}
              rotation={[0, side === 1 ? 0 : Math.PI, 0]}
            >
              <Chair color={side === 1 ? accent : PALETTE.fabric} />
              {/* Portable ouvert, écran tourné vers la chaise. */}
              <group position={[0, DESK_H + 0.03, -0.55]}>
                <Box size={[0.4, 0.02, 0.28]} color={PALETTE.metal} />
                <group position={[0, 0.13, -0.14]} rotation={[-0.25, 0, 0]}>
                  <Box size={[0.4, 0.26, 0.015]} color={PALETTE.screenFrame} />
                  <group position={[0, 0, 0.009]}>
                    <ScreenDisplay content="doc" width={0.36} height={0.22} accent={accent} />
                  </group>
                </group>
              </group>
            </group>
          ))}
        </group>
      ))}
      <Cylinder
        radiusTop={0.045}
        height={0.1}
        position={[0.5, DESK_H + 0.08, 0.05]}
        color={accent}
      />
      <Cylinder
        radiusTop={0.045}
        height={0.1}
        position={[-0.6, DESK_H + 0.08, -0.08]}
        color={PALETTE.white}
      />
    </group>
  );
}

function BoardStand({ w, children }: { w: number; children: ReactNode }) {
  return (
    <group>
      {[-w / 2 + 0.08, w / 2 - 0.08].map((x) => (
        <group key={x}>
          <Box size={[0.05, 1.65, 0.05]} position={[x, 0.825, 0]} color={PALETTE.metal} />
          <Box size={[0.06, 0.04, 0.5]} position={[x, 0.04, 0]} color={PALETTE.metal} />
        </group>
      ))}
      <group position={[0, 1.12, 0.04]}>{children}</group>
    </group>
  );
}

/** Tableau blanc mobile. Emprise 2.0 × 0.6. */
export function WhiteboardStand({ accent }: { accent: string }) {
  return (
    <BoardStand w={2.0}>
      <Box size={[1.9, 1.0, 0.04]} color={PALETTE.metal} />
      <Panel size={[1.82, 0.92]} position={[0, 0, 0.021]} color={PALETTE.white} />
      {[0.28, 0.12, -0.04].map((y, i) => (
        <Panel
          key={y}
          size={[1.0 - i * 0.2, 0.04]}
          position={[-0.3 + i * 0.1, y, 0.023]}
          color={i === 0 ? accent : '#5c6b80'}
        />
      ))}
      <Panel size={[0.5, 0.3]} position={[0.5, 0.1, 0.023]} color="#ffe08a" />
      <Panel size={[0.5, 0.04]} position={[0.5, -0.28, 0.023]} color={accent} />
      <Box size={[1.4, 0.03, 0.08]} position={[0, -0.52, 0.04]} color={PALETTE.metal} />
    </BoardStand>
  );
}

const NOTE_COLORS = ['#ffe08a', '#a8dadc', '#f4a6a6', '#b5e48c'];

/** Tableau de suivi (colonnes de notes adhésives). Emprise 2.4 × 0.6. */
export function KanbanStand({ accent }: { accent: string }) {
  const columns = [3, 2, 3, 1];
  return (
    <BoardStand w={2.4}>
      <Box size={[2.3, 1.0, 0.04]} color={PALETTE.woodDark} />
      <Panel size={[2.22, 0.92]} position={[0, 0, 0.021]} color={PALETTE.white} />
      {columns.map((count, col) => (
        <group key={col} position={[-0.83 + col * 0.555, 0, 0.023]}>
          <Panel
            size={[0.48, 0.06]}
            position={[0, 0.38, 0]}
            color={col === 3 ? accent : '#5c6b80'}
          />
          {Array.from({ length: count }, (_, i) => (
            <Panel
              key={i}
              size={[0.36, 0.18]}
              position={[(i % 2) * 0.04 - 0.02, 0.2 - i * 0.24, 0.001]}
              color={NOTE_COLORS[(col + i) % NOTE_COLORS.length]}
            />
          ))}
        </group>
      ))}
    </BoardStand>
  );
}

/** Écran sur pied. Emprise 1.6 × 0.5. */
export function ScreenStand({ screen, accent }: { screen: ScreenContent; accent: string }) {
  return (
    <group>
      <Box size={[0.9, 0.04, 0.45]} position={[0, 0.02, 0]} color={PALETTE.dark} />
      <Box size={[0.1, 0.9, 0.08]} position={[0, 0.5, -0.05]} color={PALETTE.dark} />
      <group position={[0, 1.15, 0]}>
        <Box size={[1.5, 0.86, 0.06]} color={PALETTE.screenFrame} />
        <group position={[0, 0, 0.031]}>
          <ScreenDisplay content={screen} width={1.4} height={0.76} accent={accent} />
        </group>
      </group>
    </group>
  );
}

/** Casiers à courrier. Emprise 1.6 × 0.5. */
export function MailboxRack({ accent }: { accent: string }) {
  const cols = 4;
  const rows = 3;
  return (
    <group>
      <Box size={[1.6, 1.3, 0.45]} position={[0, 0.65, -0.02]} color={PALETTE.wood} />
      {Array.from({ length: cols * rows }, (_, i) => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const filled = (i * 5) % 3 !== 0;
        return (
          <group key={i} position={[-0.6 + c * 0.4, 0.3 + r * 0.38, 0.2]}>
            <Box size={[0.34, 0.3, 0.04]} color={PALETTE.woodDark} />
            {filled && (
              <Box
                size={[0.26, 0.12, 0.05]}
                position={[0, -0.05, 0.02]}
                color={i % 4 === 0 ? accent : PALETTE.paper}
              />
            )}
          </group>
        );
      })}
    </group>
  );
}

/** Chevalet de présentation. Emprise 0.8 × 0.6. */
export function Easel({ accent }: { accent: string }) {
  return (
    <group>
      <Box
        size={[0.05, 1.6, 0.05]}
        position={[-0.28, 0.78, 0.1]}
        rotation={[-0.12, 0, 0.12]}
        color={PALETTE.woodDark}
      />
      <Box
        size={[0.05, 1.6, 0.05]}
        position={[0.28, 0.78, 0.1]}
        rotation={[-0.12, 0, -0.12]}
        color={PALETTE.woodDark}
      />
      <Box
        size={[0.05, 1.5, 0.05]}
        position={[0, 0.72, -0.18]}
        rotation={[0.25, 0, 0]}
        color={PALETTE.woodDark}
      />
      <group position={[0, 1.1, 0.02]} rotation={[-0.12, 0, 0]}>
        <Box size={[0.72, 0.6, 0.03]} color={PALETTE.white} />
        <group position={[0, 0, 0.016]}>
          <ScreenDisplay content="barChart" width={0.62} height={0.48} accent={accent} />
        </group>
      </group>
      <Box size={[0.7, 0.04, 0.1]} position={[0, 0.78, 0.08]} color={PALETTE.woodDark} />
    </group>
  );
}
