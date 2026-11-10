import type {
  LanguageDirection,
  LanguageLimitation,
  LanguageLimitationCode,
  LanguageSignal,
  LanguageSignalCode,
  SignalEffect,
} from '@agency/shared';

/**
 * Construction des signaux : le niveau de preuve est fixé ICI, par la fonction utilisée, jamais au
 * cas par cas.
 * - fact : valeur lue telle quelle dans un champ de l'API (avec ce champ comme source) ;
 * - observation : indice calculé par le moteur ;
 * - hypothesis : conclusion sur l'audience ou le potentiel. Tout signal « audience_* » en est une.
 */

type Resource = 'channels' | 'videos' | 'commentThreads';
type Value = string | number | boolean | null;

interface SignalSpec {
  code: LanguageSignalCode;
  direction?: LanguageDirection | null;
  effect?: SignalEffect;
  value?: Value;
  text: string;
}

const source = (resource: Resource, field: string) =>
  ({ api: 'youtube_data_api', resource, field }) as const;

export function fact(spec: SignalSpec, resource: Resource, field: string): LanguageSignal {
  if (spec.code.startsWith('audience_')) {
    throw new Error(`Un signal sur l'audience ne peut pas être un fait : ${spec.code}`);
  }
  return {
    code: spec.code,
    kind: 'fact',
    direction: spec.direction ?? null,
    effect: spec.effect ?? 'neutral',
    value: spec.value ?? null,
    source: source(resource, field),
    text: spec.text,
  };
}

export function observation(
  spec: SignalSpec,
  from: { resource: Resource; field: string } | null = null,
): LanguageSignal {
  if (spec.code.startsWith('audience_')) {
    throw new Error(`Un signal sur l'audience est une hypothèse : ${spec.code}`);
  }
  return {
    code: spec.code,
    kind: 'observation',
    direction: spec.direction ?? null,
    effect: spec.effect ?? 'neutral',
    value: spec.value ?? null,
    source: from && source(from.resource, from.field),
    text: spec.text,
  };
}

export function hypothesis(spec: SignalSpec): LanguageSignal {
  return {
    code: spec.code,
    kind: 'hypothesis',
    direction: spec.direction ?? null,
    effect: spec.effect ?? 'neutral',
    value: spec.value ?? null,
    source: null,
    text: spec.text,
  };
}

const LIMITATION_TEXTS: Record<LanguageLimitationCode, string> = {
  audience_demographics_unavailable:
    'La répartition de l’audience (langue, pays, âge) n’est pas accessible par l’API publique de YouTube : toute indication sur l’audience est une hypothèse.',
  comment_sample_bias:
    'Les commentaires échantillonnés ne représentent qu’une petite partie, non représentative, de l’audience.',
  no_comments: 'Aucun commentaire exploitable (commentaires désactivés ou absents).',
  comment_sample_too_small:
    'Trop peu de commentaires dont la langue a pu être établie pour en tirer un indice.',
  few_videos: 'Trop peu de vidéos dont la langue a pu être établie.',
  metadata_conflict:
    'Les langues déclarées par le créateur contredisent la langue des titres et descriptions.',
  subscribers_hidden: 'Le nombre d’abonnés est masqué ou non fourni.',
  no_publication_dates: 'Dates de publication indisponibles : activité récente non mesurée.',
  insufficient_coverage: 'Trop de critères n’ont pas pu être mesurés pour calculer un score.',
};

export function limitation(code: LanguageLimitationCode): LanguageLimitation {
  return { code, text: LIMITATION_TEXTS[code] };
}

/** « 1 vidéo », « 3 vidéos ». */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}
