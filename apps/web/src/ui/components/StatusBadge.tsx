import { MISSION_STATUS_LABELS, type MissionStatus } from '@agency/shared';

/** Couleur d'affichage de chaque statut (le typage impose de n'en oublier aucun). */
export const STATUS_TONES: Record<MissionStatus, { bg: string; fg: string }> = {
  pending: { bg: '#eef0f4', fg: '#4a5263' },
  in_progress: { bg: '#e3efff', fg: '#1d5fbf' },
  awaiting_validation: { bg: '#fff1d6', fg: '#a0610a' },
  paused: { bg: '#efeaf7', fg: '#6a4f9c' },
  completed: { bg: '#e2f5e8', fg: '#1f7a3f' },
  cancelled: { bg: '#f1eeee', fg: '#7d6f6f' },
  blocked: { bg: '#fde4e4', fg: '#b42323' },
};

export function StatusBadge({ status }: { status: MissionStatus }) {
  const tone = STATUS_TONES[status];
  return (
    <span className="status-badge" style={{ background: tone.bg, color: tone.fg }}>
      {MISSION_STATUS_LABELS[status]}
    </span>
  );
}
