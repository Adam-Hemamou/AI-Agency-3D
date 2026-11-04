import { useEffect } from 'react';
import { ROOM_DEFAULT_SECTION } from '@agency/shared';
import { useRoomMissions } from '../../api/missions';
import { SPACE_DESIGNS } from '../../scene/rooms/roomDesigns';
import { useAgencyStore } from '../../stores/agencyStore';
import { RoomPanel } from './RoomPanel';

/**
 * Relie le panneau à la salle sélectionnée et aux missions de l'API.
 * Un clic sur une mission ouvre le dossier du prospect, sur la section de la salle.
 * Échap ferme le panneau, sauf si un dossier est ouvert (Échap ferme alors le dossier).
 */
export function RoomPanelContainer() {
  const room = useAgencyStore((s) => s.selectedRoom);
  const closeRoom = useAgencyStore((s) => s.closeRoom);
  const openDossier = useAgencyStore((s) => s.openDossier);
  const activeMissionId = useAgencyStore((s) => s.dossier?.missionId ?? null);
  const missions = useRoomMissions(room);

  useEffect(() => {
    if (!room) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (useAgencyStore.getState().dossier) return;
      closeRoom();
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
      activeMissionId={activeMissionId}
      onOpenMission={(mission) =>
        openDossier({
          prospectId: mission.prospect?.id ?? null,
          missionId: mission.id,
          section: ROOM_DEFAULT_SECTION[room],
        })
      }
    />
  );
}
