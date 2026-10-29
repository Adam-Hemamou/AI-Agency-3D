/**
 * Les sept espaces de travail de l'agence, dans l'ordre du pipeline commercial.
 * Seuls les identifiants et libellés sont définis ici : la représentation 3D
 * et la logique de chaque salle viendront dans les phases suivantes.
 */
export const ROOM_IDS = [
  'prospecting',
  'analysis',
  'director',
  'dubbing',
  'copywriting',
  'email_review',
  'followup',
] as const;

export type RoomId = (typeof ROOM_IDS)[number];

export const ROOM_LABELS: Record<RoomId, string> = {
  prospecting: 'Salle de prospection',
  analysis: "Salle d'analyse",
  director: 'Bureau du dirigeant',
  dubbing: 'Studio de doublage',
  copywriting: 'Salle de rédaction',
  email_review: 'Salle de validation des e-mails',
  followup: 'Salle de suivi commercial',
};

export function isRoomId(value: unknown): value is RoomId {
  return typeof value === 'string' && (ROOM_IDS as readonly string[]).includes(value);
}
