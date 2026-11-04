import { AgencyScene } from './scene/AgencyScene';
import { RoomLabels } from './scene/labels/RoomLabels';
import { AgencyHud } from './ui/hud/AgencyHud';
import { RoomPanelContainer } from './ui/panels/RoomPanelContainer';

export function App() {
  return (
    <div className="app">
      <div className="app__scene">
        <AgencyScene />
      </div>
      <RoomLabels />
      <AgencyHud />
      <RoomPanelContainer />
    </div>
  );
}
