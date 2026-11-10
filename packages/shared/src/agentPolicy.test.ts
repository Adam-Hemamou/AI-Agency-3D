import { describe, expect, it } from 'vitest';
import {
  AGENT_PERMISSIONS,
  AGENT_PERMISSION_LABELS,
  AGENT_PRODUCTION_RULES,
  AGENT_ROLE_PERMISSIONS,
  AGENT_ROLES,
  canAgentMoveToStage,
  checkAgentProduction,
  isAgentMissionAction,
} from './agentPolicy';
import {
  agentEventRequestSchema,
  agentProductionsAt,
  enrichProspectRequestSchema,
  idempotencyKeySchema,
  normalizeChannelHandle,
  parseChannelUrl,
  prospectLookupQuerySchema,
} from './agentApi';
import { MISSION_ACTIONS } from './missionLifecycle';
import { PROSPECT_STAGES, canMoveToStage } from './prospects';
import { createAgentRequestSchema } from './agents';
import {
  createProductionRequestSchema,
  createProspectRequestSchema,
  isSafeHttpUrl,
} from './prospectApi';

const minimalProspect = {
  creatorName: 'C',
  channelName: 'C',
  discovery: {
    source: 'S',
    reason: 'R',
    qualification: { targetFit: 'T', potentialInterest: 'P', firstObservation: 'F' },
  },
};

describe('permissions des agents', () => {
  it('chaque permission a un libellé', () => {
    for (const p of AGENT_PERMISSIONS) expect(AGENT_PERMISSION_LABELS[p]).toBeTruthy();
  });

  it('un nouvel agent n’a aucune permission ; les doublons et inconnues sont refusés', () => {
    expect(createAgentRequestSchema.parse({ id: 'agent-a', name: 'A' }).permissions).toEqual([]);
    const parse = (permissions: unknown) =>
      createAgentRequestSchema.safeParse({ id: 'agent-a', name: 'A', permissions }).success;
    expect(parse(['prospects:read', 'prospects:read'])).toBe(false);
    expect(parse(['emails:send'])).toBe(false);
    expect(parse(['validations:approve'])).toBe(false);
    expect(parse(['prospects:read', 'analyses:write'])).toBe(true);
  });

  it('évaluation linguistique : réservée au rôle prospecteur, accordable explicitement', () => {
    expect(AGENT_PERMISSIONS).toContain('creators:assess');
    expect(AGENT_PERMISSION_LABELS['creators:assess']).toMatch(/sans enregistrement/);
    expect(AGENT_ROLE_PERMISSIONS.prospector).toContain('creators:assess');
    for (const role of AGENT_ROLES.filter((r) => r !== 'prospector')) {
      expect(AGENT_ROLE_PERMISSIONS[role]).not.toContain('creators:assess');
    }
    expect(
      createAgentRequestSchema.safeParse({
        id: 'agent-a',
        name: 'A',
        permissions: ['creators:assess'],
      }).success,
    ).toBe(true);
  });
});

describe('étapes franchissables par un agent', () => {
  it.each([
    ['prospecting', 'analysis'],
    ['analysis', 'review'],
    ['dubbing', 'proposal'],
    ['proposal', 'email_review'],
  ] as const)('%s → %s : autorisé', (from, to) => {
    expect(canAgentMoveToStage(from, to)).toBe(true);
  });

  it.each([
    ['review', 'dubbing'], // valider le prospect
    ['review', 'refused'], // refuser
    ['review', 'analysis'], // demander une nouvelle analyse
    ['email_review', 'followup'], // valider l'e-mail (envoi)
    ['email_review', 'proposal'], // demander une modification
    ['followup', 'converted'],
    ['prospecting', 'archived'],
  ] as const)('%s → %s : décision humaine, refusé', (from, to) => {
    expect(canAgentMoveToStage(from, to)).toBe(false);
  });

  it('n’autorise jamais une transition interdite par le cycle de vie', () => {
    for (const from of PROSPECT_STAGES) {
      for (const to of PROSPECT_STAGES) {
        if (canAgentMoveToStage(from, to)) expect(canMoveToStage(from, to)).toBe(true);
      }
    }
  });
});

describe('productions des agents', () => {
  it('ne donne jamais un statut de décision humaine ou d’envoi', () => {
    for (const rule of Object.values(AGENT_PRODUCTION_RULES)) {
      for (const forbidden of ['approved', 'sent', 'rejected', 'changes_requested', 'superseded']) {
        expect(rule.statuses).not.toContain(forbidden);
      }
    }
  });

  it('vérifie l’étape et le statut', () => {
    expect(checkAgentProduction('dubbing', 'dubbing', 'generated').allowed).toBe(true);
    expect(checkAgentProduction('proposal', 'email', 'pending_review').allowed).toBe(true);
    expect(checkAgentProduction('proposal', 'email', 'approved').allowed).toBe(false);
    expect(checkAgentProduction('email_review', 'email', 'sent').allowed).toBe(false);
    expect(checkAgentProduction('analysis', 'dubbing', 'draft').allowed).toBe(false);
  });

  it('liste les productions possibles à une étape', () => {
    expect(agentProductionsAt('dubbing').map((p) => p.kind)).toEqual(['video_excerpt', 'dubbing']);
    expect(agentProductionsAt('review')).toEqual([]);
  });
});

describe('missions des agents', () => {
  it('annuler et débloquer restent humains', () => {
    const allowed = MISSION_ACTIONS.filter(isAgentMissionAction);
    expect(allowed).not.toContain('cancel');
    expect(allowed).not.toContain('unblock');
    expect(allowed).toContain('submit_for_validation');
  });
});

describe('doublons', () => {
  it('normalise le nom de chaîne', () => {
    expect(normalizeChannelHandle(' @MaChaine ')).toBe('machaine');
    expect(normalizeChannelHandle('machaine')).toBe('machaine');
  });

  it('reconnaît une chaîne dans son adresse', () => {
    expect(parseChannelUrl('https://www.youtube.com/@MaChaine/videos')).toEqual({
      channelHandle: 'machaine',
    });
    expect(parseChannelUrl('https://youtube.com/channel/UC123?x=1')).toEqual({
      youtubeChannelId: 'UC123',
    });
    expect(parseChannelUrl('https://youtube.com/watch?v=abc')).toBeNull();
    expect(parseChannelUrl('pas une adresse')).toBeNull();
  });

  it('exige au moins un critère de recherche', () => {
    expect(prospectLookupQuerySchema.safeParse({}).success).toBe(false);
    expect(prospectLookupQuerySchema.safeParse({ channelHandle: '@x' }).success).toBe(true);
    expect(prospectLookupQuerySchema.safeParse({ stage: 'review' }).success).toBe(false);
  });
});

describe('enrichissement', () => {
  const parse = (body: unknown) => enrichProspectRequestSchema.safeParse(body).success;

  it('refuse les champs réservés à l’humain ou au parcours', () => {
    for (const field of [
      { stage: 'review' },
      { doNotContact: false },
      { relationshipStatus: 'interested' },
      { nextAction: 'Relancer' },
      { isDemo: true },
      { reference: 'P-1' },
    ]) {
      expect(parse(field)).toBe(false);
    }
  });

  it('exige la source des statistiques et du contact', () => {
    expect(parse({ subscriberCount: 1000 })).toBe(false);
    expect(parse({ subscriberCount: 1000, statsSource: 'YouTube Data API' })).toBe(true);
    expect(parse({ contactEmail: 'a@b.example' })).toBe(false);
    expect(parse({ contactEmail: 'a@b.example', contactSource: 'Page À propos' })).toBe(true);
  });

  it('refuse une demande vide', () => {
    expect(parse({})).toBe(false);
    expect(parse({ expectedVersion: 2 })).toBe(false);
  });
});

describe('activité et idempotence', () => {
  it('le type d’événement n’est pas choisi par l’agent', () => {
    expect(
      agentEventRequestSchema.safeParse({ title: 'x', type: 'decision_recorded' }).success,
    ).toBe(false);
  });

  it('limite la taille des données libres', () => {
    const big = { data: 'x'.repeat(11_000) };
    expect(agentEventRequestSchema.safeParse({ title: 'x', payload: big }).success).toBe(false);
  });

  it('valide la clé d’idempotence', () => {
    expect(idempotencyKeySchema.safeParse('n8n:exec-42:node-3').success).toBe(true);
    expect(idempotencyKeySchema.safeParse('court').success).toBe(false);
    expect(idempotencyKeySchema.safeParse('avec espace 123').success).toBe(false);
  });
});

describe('adresses web fournies par les agents', () => {
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:fetch("/api/prospects")',
    'data:text/html,<script>1</script>',
    ' javascript:void(0)',
    'vbscript:x',
    'https://',
    '//evil.example',
    'https://exemple.example/a b',
  ])('refuse %j', (url) => {
    expect(isSafeHttpUrl(url)).toBe(false);
    expect(
      createProspectRequestSchema.safeParse({ ...minimalProspect, channelUrl: url }).success,
    ).toBe(false);
    expect(enrichProspectRequestSchema.safeParse({ avatarUrl: url }).success).toBe(false);
    expect(
      createProductionRequestSchema.safeParse({
        kind: 'email',
        content: { subject: 'S', body: 'B', demoUrl: url },
      }).success,
    ).toBe(false);
  });

  it.each(['https://youtube.com/@chaine', 'http://exemple.example/demo?x=1#y'])(
    'accepte %j',
    (url) => {
      expect(isSafeHttpUrl(url)).toBe(true);
      expect(
        createProspectRequestSchema.safeParse({ ...minimalProspect, channelUrl: url }).success,
      ).toBe(true);
    },
  );
});
