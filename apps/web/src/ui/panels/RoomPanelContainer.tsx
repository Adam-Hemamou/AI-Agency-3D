import { useEffect } from 'react';
import { useRoomMissions } from '../../api/missions';
import { SPACE_DESIGNS } from '../../scene/rooms/roomDesigns';
import { useAgencyStore } from '../../stores/agencyStore';
import { RoomPanel } from './RoomPanel';

/** Relie le panneau à la salle sélectionnée et aux missions de l'API. Échap ferme le panneau. */
export function RoomPanelContainer() {
  const room = useAgencyStore((s) => s.selectedRoom);
  const closeRoom = useAgencyStore((s) => s.closeRoom);
  const missions = useRoomMissions(room);

  useEffect(() => {
    if (!room) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRoom();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [room, closeRoom]);

  if (!room) return null;
  const design = SPACE_DESIGNS[room];
  return (
    <RoomPanel
      key={room}
      room={room}
      accent={design.theme.accent}
      icon={design.icon}
      data={missions.data}
      isLoading={missions.isLoading}
      error={missions.error}
      onClose={closeRoom}
      onRetry={() => void missions.refetch()}
    />
  );
}
