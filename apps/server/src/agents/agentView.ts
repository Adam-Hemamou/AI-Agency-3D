import {
  PRODUCTION_READ_PERMISSION,
  type AgentDossier,
  type AgentHiddenSection,
  type AgentInstruction,
  type AgentPermission,
  type AgentProspect,
  type ProspectDossier,
  type ProspectEvent,
} from '@agency/shared';

/**
 * Dossier tel qu'un agent a le droit de le voir. SEUL point qui décide de ce qu'un agent lit :
 * contexte de travail, réponses des écritures et réponses rejouées passent tous par ici.
 *
 * Règle : une donnée n'apparaît que si l'agent a la permission de lecture correspondante.
 * Les notes internes et les motifs des décisions humaines exigent une autorisation explicite
 * (notes:read, decisions:read) qu'aucun rôle n'a par défaut.
 */

type Permissions = ReadonlySet<AgentPermission>;

/** Champs de l'enrichissement qui sont des coordonnées : retirés de l'historique sans prospects:read_contact. */
const CONTACT_FIELDS = new Set(['contactEmail', 'contactName', 'contactSource']);

/** Catégorie d'un événement, pour décider s'il est visible. */
function eventVisible(event: ProspectEvent, can: (p: AgentPermission) => boolean): boolean {
  switch (event.type) {
    case 'discovered':
    case 'stage_changed':
    case 'mission_linked':
    case 'agent_activity':
    case 'prospect_enriched':
      return true;
    case 'analysis_added':
      return can('analyses:read');
    case 'production_added':
    case 'production_status_changed': {
      const kind = event.payload.kind as keyof typeof PRODUCTION_READ_PERMISSION | undefined;
      return kind !== undefined && kind in PRODUCTION_READ_PERMISSION
        ? can(PRODUCTION_READ_PERMISSION[kind])
        : false;
    }
    case 'email_sent':
    case 'reply_received':
    case 'followup_sent':
    case 'followup_updated':
      return can('messages:read');
    case 'decision_recorded':
      return can('decisions:read');
    case 'note_added':
      return can('notes:read');
    default:
      // Nouveau type d'événement : invisible tant qu'il n'est pas classé ici.
      return false;
  }
}

/**
 * Changement d'étape décidé par l'utilisateur ou le système (à la suite d'une décision humaine) :
 * son détail peut reprendre le texte de la décision. Retiré sans decisions:read ; la consigne
 * utile à l'agent concerné reste disponible dans « instructions ».
 */
function stripDecisionDetails(event: ProspectEvent): ProspectEvent {
  return event.type === 'stage_changed' && event.actorType !== 'agent'
    ? { ...event, details: null }
    : event;
}

/** Retire les coordonnées des modifications enregistrées dans l'historique. */
function stripContactChanges(event: ProspectEvent): ProspectEvent {
  if (event.type !== 'prospect_enriched') return event;
  const changes = event.payload.changes as Record<string, unknown> | undefined;
  if (!changes) return event;
  const kept = Object.fromEntries(Object.entries(changes).filter(([f]) => !CONTACT_FIELDS.has(f)));
  const hidden = Object.keys(changes).length - Object.keys(kept).length;
  return {
    ...event,
    // Le détail (liste des champs) peut nommer un contact : réécrit sans les coordonnées.
    details: hidden > 0 ? Object.keys(kept).join(', ') || null : event.details,
    payload: { ...event.payload, changes: kept as never },
  };
}

export function toAgentDossier(dossier: ProspectDossier, permissions: Permissions): AgentDossier {
  const can = (p: AgentPermission) => permissions.has(p);
  const hidden: AgentHiddenSection[] = [];
  const p = dossier.prospect;

  const prospect: AgentProspect = {
    id: p.id,
    reference: p.reference,
    creatorName: p.creatorName,
    channelName: p.channelName,
    stage: p.stage,
    channelHandle: p.channelHandle,
    channelUrl: p.channelUrl,
    avatarUrl: p.avatarUrl,
    category: p.category,
    description: p.description,
    country: p.country,
    subscriberCount: p.subscriberCount,
    viewCount: p.viewCount,
    videoCount: p.videoCount,
    statsSource: p.statsSource,
    statsUpdatedAt: p.statsUpdatedAt,
    discovery: p.discovery,
    priority: p.priority,
    doNotContact: p.doNotContact,
    isDemo: p.isDemo,
    version: p.version,
    discoveredAt: p.discoveredAt,
    lastActivityAt: p.lastActivityAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
  if (can('prospects:read_contact')) {
    prospect.contactEmail = p.contactEmail;
    prospect.contactName = p.contactName;
    prospect.contactSource = p.contactSource;
  } else hidden.push('contact');
  if (can('messages:read')) {
    prospect.relationshipStatus = p.relationshipStatus;
    prospect.nextAction = p.nextAction;
    prospect.nextActionAt = p.nextActionAt;
  }
  if (can('decisions:read')) prospect.doNotContactReason = p.doNotContactReason;

  if (!can('analyses:read')) hidden.push('analyses');
  if (!can('productions:read')) hidden.push('productions');
  if (!can('proposals:read')) hidden.push('proposals');
  if (!can('messages:read')) hidden.push('messages');
  if (!can('decisions:read')) hidden.push('decisions');
  if (!can('notes:read')) hidden.push('notes');

  const instructions: AgentInstruction[] = dossier.decisions
    .filter(
      (d) =>
        (d.kind === 'reanalysis_requested' && can('analyses:read')) ||
        (d.kind === 'email_changes_requested' && can('proposals:read')),
    )
    .map((d) => ({
      kind: d.kind as AgentInstruction['kind'],
      text: d.reason,
      missionId: d.missionId,
      productionId: d.productionId,
      createdAt: d.createdAt,
    }));

  const view: AgentDossier = {
    prospect,
    missions: dossier.missions,
    productions: dossier.productions.filter((x) => can(PRODUCTION_READ_PERMISSION[x.kind])),
    instructions,
    events: dossier.events
      .filter((e) => eventVisible(e, can))
      .map((e) => (can('prospects:read_contact') ? e : stripContactChanges(e)))
      .map((e) => (can('decisions:read') ? e : stripDecisionDetails(e))),
    hidden,
  };
  if (can('analyses:read')) view.analyses = dossier.analyses;
  if (can('decisions:read')) view.decisions = dossier.decisions;
  if (can('messages:read')) {
    view.messages = dossier.messages.map((m) => ({ ...m, untrusted: m.direction === 'inbound' }));
  }
  return view;
}
