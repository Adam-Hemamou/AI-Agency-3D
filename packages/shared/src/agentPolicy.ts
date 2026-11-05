import type { MissionAction } from './missionLifecycle';
import type { ProductionKind, ProductionStatus, ProspectStage } from './prospects';

/**
 * Ce que les agents IA ont le droit de faire dans le CRM. Source unique : le serveur applique
 * ces règles (routes ET services), l'interface et n8n peuvent s'en servir pour l'affichage.
 *
 * Principe : tout ce qui n'est pas listé ici est interdit à un agent. Les validations,
 * décisions et envois restent toujours à l'utilisateur humain.
 */

// ---------------------------------------------------------------------------
// Permissions, accordées une par une à chaque agent par l'utilisateur
// ---------------------------------------------------------------------------

export const AGENT_PERMISSIONS = [
  // Lecture : chaque catégorie de données a sa propre permission.
  'prospects:read',
  'prospects:read_contact',
  'analyses:read',
  'productions:read',
  'proposals:read',
  'messages:read',
  /** Autorisation explicite : motifs des décisions humaines. Aucun rôle ne l'a par défaut. */
  'decisions:read',
  /** Autorisation explicite : notes internes de l'utilisateur. Aucun rôle ne l'a par défaut. */
  'notes:read',
  // Écriture.
  'prospects:create',
  'prospects:enrich',
  'analyses:write',
  'productions:write',
  'stages:advance',
  'events:write',
  'missions:read',
  'missions:update',
] as const;
export type AgentPermission = (typeof AGENT_PERMISSIONS)[number];

export const AGENT_PERMISSION_LABELS: Record<AgentPermission, string> = {
  'prospects:read':
    'Informations publiques des dossiers (chaîne, statistiques publiques, étape, missions)',
  'prospects:read_contact': 'Coordonnées professionnelles (e-mail et nom du contact)',
  'analyses:read': 'Analyses et scores de potentiel',
  'productions:read': 'Productions du doublage (extraits vidéo, doublages)',
  'proposals:read': 'Propositions commerciales et brouillons d’e-mails',
  'messages:read': 'E-mails échangés et état de la relation',
  'decisions:read': 'Motifs des décisions humaines (autorisation explicite)',
  'notes:read': 'Notes internes de l’utilisateur (autorisation explicite)',
  'prospects:create': 'Créer un prospect et son dossier',
  'prospects:enrich': 'Compléter les informations d’un prospect',
  'analyses:write': 'Ajouter une analyse et un score',
  'productions:write':
    'Ajouter une production, du type que l’agent peut lire (doublage ou proposition)',
  'stages:advance': 'Faire avancer un prospect dans le parcours (étapes autorisées uniquement)',
  'events:write': 'Ajouter une activité à l’historique du dossier',
  'missions:read': 'Consulter les missions',
  'missions:update': 'Faire évoluer ses missions (démarrer, soumettre, terminer…)',
};

/**
 * Permission de lecture qui donne accès à chaque type de production. Elle est aussi exigée
 * pour en AJOUTER : un agent ne produit que ce qu'il a le droit de lire.
 */
export const PRODUCTION_READ_PERMISSION: Record<ProductionKind, AgentPermission> = {
  video_excerpt: 'productions:read',
  dubbing: 'productions:read',
  proposal: 'proposals:read',
  email: 'proposals:read',
};

// ---------------------------------------------------------------------------
// Rôles : permissions recommandées. L'utilisateur les attribue explicitement à la création
// de l'agent ; elles ne sont jamais déduites automatiquement d'un rôle.
// ---------------------------------------------------------------------------

export const AGENT_ROLES = ['prospector', 'analyst', 'producer', 'sales', 'followup'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  prospector: 'Prospecteur',
  analyst: 'Analyste',
  producer: 'Producteur (doublage)',
  sales: 'Commercial',
  followup: 'Suivi',
};

const WORK = ['events:write', 'missions:read', 'missions:update'] as const;

export const AGENT_ROLE_PERMISSIONS: Record<AgentRole, readonly AgentPermission[]> = {
  /** Informations publiques nécessaires à la prospection. */
  prospector: ['prospects:read', 'prospects:create', 'prospects:enrich', 'stages:advance', ...WORK],
  /** Informations publiques et analyses. */
  analyst: [
    'prospects:read',
    'analyses:read',
    'analyses:write',
    'prospects:enrich',
    'stages:advance',
    ...WORK,
  ],
  /** Uniquement ce qui sert au doublage : informations publiques et productions du doublage. */
  producer: ['prospects:read', 'productions:read', 'productions:write', 'stages:advance', ...WORK],
  /** Coordonnées professionnelles et ce qui sert à préparer la proposition. */
  sales: [
    'prospects:read',
    'prospects:read_contact',
    'analyses:read',
    'productions:read',
    'proposals:read',
    'productions:write',
    'stages:advance',
    ...WORK,
  ],
  /** Coordonnées professionnelles et échanges nécessaires au suivi. */
  followup: [
    'prospects:read',
    'prospects:read_contact',
    'proposals:read',
    'messages:read',
    ...WORK,
  ],
};

export function isAgentPermission(value: unknown): value is AgentPermission {
  return typeof value === 'string' && (AGENT_PERMISSIONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Étapes du parcours qu'un agent peut faire franchir
// ---------------------------------------------------------------------------

/**
 * Seuls les passages « travail terminé, au suivant » sont ouverts aux agents.
 * Valider ou refuser un prospect, renvoyer en analyse, valider un e-mail (donc passer au suivi),
 * convertir et archiver restent des décisions humaines.
 */
export const AGENT_STAGE_TRANSITIONS: Partial<Record<ProspectStage, readonly ProspectStage[]>> = {
  prospecting: ['analysis'],
  analysis: ['review'],
  dubbing: ['proposal'],
  proposal: ['email_review'],
};

export function canAgentMoveToStage(from: ProspectStage, to: ProspectStage): boolean {
  return AGENT_STAGE_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Analyses et productions
// ---------------------------------------------------------------------------

/** Étapes où un agent peut ajouter une analyse. */
export const AGENT_ANALYSIS_STAGES: readonly ProspectStage[] = ['analysis'];

/**
 * Productions qu'un agent peut ajouter : étapes où c'est possible et statuts qu'il peut donner.
 * Jamais "approved", "sent", "rejected"… : ces statuts traduisent une décision humaine ou un envoi.
 */
export const AGENT_PRODUCTION_RULES: Record<
  ProductionKind,
  { stages: readonly ProspectStage[]; statuses: readonly ProductionStatus[] }
> = {
  video_excerpt: { stages: ['dubbing'], statuses: ['draft', 'generated', 'failed'] },
  dubbing: { stages: ['dubbing'], statuses: ['draft', 'generated', 'failed'] },
  proposal: { stages: ['proposal'], statuses: ['draft', 'pending_review'] },
  email: { stages: ['proposal', 'email_review'], statuses: ['draft', 'pending_review'] },
};

export function checkAgentProduction(
  stage: ProspectStage,
  kind: ProductionKind,
  status: ProductionStatus,
): { allowed: true } | { allowed: false; reason: string } {
  const rule = AGENT_PRODUCTION_RULES[kind];
  if (!rule.stages.includes(stage)) {
    return { allowed: false, reason: `Production « ${kind} » impossible à l’étape « ${stage} »` };
  }
  if (!rule.statuses.includes(status)) {
    return { allowed: false, reason: `Un agent ne peut pas donner le statut « ${status} »` };
  }
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

/**
 * Actions de mission ouvertes aux agents. "complete" reste refusé par le moteur pour une mission
 * qui exige une validation humaine. Annuler et débloquer restent à l'utilisateur.
 */
export const AGENT_MISSION_ACTIONS: readonly MissionAction[] = [
  'start',
  'pause',
  'resume',
  'submit_for_validation',
  'complete',
  'block',
];

export function isAgentMissionAction(action: MissionAction): boolean {
  return AGENT_MISSION_ACTIONS.includes(action);
}
