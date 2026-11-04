import { useAgencyStore } from '../../stores/agencyStore';
import type { SpaceId } from '../layout/agencyLayout';
import { SPACE_DESIGNS } from '../rooms/roomDesigns';
import { labelRegistry } from './labelRegistry';

/** Étiquettes des salles, superposées à la scène (positionnées par LabelProjector). */
export function RoomLabels() {
  const hoveredRoom = useAgencyStore((s) => s.hoveredRoom);
  const selectedRoom = useAgencyStore((s) => s.selectedRoom);

  return (
    <div className="room-labels" aria-hidden="true">
      {(Object.keys(SPACE_DESIGNS) as SpaceId[]).map((id) => {
        const design = SPACE_DESIGNS[id];
        const interactive = id !== 'lounge';
        return (
          <div key={id} ref={(el) => labelRegistry.register(id, el)} className="room-label-anchor">
            <div
              className={[
                'room-label',
                interactive ? '' : 'room-label--muted',
                hoveredRoom === id ? 'room-label--hover' : '',
                selectedRoom === id ? 'room-label--selected' : '',
              ].join(' ')}
              style={{ ['--accent' as string]: design.theme.accent }}
            >
              <span className="room-label__icon">{design.icon}</span>
              {design.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
