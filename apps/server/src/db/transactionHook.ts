import type { Db } from '../missions/missionService.ts';

/** Ressource créée ou modifiée par une commande : ce qu'une répétition de la requête renverra. */
export interface WriteResource {
  type: 'prospect' | 'mission';
  id: string;
  /** Pour une mission : l'événement d'historique produit par la commande. */
  eventId?: number | null;
}

/**
 * Instructions ajoutées à la transaction d'une commande par l'appelant (idempotence des agents).
 * Les services les exécutent DANS leur transaction : elles sont validées ou annulées avec
 * l'écriture métier, jamais l'une sans l'autre.
 */
export interface TransactionHook {
  /** Première instruction de la transaction (avant toute lecture). */
  begin(tx: Db): Promise<void>;
  /** Dernière instruction, avec la ressource concernée. */
  end(tx: Db, resource: WriteResource): Promise<void>;
}
