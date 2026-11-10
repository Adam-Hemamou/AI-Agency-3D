import { describe, expect, it } from 'vitest';
import { AGENT_ROLE_PERMISSIONS } from './agentPolicy';
import { agentCreateProspectRequestSchema } from './agentApi';
import {
  CAMPAIGN_LIMITS,
  channelLookupQuerySchema,
  checkCampaignTargets,
  channelRejectionsRequestSchema,
  createCampaignRequestSchema,
  updateCampaignRequestSchema,
} from './campaigns';

const base = { name: 'Cuisine francophone', keywords: ['recette facile'] };

describe('campagnes : critères', () => {
  it('valeurs par défaut : désactivée, objectif, activité récente et réévaluation', () => {
    expect(createCampaignRequestSchema.parse(base)).toMatchObject({
      enabled: false,
      themes: [],
      languages: [],
      countries: [],
      minSubscribers: null,
      maxSubscribers: null,
      dailyTarget: CAMPAIGN_LIMITS.dailyTarget.default,
      maxDaysSinceLastVideo: CAMPAIGN_LIMITS.maxDaysSinceLastVideo.default,
      reevaluationDays: CAMPAIGN_LIMITS.reevaluationDays.default,
      priority: 3,
      agentId: null,
    });
  });

  it('accepte des critères complets', () => {
    const parsed = createCampaignRequestSchema.parse({
      ...base,
      themes: ['cuisine', 'pâtisserie'],
      languages: ['fr'],
      countries: ['FR', 'BE', 'CA'],
      minSubscribers: 10_000,
      maxSubscribers: 500_000,
      maxDaysSinceLastVideo: 14,
      dailyTarget: 8,
      agentId: 'agent-prospecteur',
      enabled: true,
    });
    expect(parsed.countries).toEqual(['FR', 'BE', 'CA']);
  });

  it.each([
    ['aucun mot-clé', { keywords: [] }],
    ['langue mal écrite', { languages: ['FR'] }],
    ['pays mal écrit', { countries: ['fr'] }],
    ['mot-clé en double', { keywords: ['a', 'a'] }],
    ['minimum au-dessus du maximum', { minSubscribers: 100, maxSubscribers: 10 }],
    ['objectif quotidien hors bornes', { dailyTarget: 0 }],
    ['réévaluation trop courte', { reevaluationDays: 1 }],
    ['champ inconnu', { budget: 100 }],
    ['agent qui n’est pas un agent', { agentId: 'owner' }],
  ])('refuse : %s', (_label, overrides) => {
    expect(createCampaignRequestSchema.safeParse({ ...base, ...overrides }).success).toBe(false);
  });

  it('modification : version attendue obligatoire, au moins un changement', () => {
    expect(updateCampaignRequestSchema.safeParse({ enabled: true }).success).toBe(false);
    expect(updateCampaignRequestSchema.safeParse({ expectedVersion: 0 }).success).toBe(false);
    expect(updateCampaignRequestSchema.parse({ expectedVersion: 2, enabled: false })).toEqual({
      expectedVersion: 2,
      enabled: false,
    });
  });
});

describe('objectifs quotidiens et quota global (10)', () => {
  const check = (
    otherActiveTargets: number,
    before: { enabled: boolean; dailyTarget: number } | null,
    after: { enabled: boolean; dailyTarget: number },
  ) => checkCampaignTargets({ otherActiveTargets, before, after, globalQuota: 10 });

  it('création : active refusée au-delà du quota, désactivée toujours acceptée', () => {
    expect(check(8, null, { enabled: true, dailyTarget: 2 })).toEqual({ allowed: true });
    expect(check(8, null, { enabled: true, dailyTarget: 3 })).toEqual({
      allowed: false,
      available: 2,
    });
    expect(check(8, null, { enabled: false, dailyTarget: 50 })).toEqual({ allowed: true });
  });

  it('activation : refusée au-delà, acceptée jusqu’au quota exact', () => {
    const off = { enabled: false, dailyTarget: 5 };
    expect(check(5, off, { enabled: true, dailyTarget: 5 })).toEqual({ allowed: true });
    expect(check(6, off, { enabled: true, dailyTarget: 5 })).toEqual({
      allowed: false,
      available: 4,
    });
  });

  it('campagne active : hausse refusée au-delà ; baisse, maintien et désactivation acceptés', () => {
    const on = { enabled: true, dailyTarget: 6 };
    expect(check(4, on, { enabled: true, dailyTarget: 7 })).toEqual({
      allowed: false,
      available: 6,
    });
    expect(check(4, on, { enabled: true, dailyTarget: 6 })).toEqual({ allowed: true });
    // Somme déjà au-delà (quota abaissé) : baisser ou désactiver reste possible.
    expect(check(9, on, { enabled: true, dailyTarget: 5 })).toEqual({ allowed: true });
    expect(check(9, on, { enabled: false, dailyTarget: 6 })).toEqual({ allowed: true });
  });

  it('objectif possible jamais négatif', () => {
    expect(check(12, null, { enabled: true, dailyTarget: 1 })).toEqual({
      allowed: false,
      available: 0,
    });
  });
});

describe('chaînes : vérification et rejets', () => {
  it('vérification : liste « a,b » ou paramètres répétés, 50 au plus, sans doublon', () => {
    expect(
      channelLookupQuerySchema.parse({ missionId: 'm', channelIds: 'UC1, UC2' }).channelIds,
    ).toEqual(['UC1', 'UC2']);
    expect(
      channelLookupQuerySchema.parse({ missionId: 'm', channelIds: ['UC1', 'UC2'] }).channelIds,
    ).toEqual(['UC1', 'UC2']);
    const many = Array.from({ length: 51 }, (_, i) => `UC${i}`).join(',');
    expect(channelLookupQuerySchema.safeParse({ missionId: 'm', channelIds: many }).success).toBe(
      false,
    );
    expect(
      channelLookupQuerySchema.safeParse({ missionId: 'm', channelIds: 'UC1,UC1' }).success,
    ).toBe(false);
    expect(channelLookupQuerySchema.safeParse({ missionId: 'm', channelIds: 'U C1' }).success).toBe(
      false,
    );
  });

  it('rejets : motif codé, précision obligatoire pour « autre », sans doublon', () => {
    const item = { channelId: 'UC1', reasonCode: 'inactive' };
    expect(
      channelRejectionsRequestSchema.parse({ missionId: 'm', items: [item] }).items[0],
    ).toEqual({ channelId: 'UC1', channelTitle: null, reasonCode: 'inactive', reason: null });
    expect(
      channelRejectionsRequestSchema.safeParse({
        missionId: 'm',
        items: [{ channelId: 'UC1', reasonCode: 'other' }],
      }).success,
    ).toBe(false);
    expect(
      channelRejectionsRequestSchema.safeParse({ missionId: 'm', items: [item, item] }).success,
    ).toBe(false);
    expect(
      channelRejectionsRequestSchema.safeParse({
        missionId: 'm',
        items: [{ channelId: 'UC1', reasonCode: 'boring' }],
      }).success,
    ).toBe(false);
  });
});

describe('coordonnées enregistrées par le Prospecteur', () => {
  const prospect = {
    missionId: 'm',
    creatorName: 'Léa',
    channelName: 'Léa',
    youtubeChannelId: 'UC1',
    discovery: {
      source: 'Recherche YouTube',
      reason: 'Campagne',
      qualification: { targetFit: 'Oui', potentialInterest: 'Oui', firstObservation: 'RAS' },
    },
  };

  it('une coordonnée exige l’adresse http(s) de la page publique où elle figure', () => {
    const contact = { contactEmail: 'pro@lea.example' };
    expect(agentCreateProspectRequestSchema.safeParse({ ...prospect, ...contact }).success).toBe(
      false,
    );
    expect(
      agentCreateProspectRequestSchema.safeParse({
        ...prospect,
        ...contact,
        contactSource: 'Page À propos',
      }).success,
    ).toBe(false);
    expect(
      agentCreateProspectRequestSchema.safeParse({
        ...prospect,
        ...contact,
        contactSource: 'https://www.youtube.com/@lea/about',
      }).success,
    ).toBe(true);
    expect(agentCreateProspectRequestSchema.safeParse(prospect).success).toBe(true);
  });

  it('le rôle du prospecteur enregistre des coordonnées sans pouvoir les lire', () => {
    expect(AGENT_ROLE_PERMISSIONS.prospector).toContain('contacts:submit');
    expect(AGENT_ROLE_PERMISSIONS.prospector).toContain('channels:reject');
    expect(AGENT_ROLE_PERMISSIONS.prospector).not.toContain('prospects:read_contact');
  });
});
