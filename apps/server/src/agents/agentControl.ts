import type { RequestHandler } from 'express';
import { ERROR_CODES, type AgentsSwitchStatus } from '@agency/shared';
import type { AppPrismaClient } from '../db/prisma.ts';
import { AppError } from '../errors/AppError.ts';
import { systemClock, type Clock } from '../missions/missionService.ts';

/**
 * Arrêt d'urgence des agents. Deux commandes, cumulées :
 * - AGENTS_ENABLED=false dans .env (au démarrage) : arrêt que l'interface ne peut pas lever ;
 * - l'interrupteur de l'interface (utilisateur uniquement) : effet immédiat, conservé en base,
 *   donc toujours actif après un redémarrage.
 * Les agents agissent seulement si les deux l'autorisent.
 *
 * Vérifié à l'arrivée de chaque requête portant une clé d'agent (avant même de lire la clé en
 * base), puis de nouveau dans la transaction de chaque écriture : une requête déjà en cours au
 * moment de l'arrêt ne peut plus rien écrire. L'utilisateur n'est jamais concerné.
 */

const SWITCH_ID = 'global';

export function agentsDisabledError(): AppError {
  return new AppError(
    ERROR_CODES.AGENTS_DISABLED,
    'Arrêt d’urgence : les agents sont désactivés par l’utilisateur',
    503,
  );
}

export function createAgentControl({
  prisma,
  envEnabled = true,
  clock = systemClock,
}: {
  prisma?: AppPrismaClient;
  envEnabled?: boolean;
  clock?: Clock;
}) {
  let switchEnabled = true;
  let updatedAt: Date | null = null;

  const control = {
    /** Charge l'état de l'interrupteur enregistré (à appeler au démarrage). */
    async load(): Promise<void> {
      if (!prisma) return;
      const row = await prisma.agentSwitch.findUnique({ where: { id: SWITCH_ID } });
      switchEnabled = row?.enabled ?? true;
      updatedAt = row?.updatedAt ?? null;
    },

    isEnabled(): boolean {
      return envEnabled && switchEnabled;
    },

    /** Lève AGENTS_DISABLED (503) si les agents sont arrêtés. */
    assertEnabled(): void {
      if (!control.isEnabled()) throw agentsDisabledError();
    },

    status(): AgentsSwitchStatus {
      return {
        enabled: control.isEnabled(),
        envEnabled,
        switchEnabled,
        updatedAt: updatedAt?.toISOString() ?? null,
      };
    },

    /**
     * Interrupteur de l'utilisateur. L'état en mémoire change AVANT l'écriture en base :
     * l'arrêt prend effet immédiatement, même si l'enregistrement est lent.
     */
    async setEnabled(enabled: boolean): Promise<AgentsSwitchStatus> {
      const previous = switchEnabled;
      if (!enabled) switchEnabled = false;
      const now = clock();
      try {
        if (prisma) {
          await prisma.agentSwitch.upsert({
            where: { id: SWITCH_ID },
            create: { id: SWITCH_ID, enabled, updatedAt: now },
            update: { enabled, updatedAt: now },
          });
        }
      } catch (error) {
        // Réactivation non enregistrée : on reste arrêté. Arrêt non enregistré : on reste arrêté
        // (l'arrêt en mémoire est conservé ; l'erreur est remontée).
        if (enabled) switchEnabled = previous;
        throw error;
      }
      switchEnabled = enabled;
      updatedAt = now;
      return control.status();
    },
  };
  return control;
}

export type AgentControl = ReturnType<typeof createAgentControl>;

/**
 * Bloque toute requête qui se présente comme un agent (clé dans Authorization, ou clé mal
 * placée) tant que l'arrêt d'urgence est actif — avant même de vérifier la clé.
 * Placé avant identifyRequest : aucune lecture ni écriture en base pour une requête d'agent.
 */
export function agentKillSwitch(control: AgentControl): RequestHandler {
  return (req, _res, next) => {
    const looksLikeAgent =
      req.headers.authorization !== undefined ||
      req.headers['x-api-key'] !== undefined ||
      req.headers['x-agent-key'] !== undefined ||
      req.headers['api-key'] !== undefined;
    if (looksLikeAgent && !control.isEnabled()) throw agentsDisabledError();
    next();
  };
}
