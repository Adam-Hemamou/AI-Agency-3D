import {
  PIPELINE_MISSION_TYPES,
  type CreateAnalysisRequest,
  type CreateProductionRequest,
  type EmailContent,
  type ProspectDossier,
  type RoomId,
} from '@agency/shared';
import type { AppPrismaClient } from '../db/prisma.ts';
import { createMissionService, type Actor } from '../missions/missionService.ts';
import { createProspectService } from '../prospects/prospectService.ts';
import { PROFILES, observation, type DemoProfile } from './profiles.ts';

/**
 * Scénario de démonstration : chaque prospect fictif parcourt les salles en passant
 * par les VRAIS services (moteur de missions, service des prospects). Les historiques,
 * statuts et dates sont donc cohérents avec les règles métier.
 * Aucun appel externe : tout est simulé.
 */

const DAY = 24 * 60 * 60 * 1000;

const AGENTS = {
  prospector: { type: 'agent', id: 'agent-prospecteur' },
  analyst: { type: 'agent', id: 'agent-analyste' },
  dubbing: { type: 'agent', id: 'agent-doublage' },
  sales: { type: 'agent', id: 'agent-commercial' },
  writer: { type: 'agent', id: 'agent-redacteur' },
} satisfies Record<string, Actor>;
const OWNER: Actor = { type: 'user', id: 'owner' };
const SYSTEM: Actor = { type: 'system', id: null };

/** Horloge pilotée par le scénario (dates passées, jamais dans le futur). */
function createScenarioClock(origin: number) {
  let current = origin;
  return {
    now: () => new Date(current),
    /** Se place N jours avant aujourd'hui, à l'heure donnée. */
    at(daysAgo: number, hour = 9, minute = 0) {
      const d = new Date(origin - daysAgo * DAY);
      d.setHours(hour, minute, 0, 0);
      current = Math.min(d.getTime(), origin - 60_000);
    },
    /** Avance de quelques minutes (chaque étape a sa propre date). */
    later(minutes = 7) {
      current = Math.min(current + minutes * 60_000, origin - 30_000);
    },
  };
}

export async function seedDemo(prisma: AppPrismaClient) {
  const origin = Date.now();
  const clock = createScenarioClock(origin);
  const missions = createMissionService(prisma, { clock: clock.now });
  const prospects = createProspectService({
    prisma,
    missions,
    simulationMode: true,
    clock: clock.now,
  });

  const dateBefore = (daysAgo: number) => new Date(origin - daysAgo * DAY).toISOString();

  // ---------------------------------------------------------------------------
  // Briques du parcours
  // ---------------------------------------------------------------------------

  function openMission(dossier: ProspectDossier, room: RoomId) {
    const mission = [...dossier.missions]
      .reverse()
      .find((m) => m.room === room && !['completed', 'cancelled'].includes(m.status));
    if (!mission)
      throw new Error(`Aucune mission ouverte en ${room} pour ${dossier.prospect.reference}`);
    return mission;
  }

  async function run(missionId: string, actor: Actor, output?: Record<string, string | number>) {
    await missions.applyAction(missionId, { action: 'start' }, actor);
    clock.later(35);
    await missions.applyAction(missionId, { action: 'complete', output }, actor);
  }

  async function discover(p: DemoProfile, daysAgo: number, done = true) {
    clock.at(daysAgo, 9, 12);
    let dossier = await prospects.createProspect(
      {
        creatorName: p.creatorName,
        channelName: p.channelName,
        channelHandle: `@${p.handle}`,
        youtubeChannelId: `DEMO-${p.key.toUpperCase()}`,
        channelUrl: `https://youtube.example/@${p.handle}`,
        avatarUrl: null,
        category: p.category,
        description: p.description,
        country: p.country,
        subscriberCount: p.subscribers,
        viewCount: p.views,
        videoCount: p.videos,
        statsSource: 'Statistiques fictives (démonstration)',
        statsUpdatedAt: dateBefore(daysAgo),
        contactEmail: p.contactEmail,
        contactName: p.contactName,
        contactSource: 'Page « À propos » de la chaîne (fictive)',
        discovery: {
          source: 'Recherche par mots-clés (simulation)',
          reason: p.discoveryReason,
          keywords: p.keywords,
          criteria: [
            'Chaîne francophone',
            'Plus de 50 000 abonnés',
            'Au moins une vidéo par mois',
            'Contenu adaptable par doublage',
          ],
          discoveredBy: AGENTS.prospector.id,
          qualification: {
            targetFit: `Correspond à la cible : créateur ${p.category.toLowerCase()} francophone, format adaptable.`,
            potentialInterest: `Intérêt potentiel pour ${p.targetLanguages.join(', ')}.`,
            firstObservation: p.firstObservation,
            missingInfo: p.missingInfo,
            transferReason: done
              ? 'Critères de base remplis : analyse approfondie nécessaire.'
              : null,
          },
        },
        priority: p.priority,
        isDemo: true,
      },
      AGENTS.prospector,
      { discoveryMission: { agentId: AGENTS.prospector.id, input: { keywords: p.keywords } } },
    );
    const mission = openMission(dossier, 'prospecting');
    clock.later(20);
    if (!done) {
      await missions.applyAction(mission.id, { action: 'start' }, AGENTS.prospector);
      return prospects.getDossier(dossier.prospect.id);
    }
    await run(mission.id, AGENTS.prospector, { result: 'Prospect qualifié' });
    clock.later(10);
    dossier = await prospects.moveToStage(dossier.prospect.id, 'analysis', AGENTS.prospector, {
      details: 'Qualification initiale validée par l’agent de prospection.',
      mission: {
        type: PIPELINE_MISSION_TYPES.analyze,
        room: 'analysis',
        agentId: AGENTS.analyst.id,
      },
    });
    return dossier;
  }

  function analysisFor(p: DemoProfile, missionId: string, daysAgo: number): CreateAnalysisRequest {
    const [international, dubbing, regularity, engagement, offer] = p.scores;
    return {
      missionId,
      summary: p.summary,
      conclusion: p.conclusion,
      priority: p.priority,
      scoreCriteria: [
        {
          label: 'Potentiel international',
          weight: 30,
          value: international,
          justification: 'Thématique, langue des commentaires et adaptabilité du sujet.',
        },
        {
          label: 'Adaptabilité au doublage',
          weight: 25,
          value: dubbing,
          justification: 'Voix off ou face caméra, texte incrusté, musique.',
        },
        {
          label: 'Régularité de publication',
          weight: 15,
          value: regularity,
          justification: `Rythme observé : ${p.frequency}.`,
        },
        {
          label: 'Engagement de l’audience',
          weight: 15,
          value: engagement,
          justification: 'Rapport commentaires / vues sur l’échantillon.',
        },
        {
          label: 'Adéquation avec notre offre',
          weight: 15,
          value: offer,
          justification: 'Besoins probables du créateur et format des vidéos.',
        },
      ],
      content: {
        international: {
          mainLanguage: 'Français',
          otherLanguages: p.otherLanguages,
          signals: p.signals,
          markets: p.markets,
          adaptableContent: p.adaptable,
        },
        activity: {
          publishingFrequency: p.frequency,
          recentVideos: p.recentVideos.map((v) => ({
            title: v.title,
            url: null,
            publishedAt: dateBefore(daysAgo + v.daysBefore),
            views: v.views,
            durationSeconds: v.durationSeconds,
            contentType: v.contentType,
          })),
          contentTypes: p.contentTypes,
          trend: p.trend,
        },
        commercial: {
          potential: p.conclusion,
          dubbingInterest: `Langues recommandées : ${p.targetLanguages.join(', ')}.`,
          offerFit: p.summary,
          strengths: p.strengths,
          weaknesses: p.weaknesses,
          opportunities: p.opportunities,
          risks: p.risks,
          recommendations: p.recommendations,
        },
        uncertainties: p.uncertainties,
      },
      sources: [
        { label: 'Statistiques publiques de la chaîne (fictives — démonstration)', url: null },
        { label: `Échantillon des ${p.recentVideos.length} dernières vidéos (fictif)`, url: null },
        { label: 'Commentaires publics, échantillon de 200 (fictif)', url: null },
      ],
    };
  }

  async function analyze(dossier: ProspectDossier, p: DemoProfile, daysAgo: number) {
    clock.at(daysAgo, 10, 5);
    const mission = openMission(dossier, 'analysis');
    await missions.applyAction(mission.id, { action: 'start' }, AGENTS.analyst);
    clock.later(50);
    const analysed = await prospects.addAnalysis(
      dossier.prospect.id,
      analysisFor(p, mission.id, daysAgo),
      AGENTS.analyst,
    );
    clock.later(3);
    const version = analysed.analyses[0]?.version ?? 1;
    await missions.applyAction(
      mission.id,
      { action: 'complete', output: { analysisVersion: version } },
      AGENTS.analyst,
    );
    return analysed;
  }

  /** Transmet à Mon bureau : la mission de revue attend la décision humaine. */
  async function toReview(dossier: ProspectDossier, daysAgo: number) {
    clock.at(daysAgo, 11, 30);
    const reviewed = await prospects.moveToStage(dossier.prospect.id, 'review', AGENTS.analyst, {
      details: 'Analyse terminée : décision humaine requise.',
      mission: { type: PIPELINE_MISSION_TYPES.review, room: 'director', requiresValidation: true },
    });
    const mission = openMission(reviewed, 'director');
    clock.later(2);
    await missions.applyAction(mission.id, { action: 'start' }, SYSTEM);
    clock.later(1);
    await missions.applyAction(
      mission.id,
      {
        action: 'submit_for_validation',
        output: {
          analysisVersion: reviewed.analyses[0]?.version ?? 1,
          score: reviewed.analyses[0]?.score ?? 0,
        },
      },
      SYSTEM,
    );
    return prospects.getDossier(dossier.prospect.id);
  }

  async function approve(dossier: ProspectDossier, daysAgo: number, reason?: string) {
    clock.at(daysAgo, 14, 20);
    const mission = openMission(dossier, 'director');
    return prospects.decideProspect(
      dossier.prospect.id,
      { missionId: mission.id, decision: 'approve', reason },
      OWNER,
    );
  }

  async function dub(
    dossier: ProspectDossier,
    p: DemoProfile,
    daysAgo: number,
    options: { finish: boolean; failedFirst?: boolean },
  ) {
    clock.at(daysAgo, 9, 40);
    const mission = openMission(dossier, 'dubbing');
    const id = dossier.prospect.id;
    const video = p.recentVideos.find((v) => v.title === p.excerpt.title) ?? p.recentVideos[0];
    await missions.applyAction(mission.id, { action: 'start' }, AGENTS.dubbing);
    clock.later(25);
    await prospects.addProduction(
      id,
      {
        kind: 'video_excerpt',
        missionId: mission.id,
        status: 'approved',
        title: `Extrait : ${p.excerpt.title}`,
        content: {
          videoUrl: `https://youtube.example/watch?v=demo-${p.key}`,
          title: p.excerpt.title,
          publishedAt: dateBefore(daysAgo + (video?.daysBefore ?? 10)),
          durationSeconds: video?.durationSeconds ?? null,
          excerptStart: p.excerpt.start,
          excerptEnd: p.excerpt.end,
          reason: p.excerpt.reason,
          rightsNote:
            'Démonstration privée uniquement : diffusion soumise à l’accord écrit du créateur.',
        },
      },
      AGENTS.dubbing,
    );
    clock.later(40);
    const target = p.targetLanguages[0] ?? 'Anglais';
    const attempts = [] as {
      at: string;
      status: 'simulated' | 'failed' | 'generated';
      note: string | null;
    }[];
    if (options.failedFirst) {
      attempts.push({
        at: clock.now().toISOString(),
        status: 'failed',
        note: 'Simulation : bruit de fond trop présent, extrait à nettoyer.',
      });
      clock.later(90);
    }
    if (options.finish) {
      attempts.push({
        at: clock.now().toISOString(),
        status: 'simulated',
        note: 'Génération simulée : aucun appel à HeyGen.',
      });
    }
    await prospects.addProduction(
      id,
      {
        kind: 'dubbing',
        missionId: mission.id,
        status: options.finish ? 'generated' : 'draft',
        title: `Doublage ${target}`,
        content: {
          sourceLanguage: 'Français',
          targetLanguage: target,
          voice: 'Clone de voix du créateur (sous réserve d’autorisation)',
          tool: 'HeyGen (simulation)',
          settings: {
            'Synchronisation labiale': 'Activée',
            'Sous-titres': 'Oui',
            Qualité: '1080p',
          },
          generationStatus: options.finish
            ? 'simulated'
            : options.failedFirst
              ? 'failed'
              : 'not_started',
          generatedAt: options.finish ? clock.now().toISOString() : null,
          resultUrl: null,
          notes: options.finish
            ? 'Résultat simulé : aucun fichier réel n’a été produit.'
            : 'En attente d’autorisation avant toute génération réelle (API payante).',
          attempts,
        },
      },
      AGENTS.dubbing,
    );
    if (!options.finish) return prospects.getDossier(id);
    clock.later(15);
    await missions.applyAction(
      mission.id,
      { action: 'complete', output: { result: 'Démonstration simulée prête' } },
      AGENTS.dubbing,
    );
    clock.later(5);
    return prospects.moveToStage(id, 'proposal', AGENTS.dubbing, {
      mission: {
        type: PIPELINE_MISSION_TYPES.proposal,
        room: 'copywriting',
        agentId: AGENTS.sales.id,
      },
    });
  }

  function proposalContent(
    p: DemoProfile,
    variant: 1 | 2,
  ): Extract<CreateProductionRequest, { kind: 'proposal' }>['content'] {
    const languages = variant === 1 ? p.targetLanguages.slice(0, 1) : p.targetLanguages;
    return {
      profileSummary: `${p.creatorName} — ${p.channelName} : ${p.description}`,
      needs: p.needs,
      arguments: [
        `Votre format (${p.contentTypes[0]?.toLowerCase() ?? 'vidéos'}) se prête particulièrement bien au doublage.`,
        'Vous gardez votre voix grâce au clonage vocal, avec synchronisation labiale.',
        'Aucun tournage supplémentaire : nous partons de vos vidéos existantes.',
      ],
      benefits: [
        'Nouvelle audience sans changer votre façon de travailler.',
        'Revenus publicitaires supplémentaires sur des marchés à fort volume.',
        variant === 2 ? 'Tarif dégressif à partir de 10 vidéos.' : 'Pilote sans engagement.',
      ],
      languages,
      valueProposition: `Faire découvrir ${p.channelName} à un public ${languages.join(' et ').toLowerCase()} avec votre propre voix.`,
      recommendations: p.recommendations,
      serviceType:
        variant === 1
          ? 'Pilote : 3 vidéos doublées'
          : 'Pack catalogue : 10 vidéos doublées + suivi',
      offerDescription:
        variant === 1
          ? `Doublage de 3 vidéos en ${languages.join(', ')}, avec synchronisation labiale et sous-titres.`
          : `Doublage de 10 vidéos en ${languages.join(', ')}, publication accompagnée et bilan d’audience à 60 jours.`,
      demoUrl: `https://demo.agence.example/${p.key}`,
    };
  }

  function emailContent(p: DemoProfile, variant: 1 | 2): EmailContent {
    const first = p.creatorName.split(' ')[0];
    const lang = p.targetLanguages[0] ?? 'anglais';
    return {
      to: p.contactEmail,
      recipientName: p.contactName,
      subject:
        variant === 1
          ? `${p.channelName} en ${lang.toLowerCase()} ?`
          : `Une démo de ${p.channelName} en ${lang.toLowerCase()}, avec votre voix`,
      body:
        variant === 1
          ? `Bonjour ${first},\n\nJe suis tombé sur ${p.channelName} et j’ai beaucoup aimé « ${p.excerpt.title || p.recentVideos[0]?.title} ».\n\nNous aidons les créateurs à doubler leurs vidéos dans d’autres langues. Seriez-vous intéressé(e) ?\n\nBien à vous,\nL’équipe AI Agency`
          : `Bonjour ${first},\n\nJ’ai préparé un court extrait de « ${p.excerpt.title || p.recentVideos[0]?.title} » doublé en ${lang.toLowerCase()}, avec votre propre voix et une synchronisation labiale :\nhttps://demo.agence.example/${p.key}\n\n${p.channelName} a selon nous un vrai potentiel auprès d’un public ${lang.toLowerCase()} : ${p.summary.charAt(0).toLowerCase()}${p.summary.slice(1)}\n\nNous proposons un pilote de 3 vidéos, sans engagement. Seriez-vous disponible 20 minutes la semaine prochaine pour en parler ?\n\nBien à vous,\nL’équipe AI Agency`,
      demoUrl: `https://demo.agence.example/${p.key}`,
    };
  }

  async function writeProposal(
    dossier: ProspectDossier,
    p: DemoProfile,
    daysAgo: number,
    options: { versions: 1 | 2; finish: boolean },
  ) {
    clock.at(daysAgo, 10, 15);
    const id = dossier.prospect.id;
    const mission = openMission(dossier, 'copywriting');
    await missions.applyAction(mission.id, { action: 'start' }, AGENTS.sales);
    clock.later(45);
    await prospects.addProduction(
      id,
      {
        kind: 'proposal',
        missionId: mission.id,
        status: options.versions === 2 ? 'superseded' : options.finish ? 'approved' : 'draft',
        title: 'Proposition : pilote',
        content: proposalContent(p, 1),
      },
      AGENTS.sales,
    );
    if (options.versions === 2) {
      clock.later(180);
      await prospects.addProduction(
        id,
        {
          kind: 'proposal',
          missionId: mission.id,
          status: options.finish ? 'approved' : 'draft',
          title: 'Proposition : pack catalogue',
          content: proposalContent(p, 2),
        },
        AGENTS.sales,
      );
    }
    if (!options.finish) return prospects.getDossier(id);
    clock.later(20);
    await missions.applyAction(
      mission.id,
      { action: 'complete', output: { result: 'Proposition prête' } },
      AGENTS.sales,
    );
    clock.later(5);
    return prospects.moveToStage(id, 'email_review', AGENTS.sales, {
      mission: {
        type: PIPELINE_MISSION_TYPES.emailReview,
        room: 'email_review',
        requiresValidation: true,
        agentId: AGENTS.writer.id,
      },
    });
  }

  /** Rédige l'e-mail et le soumet à validation humaine. */
  async function draftEmail(
    dossier: ProspectDossier,
    p: DemoProfile,
    daysAgo: number,
    variant: 1 | 2 = 2,
  ) {
    clock.at(daysAgo, 15, 0);
    const id = dossier.prospect.id;
    const mission = openMission(dossier, 'email_review');
    await missions.applyAction(mission.id, { action: 'start' }, AGENTS.writer);
    clock.later(30);
    const drafted = await prospects.addProduction(
      id,
      {
        kind: 'email',
        missionId: mission.id,
        status: 'pending_review',
        title: emailContent(p, variant).subject,
        content: emailContent(p, variant),
      },
      AGENTS.writer,
    );
    clock.later(2);
    const email = drafted.productions.find((x) => x.kind === 'email');
    await missions.applyAction(
      mission.id,
      { action: 'submit_for_validation', output: { productionId: email?.id ?? '' } },
      AGENTS.writer,
    );
    return prospects.getDossier(id);
  }

  function latestEmail(dossier: ProspectDossier) {
    const email = dossier.productions.find((x) => x.kind === 'email');
    if (!email) throw new Error('E-mail introuvable');
    return email;
  }

  async function approveEmail(dossier: ProspectDossier, daysAgo: number) {
    clock.at(daysAgo, 17, 10);
    const mission = openMission(dossier, 'email_review');
    return prospects.decideEmail(
      dossier.prospect.id,
      { missionId: mission.id, productionId: latestEmail(dossier).id, decision: 'approve' },
      OWNER,
    );
  }

  async function send(dossier: ProspectDossier, daysAgo: number) {
    clock.at(daysAgo, 9, 5);
    return prospects.simulateSend(
      dossier.prospect.id,
      { productionId: latestEmail(dossier).id },
      OWNER,
    );
  }

  /** Parcours complet jusqu'à l'envoi (simulé) du premier e-mail. */
  async function fullJourneyUntilSent(p: DemoProfile, start: number) {
    let d = await discover(p, start);
    d = await analyze(d, p, start - 1);
    d = await toReview(d, start - 1);
    d = await approve(d, start - 2);
    d = await dub(d, p, start - 3, { finish: true });
    d = await writeProposal(d, p, start - 4, { versions: 1, finish: true });
    d = await draftEmail(d, p, start - 4);
    d = await approveEmail(d, start - 5);
    return send(d, start - 5);
  }

  // ---------------------------------------------------------------------------
  // Les prospects, du plus récent au plus avancé
  // ---------------------------------------------------------------------------

  const P = PROFILES;

  // 1. Salle de prospection : découverte en cours de qualification.
  await discover(P.lea, 0, false);

  // 2. Salle d'analyse : analyse en cours, pas encore de résultat.
  {
    const d = await discover(P.hugo, 2);
    clock.at(1, 10, 0);
    await missions.applyAction(openMission(d, 'analysis').id, { action: 'start' }, AGENTS.analyst);
  }

  // 3. Mon bureau : en attente de décision.
  {
    let d = await discover(P.camille, 4);
    d = await analyze(d, P.camille, 3);
    await toReview(d, 3);
  }

  // 4. Mon bureau : deuxième passage après une demande de nouvelle analyse.
  {
    const p = P.nicolas;
    let d = await discover(p, 9);
    d = await analyze(d, p, 8);
    d = await toReview(d, 8);
    clock.at(6, 18, 0);
    d = await prospects.decideProspect(
      d.prospect.id,
      {
        missionId: openMission(d, 'director').id,
        decision: 'request_reanalysis',
        instruction: 'Vérifier l’intérêt réel du public hispanophone (forums, commentaires).',
      },
      OWNER,
    );
    d = await analyze(
      d,
      {
        ...p,
        scores: [7, 8, 5, 7, 7],
        summary:
          'Analyse complémentaire : l’intérêt hispanophone se confirme sur les tutoriels de menuiserie.',
        conclusion: 'Potentiel revu à la hausse : un pilote en espagnol est pertinent.',
        signals: [
          ...p.signals,
          observation(
            'Une trentaine de discussions hispanophones citent ses tutoriels (échantillon fictif).',
          ),
        ],
        uncertainties: [
          'La part exacte d’audience hispanophone reste inconnue (statistiques privées).',
        ],
      },
      4,
    );
    await toReview(d, 4);
  }

  // 5. Studio de doublage : première tentative échouée, en attente d'autorisation.
  {
    const p = P.sarah;
    let d = await discover(p, 8);
    d = await analyze(d, p, 7);
    d = await toReview(d, 7);
    d = await approve(d, 6, 'Priorité haute : très forte audience.');
    await dub(d, p, 5, { finish: false, failedFirst: true });
  }

  // 6. Salle commerciale : deux versions de la proposition, rédaction en cours.
  {
    const p = P.thomas;
    let d = await discover(p, 11);
    d = await analyze(d, p, 10);
    d = await toReview(d, 10);
    d = await approve(d, 9);
    d = await dub(d, p, 8, { finish: true });
    await writeProposal(d, p, 6, { versions: 2, finish: false });
  }

  // 7. Validation des e-mails : v1 à corriger, v2 en attente de validation.
  {
    const p = P.ines;
    let d = await discover(p, 13);
    d = await analyze(d, p, 12);
    d = await toReview(d, 12);
    d = await approve(d, 11);
    d = await dub(d, p, 10, { finish: true });
    d = await writeProposal(d, p, 9, { versions: 1, finish: true });
    d = await draftEmail(d, p, 8, 1);
    clock.at(7, 11, 0);
    d = await prospects.decideEmail(
      d.prospect.id,
      {
        missionId: openMission(d, 'email_review').id,
        productionId: latestEmail(d).id,
        decision: 'request_changes',
        reason: 'Trop générique : ajouter le lien vers la démo et proposer le portugais.',
      },
      OWNER,
    );
    clock.at(6, 10, 30);
    const v2 = emailContent(p, 2);
    await prospects.editEmailDraft(
      d.prospect.id,
      {
        productionId: latestEmail(d).id,
        subject: 'Votre chaîne en portugais, avec votre voix',
        body: v2.body.replace(/anglais/g, 'portugais'),
      },
      AGENTS.writer,
    );
  }

  // 8. Validation des e-mails : e-mail validé, prêt à être « envoyé » (simulation).
  {
    const p = P.julien;
    let d = await discover(p, 12);
    d = await analyze(d, p, 11);
    d = await toReview(d, 11);
    d = await approve(d, 10);
    d = await dub(d, p, 8, { finish: true });
    d = await writeProposal(d, p, 6, { versions: 2, finish: true });
    d = await draftEmail(d, p, 3);
    await approveEmail(d, 1);
  }

  // 9. Suivi : aucune réponse, relance à effectuer (échéance dépassée).
  {
    const d = await fullJourneyUntilSent(P.manon, 20);
    clock.at(13, 9, 0);
    await prospects.updateFollowup(
      d.prospect.id,
      {
        relationshipStatus: 'followup_due',
        nextAction: 'Envoyer une relance courte avec le lien de la démo',
        nextActionAt: dateBefore(1),
      },
      OWNER,
    );
  }

  // 10. Suivi : réponse positive, discussion en cours.
  {
    const p = P.antoine;
    const d = await fullJourneyUntilSent(p, 22);
    clock.at(15, 16, 45);
    await prospects.recordReply(
      d.prospect.id,
      {
        subject: 'Re: Une démo de Finances Simples en espagnol',
        body: 'Bonjour,\n\nMerci pour la démo, le rendu est bluffant ! Je serais partant pour un appel. Quelles sont vos disponibilités jeudi ?\n\nAntoine',
        receivedAt: clock.now().toISOString(),
      },
      OWNER,
    );
    clock.at(14, 10, 0);
    await prospects.updateFollowup(
      d.prospect.id,
      {
        relationshipStatus: 'in_discussion',
        nextAction: 'Appel de présentation (20 min)',
        nextActionAt: new Date(origin + 2 * DAY).toISOString(),
      },
      OWNER,
    );
    clock.later(30);
    await prospects.addNote(
      d.prospect.id,
      {
        text: 'Très réceptif. Souhaite commencer par la série « budget » (vidéos indépendantes de la fiscalité française).',
      },
      OWNER,
    );
  }

  // 11. Suivi : refus et demande de ne plus être contactée → relances bloquées.
  {
    const d = await fullJourneyUntilSent(P.elodie, 25);
    clock.at(19, 12, 20);
    await prospects.recordReply(
      d.prospect.id,
      {
        subject: 'Re: Élodie Lit en anglais ?',
        body: 'Bonjour,\n\nMerci, mais ce n’est pas pour moi. Merci de ne plus me contacter.\n\nÉlodie',
        receivedAt: clock.now().toISOString(),
      },
      OWNER,
    );
    clock.later(40);
    await prospects.updateFollowup(
      d.prospect.id,
      {
        relationshipStatus: 'not_interested',
        doNotContact: true,
        doNotContactReason:
          'Demande explicite de la créatrice (réponse du ' +
          clock.now().toLocaleDateString('fr-FR') +
          ').',
        nextAction: null,
        nextActionAt: null,
      },
      OWNER,
    );
  }

  // 12. Mon bureau : prospect refusé.
  {
    const p = P.karim;
    let d = await discover(p, 7);
    d = await analyze(d, p, 6);
    d = await toReview(d, 6);
    clock.at(5, 9, 30);
    await prospects.decideProspect(
      d.prospect.id,
      {
        missionId: openMission(d, 'director').id,
        decision: 'reject',
        reason: 'Format (directs de plusieurs heures) peu adapté au doublage.',
      },
      OWNER,
    );
  }

  // 13. Converti : parcours complet, relance puis accord.
  {
    const p = P.pauline;
    const d = await fullJourneyUntilSent(p, 30);
    clock.at(18, 9, 30);
    await prospects.updateFollowup(d.prospect.id, { relationshipStatus: 'followup_due' }, OWNER);
    clock.later(10);
    await prospects.sendFollowup(
      d.prospect.id,
      {
        subject: 'Petite relance : votre cours en espagnol',
        body: 'Bonjour Pauline,\n\nJe me permets de revenir vers vous au sujet de la démonstration en espagnol. Avez-vous eu le temps d’y jeter un œil ?\n\nBien à vous,\nL’équipe AI Agency',
      },
      OWNER,
    );
    clock.at(16, 14, 0);
    await prospects.recordReply(
      d.prospect.id,
      {
        subject: 'Re: Petite relance',
        body: 'Bonjour,\n\nOui, c’est exactement ce que je cherchais. Allons-y pour le pack de 10 vidéos en espagnol !\n\nPauline',
        receivedAt: clock.now().toISOString(),
      },
      OWNER,
    );
    clock.at(12, 11, 0);
    await prospects.updateFollowup(
      d.prospect.id,
      {
        relationshipStatus: 'converted',
        nextAction: 'Lancer la production des 10 vidéos',
        nextActionAt: null,
      },
      OWNER,
    );
  }

  // Une mission sans prospect (veille), pour illustrer ce cas dans l'interface.
  clock.at(1, 8, 30);
  await missions.create(
    {
      type: 'market_watch',
      room: 'prospecting',
      priority: 2,
      input: { theme: 'Tendances des chaînes de cuisine francophones' },
      requiresValidation: false,
      agentId: AGENTS.prospector.id,
      prospectId: null,
      maxAttempts: 3,
    },
    AGENTS.prospector,
  );

  return {
    prospects: await prisma.prospect.count(),
    missions: await prisma.mission.count(),
    events: await prisma.prospectEvent.count(),
  };
}
