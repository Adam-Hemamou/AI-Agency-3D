import { channelHandleKey, channelUrlKey } from '@agency/shared';

/**
 * Rapport des doublons d'une base existante, calculé avec les mêmes règles que le CRM.
 * Ne fait que lire : sert à vérifier une base AVANT d'y appliquer la migration du lot B.
 */

export interface ProspectIdentityRow {
  id: string;
  reference: string;
  channelHandle: string | null;
  channelUrl: string | null;
  youtubeChannelId: string | null;
  createdAt: Date;
}

export interface DuplicateGroup {
  /** Critère commun : nom de chaîne ou adresse normalisés. */
  field: 'channelHandle' | 'channelUrl';
  key: string;
  /** Références, du plus ancien au plus récent (le plus ancien garde la clé après migration). */
  references: string[];
}

export function duplicateReport(rows: readonly ProspectIdentityRow[]): DuplicateGroup[] {
  const sorted = [...rows].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const groups: DuplicateGroup[] = [];
  for (const field of ['channelHandle', 'channelUrl'] as const) {
    const byKey = new Map<string, string[]>();
    for (const row of sorted) {
      const key =
        field === 'channelHandle'
          ? channelHandleKey(row.channelHandle, row.channelUrl)
          : channelUrlKey(row.channelUrl);
      if (key) byKey.set(key, [...(byKey.get(key) ?? []), row.reference]);
    }
    for (const [key, references] of byKey) {
      if (references.length > 1) groups.push({ field, key, references });
    }
  }
  return groups;
}
