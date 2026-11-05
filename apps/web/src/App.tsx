import { AgencyScene } from './scene/AgencyScene';
import { RoomLabels } from './scene/labels/RoomLabels';
import { DossierOverlay } from './ui/dossier/DossierOverlay';
import { AuthGate } from './ui/auth/AuthGate';
import { AgencyHud } from './ui/hud/AgencyHud';
import { RoomPanelContainer } from './ui/panels/RoomPanelContainer';

export function App() {
  return (
    <AuthGate>
      <Agency />
    </AuthGate>
  );
}

function Agency() {
  return (
    <div className="app">
      <div className="app__scene">
        <AgencyScene />
      </div>
      <RoomLabels />
      <AgencyHud />
      <RoomPanelContainer />
      <DossierOverlay />
    </div>
  );
}
