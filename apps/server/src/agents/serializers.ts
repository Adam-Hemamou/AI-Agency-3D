import {
  AGENT_PERMISSIONS,
  isAgentPermission,
  type Agent,
  type AgentApiKey,
  type AgentPermission,
  type AgentStatus,
  type RoomId,
} from '@agency/shared';
import type {
  Agent as AgentRow,
  AgentApiKey as AgentApiKeyRow,
  AgentPermission as AgentPermissionRow,
} from '../generated/prisma/client.ts';

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** Jamais l'empreinte : seule la partie publique de la clé quitte le serveur. */
export function toAgentKeyDto(row: AgentApiKeyRow): AgentApiKey {
  return {
    id: row.id,
    agentId: row.agentId,
    prefix: row.prefix,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    expiresAt: iso(row.expiresAt),
    lastUsedAt: iso(row.lastUsedAt),
    revokedAt: iso(row.revokedAt),
  };
}

/** Permissions connues, dans l'ordre de AGENT_PERMISSIONS (une valeur inconnue en base est ignorée). */
export function toPermissionList(
  rows: Pick<AgentPermissionRow, 'permission'>[],
): AgentPermission[] {
  const granted = new Set(rows.map((r) => r.permission).filter(isAgentPermission));
  return AGENT_PERMISSIONS.filter((p) => granted.has(p));
}

export type AgentRowWithRelations = AgentRow & {
  apiKeys: AgentApiKeyRow[];
  permissions: AgentPermissionRow[];
};

export function toAgentDto(row: AgentRowWithRelations): Agent {
  return {
    ...toAgentIdentityDto(row),
    keys: row.apiKeys.map(toAgentKeyDto),
  };
}

export function toAgentIdentityDto(
  row: AgentRow & { permissions: Pick<AgentPermissionRow, 'permission'>[] },
): Omit<Agent, 'keys'> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    room: row.room as RoomId | null,
    status: row.status as AgentStatus,
    permissions: toPermissionList(row.permissions),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
