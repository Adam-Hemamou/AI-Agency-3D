import type { RoomId } from './rooms';

/**
 * CRM : un prospect = un dossier unique qui traverse les sept salles.
 * Les missions, analyses, productions, décisions, messages et événements
 * lui sont rattachés ; son identité ne change jamais d'une salle à l'autre.
 */

// ---------------------------------------------------------------------------
// Étapes du parcours
// ---------------------------------------------------------------------------

export const PROSPECT_STAGES = [
  'prospecting',
  'analysis',
  'review',
  'dubbing',
  'proposal',
  'email_review',
  'followup',
  'converted',
  'refused',
  'archived',
] as const;
export type ProspectStage = (typeof PROSPECT_STAGES)[number];

export const PROSPECT_STAGE_LABELS: Record<ProspectStage, string> = {
  prospecting: 'Découvert',
  analysis: 'En analyse',
  review: 'À valider',
  dubbing: 'Doublage',
  proposal: 'Proposition',
  email_review: 'Validation e-mail',
  followup: 'Suivi',
  converted: 'Converti',
  refused: 'Refusé',
  archived: 'Archivé',
};

/** Étapes après lesquelles le prospect ne progresse plus. */
export const FINAL_PROSPECT_STAGES: readonly ProspectStage[] = ['converted', 'refused', 'archived'];

/** Salle dans laquelle se trouve le prospect à chaque étape (null : sorti du parcours). */
export const PROSPECT_STAGE_ROOMS: Record<ProspectStage, RoomId | null> = {
  prospecting: 'prospecting',
  analysis: 'analysis',
  review: 'director',
  dubbing: 'dubbing',
  proposal: 'copywriting',
  email_review: 'email_review',
  followup: 'followup',
  converted: 'followup',
  refused: 'director',
  archived: null,
};

/** Transitions d'étape autorisées. Toute autre transition est refusée par le serveur. */
export const PROSPECT_STAGE_TRANSITIONS: Record<ProspectStage, readonly ProspectStage[]> = {
  prospecting: ['analysis', 'archived'],
  analysis: ['review', 'archived'],
  review: ['dubbing', 'analysis', 'refused', 'archived'],
  dubbing: ['proposal', 'archived'],
  proposal: ['email_review', 'archived'],
  email_review: ['proposal', 'followup', 'archived'],
  followup: ['converted', 'archived'],
  converted: [],
  refused: [],
  archived: [],
};

export function canMoveToStage(from: ProspectStage, to: ProspectStage): boolean {
  return PROSPECT_STAGE_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Statut de la relation (salle de suivi)
// ---------------------------------------------------------------------------

export const RELATIONSHIP_STATUSES = [
  'awaiting_reply',
  'reply_received',
  'followup_due',
  'interested',
  'in_discussion',
  'not_interested',
  'converted',
  'archived',
] as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

export const RELATIONSHIP_STATUS_LABELS: Record<RelationshipStatus, string> = {
  awaiting_reply: 'En attente de réponse',
  reply_received: 'Réponse reçue',
  followup_due: 'Relance à effectuer',
  interested: 'Intéressé',
  in_discussion: 'Discussion en cours',
  not_interested: 'Non intéressé',
  converted: 'Converti',
  archived: 'Archivé',
};

/** Statuts de relation après lesquels aucune relance n'est permise. */
export const NO_FOLLOWUP_STATUSES: readonly RelationshipStatus[] = [
  'not_interested',
  'converted',
  'archived',
];

/** Une relance est-elle permise ? (refus, désinscription ou relation close : jamais) */
export function canSendFollowup(p: {
  doNotContact: boolean;
  relationshipStatus: RelationshipStatus | null;
  stage: ProspectStage;
}): { allowed: true } | { allowed: false; reason: string } {
  if (p.doNotContact) {
    return { allowed: false, reason: 'Le prospect a demandé à ne plus être contacté.' };
  }
  if (p.stage !== 'followup') {
    return { allowed: false, reason: 'Aucun premier e-mail n’a encore été envoyé.' };
  }
  if (p.relationshipStatus && NO_FOLLOWUP_STATUSES.includes(p.relationshipStatus)) {
    return {
      allowed: false,
      reason: `Relance impossible : ${RELATIONSHIP_STATUS_LABELS[p.relationshipStatus].toLowerCase()}.`,
    };
  }
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Analyses : distinguer faits, observations et hypothèses
// ---------------------------------------------------------------------------

export const INSIGHT_KINDS = ['fact', 'observation', 'hypothesis'] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number];

export const INSIGHT_KIND_LABELS: Record<InsightKind, string> = {
  fact: 'Fait vérifié',
  observation: 'Observation',
  hypothesis: 'Hypothèse IA',
};

// ---------------------------------------------------------------------------
// Productions (extraits, doublages, propositions, e-mails)
// ---------------------------------------------------------------------------

export const PRODUCTION_KINDS = ['video_excerpt', 'dubbing', 'proposal', 'email'] as const;
export type ProductionKind = (typeof PRODUCTION_KINDS)[number];

export const PRODUCTION_KIND_LABELS: Record<ProductionKind, string> = {
  video_excerpt: 'Extrait vidéo',
  dubbing: 'Doublage',
  proposal: 'Proposition commerciale',
  email: 'E-mail',
};

export const PRODUCTION_STATUSES = [
  'draft',
  'pending_review',
  'approved',
  'changes_requested',
  'rejected',
  'generated',
  'failed',
  'sent',
  'superseded',
] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

export const PRODUCTION_STATUS_LABELS: Record<ProductionStatus, string> = {
  draft: 'Brouillon',
  pending_review: 'En attente de validation',
  approved: 'Validé',
  changes_requested: 'Modifications demandées',
  rejected: 'Refusé',
  generated: 'Généré',
  failed: 'Échec',
  sent: 'Envoyé',
  superseded: 'Remplacé',
};

// ---------------------------------------------------------------------------
// Décisions humaines
// ---------------------------------------------------------------------------

/** Décisions de Mon bureau sur un prospect. */
export const PROSPECT_DECISIONS = ['approve', 'reject', 'request_reanalysis'] as const;
export type ProspectDecision = (typeof PROSPECT_DECISIONS)[number];

export const PROSPECT_DECISION_LABELS: Record<ProspectDecision, string> = {
  approve: 'Valider le prospect',
  reject: 'Refuser le prospect',
  request_reanalysis: 'Demander une nouvelle analyse',
};

/** Décisions de la salle de validation sur un e-mail. */
export const EMAIL_DECISIONS = ['approve', 'reject', 'request_changes'] as const;
export type EmailDecision = (typeof EMAIL_DECISIONS)[number];

export const EMAIL_DECISION_LABELS: Record<EmailDecision, string> = {
  approve: 'Valider l’e-mail',
  reject: 'Refuser l’e-mail',
  request_changes: 'Demander une modification',
};

export const DECISION_KINDS = [
  'prospect_approved',
  'prospect_rejected',
  'reanalysis_requested',
  'email_approved',
  'email_rejected',
  'email_changes_requested',
] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

export const DECISION_KIND_LABELS: Record<DecisionKind, string> = {
  prospect_approved: 'Prospect validé',
  prospect_rejected: 'Prospect refusé',
  reanalysis_requested: 'Nouvelle analyse demandée',
  email_approved: 'E-mail validé',
  email_rejected: 'E-mail refusé',
  email_changes_requested: 'Modification de l’e-mail demandée',
};

// ---------------------------------------------------------------------------
// Messages échangés
// ---------------------------------------------------------------------------

export const MESSAGE_DIRECTIONS = ['outbound', 'inbound'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_KINDS = ['initial', 'followup', 'reply'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const MESSAGE_KIND_LABELS: Record<MessageKind, string> = {
  initial: 'Premier e-mail',
  followup: 'Relance',
  reply: 'Réponse',
};

/** "simulated" : aucun e-mail réel n'est parti (mode simulation). */
export const MESSAGE_DELIVERY = ['simulated', 'sent', 'received'] as const;
export type MessageDelivery = (typeof MESSAGE_DELIVERY)[number];

// ---------------------------------------------------------------------------
// Événements de la timeline
// ---------------------------------------------------------------------------

export const PROSPECT_EVENT_TYPES = [
  'discovered',
  'stage_changed',
  'analysis_added',
  'production_added',
  'production_status_changed',
  'decision_recorded',
  'email_sent',
  'reply_received',
  'followup_sent',
  'followup_updated',
  'note_added',
  'mission_linked',
  /** Informations du prospect complétées (par un agent). */
  'prospect_enriched',
  /** Activité signalée par un agent (recherche effectuée, étape de travail…). */
  'agent_activity',
] as const;
export type ProspectEventType = (typeof PROSPECT_EVENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Types de missions du pipeline
// ---------------------------------------------------------------------------

export const PIPELINE_MISSION_TYPES = {
  /**
   * Recherche de créateurs (salle de prospection) : une mission couvre toute une session de
   * recherche. Les prospects créés par un agent y sont rattachés (historique du dossier), sans
   * mission de découverte propre.
   */
  search: 'search_creators',
  /** Découverte d'un créateur : uniquement le scénario de démonstration (jamais un agent réel). */
  discover: 'discover_creator',
  analyze: 'analyze_creator',
  review: 'review_prospect',
  dubbing: 'prepare_dubbing',
  proposal: 'write_proposal',
  emailReview: 'review_email',
  followup: 'follow_up',
} as const;

/** Libellés lisibles des types de missions connus (les autres s'affichent tels quels). */
export const MISSION_TYPE_LABELS: Record<string, string> = {
  search_creators: 'Recherche de créateurs',
  discover_creator: 'Découverte d’un créateur',
  analyze_creator: 'Analyse du créateur',
  review_prospect: 'Validation du prospect',
  prepare_dubbing: 'Démonstration de doublage',
  write_proposal: 'Proposition commerciale',
  review_email: 'Validation de l’e-mail',
  follow_up: 'Suivi commercial',
  market_watch: 'Veille de marché',
};

export function missionTypeLabel(type: string): string {
  return MISSION_TYPE_LABELS[type] ?? type;
}

// ---------------------------------------------------------------------------
// Sections du dossier
// ---------------------------------------------------------------------------

export const DOSSIER_SECTIONS = [
  'overview',
  'prospecting',
  'analysis',
  'decision',
  'dubbing',
  'commercial',
  'emails',
  'followup',
  'timeline',
  'missions',
] as const;
export type DossierSection = (typeof DOSSIER_SECTIONS)[number];

export const DOSSIER_SECTION_LABELS: Record<DossierSection, string> = {
  overview: 'Vue générale',
  prospecting: 'Prospection',
  analysis: 'Analyse',
  decision: 'Validation',
  dubbing: 'Doublage',
  commercial: 'Commercial',
  emails: 'E-mails',
  followup: 'Suivi',
  timeline: 'Historique',
  missions: 'Missions',
};

/** Section ouverte par défaut selon la salle depuis laquelle on consulte le dossier. */
export const ROOM_DEFAULT_SECTION: Record<RoomId, DossierSection> = {
  prospecting: 'prospecting',
  analysis: 'analysis',
  director: 'decision',
  dubbing: 'dubbing',
  copywriting: 'commercial',
  email_review: 'emails',
  followup: 'followup',
};
