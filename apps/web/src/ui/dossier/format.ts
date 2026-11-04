import type { ActorType } from '@agency/shared';

/** Mise en forme des données du dossier (dates, nombres, durées, auteurs). */

const dateFmt = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const intFmt = new Intl.NumberFormat('fr-FR');
const compactFmt = new Intl.NumberFormat('fr-FR', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export const formatDate = (iso: string) => dateFmt.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));
export const formatTime = (iso: string) => timeFmt.format(new Date(iso));
export const formatDay = (iso: string) => dayFmt.format(new Date(iso));
export const formatInt = (n: number) => intFmt.format(n);
export const formatCompact = (n: number) => compactFmt.format(n);

/** 640 → "10 min 40 s" ; 3600 → "1 h". */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  if (m > 0) return s > 0 ? `${m} min ${String(s).padStart(2, '0')} s` : `${m} min`;
  return `${s} s`;
}

/** 42 → "0:42" (repères d'un extrait vidéo). */
export function formatTimecode(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Échéance dépassée ? */
export function isPast(iso: string | null, now = Date.now()): boolean {
  return iso !== null && new Date(iso).getTime() < now;
}

/** « il y a 3 jours », « dans 2 jours », « aujourd'hui ». */
export function formatRelative(iso: string, now = Date.now()): string {
  const days = Math.round((new Date(iso).getTime() - now) / 86_400_000);
  if (days === 0) return 'aujourd’hui';
  if (days === -1) return 'hier';
  if (days === 1) return 'demain';
  return days < 0 ? `il y a ${-days} jours` : `dans ${days} jours`;
}

const AGENT_NAMES: Record<string, string> = {
  'agent-prospecteur': 'Agent prospecteur',
  'agent-analyste': 'Agent analyste',
  'agent-doublage': 'Agent doublage',
  'agent-commercial': 'Agent commercial',
  'agent-redacteur': 'Agent rédacteur',
  owner: 'Vous',
};

/** Auteur lisible d'une action. */
export function actorLabel(type: ActorType, id: string | null): string {
  if (type === 'system') return 'Système';
  if (id && AGENT_NAMES[id]) return AGENT_NAMES[id];
  if (type === 'user') return 'Vous';
  return id ?? 'Agent';
}

/** Initiales pour l'illustration du prospect. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** Teinte stable dérivée du nom (illustration sans photo réelle). */
export function hueFromText(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}
