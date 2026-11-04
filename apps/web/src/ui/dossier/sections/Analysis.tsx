import { useState } from 'react';
import { INSIGHT_KINDS, type Analysis, type ProspectDossier } from '@agency/shared';
import { actorLabel, formatDate, formatDateTime, formatDuration, formatInt } from '../format';
import {
  BulletList,
  Card,
  Chips,
  EmptyState,
  Field,
  Fields,
  InsightList,
  KindBadge,
  Missing,
  PriorityDots,
  VersionPicker,
} from '../primitives';

/** Jauge circulaire du score (sur 100). */
export function ScoreGauge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <div className="d-gauge d-gauge--none" title="Pas de score : aucun critère identifiable">
        <span>—</span>
      </div>
    );
  }
  const tone = score >= 75 ? 'ok' : score >= 55 ? 'warn' : 'error';
  return (
    <div
      className={`d-gauge d-gauge--${tone}`}
      style={{ ['--score' as string]: score }}
      role="img"
      aria-label={`Score commercial : ${score} sur 100`}
    >
      <span>
        {score}
        <small>/100</small>
      </span>
    </div>
  );
}

function ScoreCriteria({ analysis }: { analysis: Analysis }) {
  if (analysis.scoreCriteria.length === 0) {
    return <Missing label="Aucun critère : pas de score calculé" />;
  }
  return (
    <table className="d-table d-criteria">
      <thead>
        <tr>
          <th>Critère</th>
          <th>Poids</th>
          <th>Note</th>
          <th>Justification</th>
        </tr>
      </thead>
      <tbody>
        {analysis.scoreCriteria.map((c) => (
          <tr key={c.label}>
            <td>{c.label}</td>
            <td>{c.weight} %</td>
            <td>
              <span className="d-bar" style={{ ['--value' as string]: c.value / 10 }}>
                <span />
              </span>
              {c.value}/10
            </td>
            <td className="d-muted">{c.justification}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Contenu détaillé d'une analyse (réutilisé par Mon bureau). */
export function AnalysisDetail({ analysis }: { analysis: Analysis }) {
  const c = analysis.content;
  return (
    <div className="d-grid">
      <div className="d-result d-grid__wide">
        <ScoreGauge score={analysis.score} />
        <div className="d-result__text">
          <p className="d-lead">{analysis.summary}</p>
          <p>
            <strong>Conclusion :</strong> {analysis.conclusion}
          </p>
          <p className="d-muted">
            Version {analysis.version} · {formatDateTime(analysis.createdAt)} ·{' '}
            {actorLabel(analysis.actorType, analysis.actorId)} · priorité{' '}
            <PriorityDots value={analysis.priority} />
          </p>
        </div>
      </div>

      <div className="d-legend d-grid__wide" aria-label="Légende">
        {INSIGHT_KINDS.map((k) => (
          <KindBadge key={k} kind={k} />
        ))}
        <span className="d-muted">
          Chaque information est qualifiée : seuls les faits vérifiés s’appuient sur une source.
        </span>
      </div>

      <Card title="Analyse internationale" icon="🌍">
        <Fields>
          <Field label="Langue principale">{c.international.mainLanguage}</Field>
          <Field label="Autres langues">
            <Chips items={c.international.otherLanguages} />
          </Field>
        </Fields>
        <h5 className="d-subtitle">Indices d’intérêt international</h5>
        <InsightList items={c.international.signals} empty="Aucun indice relevé" />
        <h5 className="d-subtitle">Marchés potentiels</h5>
        <InsightList items={c.international.markets} empty="Aucun marché identifié" />
        <h5 className="d-subtitle">Contenus adaptables</h5>
        <InsightList items={c.international.adaptableContent} empty="Non évalué" />
      </Card>

      <Card title="Activité de la chaîne" icon="🎬">
        <Fields>
          <Field label="Fréquence">{c.activity.publishingFrequency}</Field>
          <Field label="Types de contenus">
            <Chips items={c.activity.contentTypes} />
          </Field>
        </Fields>
        <h5 className="d-subtitle">Dernières vidéos</h5>
        {c.activity.recentVideos.length === 0 ? (
          <Missing label="Aucune vidéo relevée" />
        ) : (
          <table className="d-table">
            <thead>
              <tr>
                <th>Titre</th>
                <th>Publiée le</th>
                <th>Vues</th>
                <th>Durée</th>
              </tr>
            </thead>
            <tbody>
              {c.activity.recentVideos.map((v) => (
                <tr key={v.title}>
                  <td>{v.title}</td>
                  <td>{formatDate(v.publishedAt)}</td>
                  <td>{v.views === null ? '—' : formatInt(v.views)}</td>
                  <td>{v.durationSeconds === null ? '—' : formatDuration(v.durationSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <h5 className="d-subtitle">Évolution</h5>
        {c.activity.trend ? (
          <InsightList items={[c.activity.trend]} />
        ) : (
          <Missing label="Pas de données historiques" />
        )}
      </Card>

      <Card title="Analyse commerciale" icon="💼" className="d-grid__wide">
        <Fields>
          <Field label="Potentiel commercial">{c.commercial.potential}</Field>
          <Field label="Intérêt pour le doublage">{c.commercial.dubbingInterest}</Field>
          <Field label="Adéquation avec l’offre">{c.commercial.offerFit}</Field>
        </Fields>
        <div className="d-swot">
          <div className="d-swot__cell d-swot__cell--ok">
            <h5>Points forts</h5>
            <InsightList items={c.commercial.strengths} empty="Aucun" />
          </div>
          <div className="d-swot__cell d-swot__cell--warn">
            <h5>Points faibles</h5>
            <InsightList items={c.commercial.weaknesses} empty="Aucun" />
          </div>
          <div className="d-swot__cell d-swot__cell--info">
            <h5>Opportunités</h5>
            <InsightList items={c.commercial.opportunities} empty="Aucune" />
          </div>
          <div className="d-swot__cell d-swot__cell--error">
            <h5>Risques</h5>
            <InsightList items={c.commercial.risks} empty="Aucun" />
          </div>
        </div>
        <h5 className="d-subtitle">Recommandations de l’IA</h5>
        <BulletList items={c.commercial.recommendations} empty="Aucune recommandation" />
      </Card>

      <Card title="Score commercial" icon="🧮">
        <ScoreCriteria analysis={analysis} />
      </Card>

      <Card title="Incertitudes et sources" icon="📚">
        <h5 className="d-subtitle">Incertitudes</h5>
        <BulletList items={c.uncertainties} empty="Aucune incertitude signalée" />
        <h5 className="d-subtitle">Sources utilisées</h5>
        <BulletList items={analysis.sources.map((s) => s.label)} empty="Aucune source" />
      </Card>
    </div>
  );
}

/** Salle d'analyse : résultat de la dernière analyse, versions précédentes consultables. */
export function AnalysisSection({ dossier }: { dossier: ProspectDossier }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const analyses = dossier.analyses;
  const inProgress = dossier.missions.find(
    (m) => m.room === 'analysis' && (m.status === 'in_progress' || m.status === 'pending'),
  );

  if (analyses.length === 0) {
    return (
      <EmptyState icon="🌍" title="Aucune analyse pour ce prospect">
        {inProgress
          ? `Une analyse est ${inProgress.status === 'in_progress' ? 'en cours' : 'en attente'} dans la salle d’analyse.`
          : 'Le prospect n’a pas encore été transmis à la salle d’analyse.'}
      </EmptyState>
    );
  }

  const selected = analyses.find((a) => a.id === selectedId) ?? analyses[0]!;
  return (
    <div className="d-section">
      {inProgress && (
        <p className="d-alert d-alert--info">
          Une nouvelle analyse est {inProgress.status === 'in_progress' ? 'en cours' : 'en attente'}
          {typeof inProgress.input.instruction === 'string' &&
            ` — consigne : « ${inProgress.input.instruction} »`}
          .
        </p>
      )}
      <VersionPicker
        items={analyses}
        selectedId={selected.id}
        onSelect={setSelectedId}
        label="Versions de l’analyse"
      />
      <AnalysisDetail analysis={selected} />
    </div>
  );
}
