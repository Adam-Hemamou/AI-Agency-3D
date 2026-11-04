/**
 * Les sept espaces de travail de l'agence, dans l'ordre du pipeline commercial.
 * Identifiants, libellés et fonctions. La représentation 3D est définie dans apps/web.
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
  director: 'Mon bureau',
  dubbing: 'Studio de doublage',
  copywriting: 'Salle commerciale',
  email_review: 'Salle de validation des e-mails',
  followup: 'Salle de suivi',
};

/** Fonction de chaque espace, affichée dans l'interface. */
export const ROOM_DESCRIPTIONS: Record<RoomId, string> = {
  prospecting: 'Recherche de créateurs YouTube.',
  analysis: 'Étude du potentiel international des créateurs.',
  director: 'Validation humaine des prospects et des dossiers.',
  dubbing: 'Préparation des extraits et des démonstrations de doublage HeyGen.',
  copywriting: 'Rédaction des propositions commerciales personnalisées.',
  email_review: 'Vérification des messages avant leur envoi.',
  followup: 'Gestion des réponses et des relances.',
};

export function isRoomId(value: unknown): value is RoomId {
  return typeof value === 'string' && (ROOM_IDS as readonly string[]).includes(value);
}
