import { ROOM_INTERIOR } from '../layout/agencyLayout';
import { PALETTE } from '../materials';
import type { FloorPlacement, WallPlacement } from '../rooms/roomDesigns';
import { FLOOR_PROPS, type FloorPropKind, type WallPropKind } from './catalog';
import {
  Armchair,
  BeanBag,
  Bench,
  CoffeeTable,
  FloorLamp,
  Kitchenette,
  Rug,
  Sofa,
  WaterCooler,
} from './lounge';
import {
  Bookshelf,
  Chair,
  Easel,
  ExecutiveDesk,
  FilingCabinet,
  GlobeStand,
  KanbanStand,
  LongTable,
  MailboxRack,
  MeetingTable,
  Printer,
  ReceptionDesk,
  ScreenStand,
  WhiteboardStand,
  Workstation,
} from './office';
import { Plant, PlantSmall, PlantTall } from './plants';
import { CameraTripod, GreenScreen, MicStand, MixingDesk, Softbox } from './studio';
import {
  AcousticPanels,
  CheckSign,
  Corkboard,
  OnAirSign,
  Painting,
  WallClock,
  WallScreen,
  WallWindow,
} from './wall';

/**
 * Rendu d'un meuble ou d'un objet mural à partir de sa description (roomDesigns.ts).
 * Ajouter un meuble : une entrée dans catalog.ts, un composant, un cas ci-dessous.
 * Le typage `Record<…Kind, …>` garantit qu'aucun type du catalogue n'est oublié.
 */

type FloorRenderer = (p: FloorPlacement, accent: string) => React.JSX.Element;

const FLOOR_RENDERERS: Record<FloorPropKind, FloorRenderer> = {
  workstation: (p, a) => (
    <Workstation screen={p.screen ?? 'play'} accent={a} accessory={p.accessory} />
  ),
  executiveDesk: (_, a) => <ExecutiveDesk accent={a} />,
  receptionDesk: (_, a) => <ReceptionDesk accent={a} />,
  chair: (p) => <Chair color={p.color} />,
  plant: () => <Plant />,
  plantSmall: () => <PlantSmall />,
  plantTall: () => <PlantTall />,
  bookshelf: () => <Bookshelf />,
  sofa: (p) => <Sofa color={p.color ?? PALETTE.fabric} />,
  armchair: (p) => <Armchair color={p.color ?? PALETTE.fabric} />,
  coffeeTable: (_, a) => <CoffeeTable accent={a} />,
  floorLamp: () => <FloorLamp />,
  meetingTable: (_, a) => <MeetingTable accent={a} />,
  longTable: (_, a) => <LongTable accent={a} />,
  filingCabinet: () => <FilingCabinet />,
  micStand: (_, a) => <MicStand accent={a} />,
  cameraTripod: () => <CameraTripod />,
  softbox: () => <Softbox />,
  mixingDesk: (p, a) => <MixingDesk accent={a} screen={p.screen} />,
  greenScreen: () => <GreenScreen />,
  easel: (_, a) => <Easel accent={a} />,
  printer: () => <Printer />,
  beanBag: (p, a) => <BeanBag color={p.color ?? a} />,
  globeStand: (_, a) => <GlobeStand accent={a} />,
  waterCooler: () => <WaterCooler />,
  kitchenette: (_, a) => <Kitchenette accent={a} />,
  whiteboardStand: (_, a) => <WhiteboardStand accent={a} />,
  kanbanStand: (_, a) => <KanbanStand accent={a} />,
  screenStand: (p, a) => <ScreenStand screen={p.screen ?? 'inbox'} accent={a} />,
  mailboxRack: (_, a) => <MailboxRack accent={a} />,
  bench: () => <Bench />,
  rug: (p, a) => (
    <Rug size={p.size ?? [FLOOR_PROPS.rug.w, FLOOR_PROPS.rug.d]} color={p.color ?? a} />
  ),
};

type WallRenderer = (p: WallPlacement, accent: string) => React.JSX.Element;

const WALL_RENDERERS: Record<WallPropKind, WallRenderer> = {
  wallScreen: (p, a) => <WallScreen width={p.width} accent={a} screen={p.screen} />,
  corkboard: (p, a) => <Corkboard width={p.width} accent={a} />,
  acousticPanels: (p, a) => <AcousticPanels width={p.width} accent={a} />,
  painting: (p, a) => <Painting width={p.width} accent={a} />,
  checkSign: (p, a) => <CheckSign width={p.width} accent={a} />,
  onAirSign: (p, a) => <OnAirSign width={p.width} accent={a} />,
  window: (p, a) => <WallWindow width={p.width} accent={a} />,
  clock: (p, a) => <WallClock width={p.width} accent={a} />,
};

export function FloorProp({ placement, accent }: { placement: FloorPlacement; accent: string }) {
  const [x, z] = placement.at;
  return (
    <group position={[x, 0, z]} rotation={[0, ((placement.rot ?? 0) * Math.PI) / 2, 0]}>
      {FLOOR_RENDERERS[placement.kind](placement, accent)}
    </group>
  );
}

/** Place un objet contre le mur nord (face +z) ou ouest (face +x). */
export function WallProp({ placement, accent }: { placement: WallPlacement; accent: string }) {
  const position: [number, number, number] =
    placement.wall === 'north'
      ? [placement.offset, placement.y, ROOM_INTERIOR.minZ]
      : [ROOM_INTERIOR.minX, placement.y, placement.offset];
  return (
    <group position={position} rotation={[0, placement.wall === 'north' ? 0 : Math.PI / 2, 0]}>
      {WALL_RENDERERS[placement.kind](placement, accent)}
    </group>
  );
}
