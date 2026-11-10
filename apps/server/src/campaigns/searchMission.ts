import { ERROR_CODES, PIPELINE_MISSION_TYPES } from '@agency/shared';
import { AppError } from '../errors/AppError.ts';
import type { Actor, Db } from '../missions/missionService.ts';

/** Mission de recherche vérifiée et verrouillée, avec sa campagne éventuelle. */
export interface LockedSearchMission {
  id: string;
  campaign: {
    id: string;
    name: string;
    enabled: boolean;
    dailyTarget: number;
    reevaluationDays: number;
  } | null;
}

function forbidden(message: string): AppError {
  return new AppError(ERROR_CODES.FORBIDDEN_ACTOR, message, 403);
}

/**
 * Mission de recherche dans laquelle un agent écrit (prospect créé, chaîne écartée). Elle doit être :
 * de type search_creators, en salle de prospection, attribuée à CET agent, en cours, avec une
 * exécution active (l'agent y travaille réellement : prise par POST /api/agent/runs/claim).
 *
 * Ligne VERROUILLÉE en écriture (FOR UPDATE) jusqu'à la fin de la transaction : la mission ne peut
 * pas être terminée, bloquée ou reprise par la récupération entre la vérification et l'écriture, et
 * deux créations simultanées dans la même mission comptent l'une après l'autre (objectif quotidien).
 * Campagne désactivée : plus aucune écriture (CAMPAIGN_DISABLED).
 */
export async function lockSearchMissionIn(
  tx: Db,
  missionId: string,
  actor: Actor,
): Promise<LockedSearchMission> {
  const [mission] = await tx.$queryRaw<
    {
      type: string;
      agent_id: string | null;
      room: string;
      status: string;
      campaign_id: string | null;
    }[]
  >`SELECT type, agent_id, room, status, campaign_id FROM missions WHERE id = ${missionId} FOR UPDATE`;
  if (!mission) throw AppError.validation(`Mission de recherche introuvable : ${missionId}`);
  if (mission.type !== PIPELINE_MISSION_TYPES.search || mission.room !== 'prospecting') {
    throw AppError.validation(
      `Seule une mission de recherche de la salle de prospection convient (type « ${PIPELINE_MISSION_TYPES.search} »)`,
    );
  }
  if (actor.type !== 'agent' || mission.agent_id === null || mission.agent_id !== actor.id) {
    throw forbidden(
      mission.agent_id === null
        ? 'Cette mission de recherche n’est attribuée à aucun agent : prenez-la d’abord (POST /api/agent/runs/claim)'
        : `Cette mission de recherche est attribuée à un autre agent (${mission.agent_id})`,
    );
  }
  if (mission.status !== 'in_progress') {
    throw new AppError(
      ERROR_CODES.INVALID_TRANSITION,
      `Seule une mission de recherche en cours convient (statut actuel : « ${mission.status} »)`,
      409,
      { currentStatus: mission.status },
    );
  }
  const run = await tx.agentRun.findFirst({
    where: { missionId, agentId: mission.agent_id, status: 'started' },
    select: { id: true },
  });
  if (!run) {
    throw new AppError(
      ERROR_CODES.INVALID_TRANSITION,
      'Aucune exécution active sur cette mission de recherche : prenez-la par POST /api/agent/runs/claim',
      409,
    );
  }

  if (mission.campaign_id === null) return { id: missionId, campaign: null };
  const campaign = await tx.prospectingCampaign.findUniqueOrThrow({
    where: { id: mission.campaign_id },
    select: { id: true, name: true, enabled: true, dailyTarget: true, reevaluationDays: true },
  });
  if (!campaign.enabled) {
    throw new AppError(
      ERROR_CODES.CAMPAIGN_DISABLED,
      `La campagne « ${campaign.name} » a été désactivée : terminez la mission de recherche`,
      409,
    );
  }
  return { id: missionId, campaign };
}

/**
 * Objectif quotidien : refuse un nouveau prospect si la mission en a déjà créé autant que l'objectif
 * de sa campagne (valeur ACTUELLE). À appeler après lockSearchMissionIn (ligne verrouillée).
 */
export async function assertCampaignTargetIn(tx: Db, mission: LockedSearchMission) {
  if (!mission.campaign) return;
  const created = await tx.prospect.count({ where: { discoveryMissionId: mission.id } });
  if (created >= mission.campaign.dailyTarget) {
    throw new AppError(
      ERROR_CODES.CAMPAIGN_TARGET_REACHED,
      `Objectif quotidien atteint pour « ${mission.campaign.name} » (${mission.campaign.dailyTarget} prospects) : terminez la mission`,
      409,
      { dailyTarget: mission.campaign.dailyTarget, created },
    );
  }
}
