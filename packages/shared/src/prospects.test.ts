import { describe, expect, it } from 'vitest';
import { computeAnalysisScore } from './prospectApi';
import {
  PROSPECT_STAGES,
  PROSPECT_STAGE_ROOMS,
  ROOM_DEFAULT_SECTION,
  canMoveToStage,
  canSendFollowup,
  missionTypeLabel,
} from './prospects';
import { ROOM_IDS } from './rooms';

describe('parcours du prospect', () => {
  it('suit l’ordre des salles et autorise la nouvelle analyse depuis Mon bureau', () => {
    expect(canMoveToStage('prospecting', 'analysis')).toBe(true);
    expect(canMoveToStage('review', 'dubbing')).toBe(true);
    expect(canMoveToStage('review', 'analysis')).toBe(true);
    expect(canMoveToStage('prospecting', 'followup')).toBe(false);
  });

  it('ne fait plus évoluer un dossier converti, refusé ou archivé', () => {
    for (const stage of ['converted', 'refused', 'archived'] as const) {
      for (const to of PROSPECT_STAGES) expect(canMoveToStage(stage, to)).toBe(false);
    }
  });

  it('associe chaque salle à une section du dossier et chaque étape à une salle connue', () => {
    expect(Object.keys(ROOM_DEFAULT_SECTION).sort()).toEqual([...ROOM_IDS].sort());
    for (const room of Object.values(PROSPECT_STAGE_ROOMS)) {
      if (room !== null) expect(ROOM_IDS).toContain(room);
    }
  });
});

describe('relances', () => {
  const base = {
    doNotContact: false,
    relationshipStatus: 'awaiting_reply' as const,
    stage: 'followup' as const,
  };

  it('sont permises en suivi actif', () => {
    expect(canSendFollowup(base)).toEqual({ allowed: true });
  });

  it('sont toujours refusées si le prospect ne veut plus être contacté', () => {
    expect(canSendFollowup({ ...base, doNotContact: true }).allowed).toBe(false);
  });

  it('sont refusées pour un prospect non intéressé, converti ou avant tout envoi', () => {
    expect(canSendFollowup({ ...base, relationshipStatus: 'not_interested' }).allowed).toBe(false);
    expect(canSendFollowup({ ...base, relationshipStatus: 'converted' }).allowed).toBe(false);
    expect(canSendFollowup({ ...base, stage: 'email_review' }).allowed).toBe(false);
  });
});

describe('score d’analyse', () => {
  it('est une moyenne pondérée sur 100', () => {
    expect(
      computeAnalysisScore([
        { label: 'A', weight: 30, value: 9, justification: 'x' },
        { label: 'B', weight: 70, value: 5, justification: 'y' },
      ]),
    ).toBe(62);
  });

  it('n’existe pas sans critères identifiables', () => {
    expect(computeAnalysisScore([])).toBeNull();
  });
});

it('affiche un libellé lisible pour les types de missions connus', () => {
  expect(missionTypeLabel('review_prospect')).toBe('Validation du prospect');
  expect(missionTypeLabel('type_inconnu')).toBe('type_inconnu');
});
