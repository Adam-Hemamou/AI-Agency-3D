import { AGENT_ID_PREFIX, ERROR_CODES, HUMAN_ACTOR_ID, isAgentId } from '@agency/shared';
import { AppError } from '../errors/AppError.ts';
import type { Actor } from '../missions/missionService.ts';

/**
 * Identités des auteurs d'actions.
 *
 * Règle centrale : un acteur « humain » est de type "user" ET son identifiant ne peut pas être
 * celui d'un agent. Les identifiants d'agents commencent toujours par "agent-" (vérifié à la
 * création et par la base), l'humain est "owner" : les deux ne peuvent jamais se confondre.
 */

/** L'utilisateur humain, propriétaire de l'agence. */
export const HUMAN_ACTOR: Actor = Object.freeze({ type: 'user', id: HUMAN_ACTOR_ID });

export function agentActor(agentId: string): Actor {
  if (!isAgentId(agentId)) throw new Error(`Identifiant d'agent invalide : ${agentId}`);
  return Object.freeze({ type: 'agent', id: agentId });
}

export function isHumanActor(actor: Actor): boolean {
  return (
    actor.type === 'user' &&
    typeof actor.id === 'string' &&
    actor.id.length > 0 &&
    !actor.id.startsWith(AGENT_ID_PREFIX)
  );
}

export function forbiddenForNonHuman(what: string): AppError {
  return new AppError(ERROR_CODES.FORBIDDEN_ACTOR, `Seul l'utilisateur humain peut ${what}`, 403);
}

/**
 * Garde-fou des actions réservées à l'humain (validations, décisions) :
 * appliqué dans les services, indépendamment des contrôles faits par les routes HTTP.
 */
export function assertHumanActor(actor: Actor, what: string): void {
  if (!isHumanActor(actor)) throw forbiddenForNonHuman(what);
}
