import type { ReactNode } from 'react';
import {
  INSIGHT_KIND_LABELS,
  PRODUCTION_STATUS_LABELS,
  type Insight,
  type InsightKind,
  type ProductionStatus,
} from '@agency/shared';
import { hueFromText, initials } from './format';

/** Briques visuelles du dossier : cartes, champs, badges, états vides. */

export function Card({
  title,
  icon,
  aside,
  className = '',
  children,
}: {
  title: string;
  icon?: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`d-card ${className}`}>
      <header className="d-card__header">
        <h4 className="d-card__title">
          {icon && (
            <span className="d-card__icon" aria-hidden="true">
              {icon}
            </span>
          )}
          {title}
        </h4>
        {aside}
      </header>
      <div className="d-card__body">{children}</div>
    </section>
  );
}

/** Valeur absente : affichée clairement, jamais inventée. */
export function Missing({ label = 'Non renseigné' }: { label?: string }) {
  return <span className="d-missing">{label}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className="d-field">
      <dt className="d-field__label">{label}</dt>
      <dd className="d-field__value">{empty ? <Missing /> : children}</dd>
    </div>
  );
}

export function Fields({ children }: { children: ReactNode }) {
  return <dl className="d-fields">{children}</dl>;
}

export function Chips({ items, tone = 'neutral' }: { items: string[]; tone?: 'neutral' | 'warn' }) {
  if (items.length === 0) return <Missing label="Aucun" />;
  return (
    <ul className={`d-chips d-chips--${tone}`}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function BulletList({
  items,
  empty = 'Aucun élément',
}: {
  items: string[];
  empty?: string;
}) {
  if (items.length === 0) return <Missing label={empty} />;
  return (
    <ul className="d-bullets">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function KindBadge({ kind }: { kind: InsightKind }) {
  return <span className={`d-kind d-kind--${kind}`}>{INSIGHT_KIND_LABELS[kind]}</span>;
}

/** Liste d'informations qualifiées (fait vérifié / observation / hypothèse IA). */
export function InsightList({
  items,
  empty = 'Aucun élément',
}: {
  items: Insight[];
  empty?: string;
}) {
  if (items.length === 0) return <Missing label={empty} />;
  return (
    <ul className="d-insights">
      {items.map((item) => (
        <li key={`${item.kind}-${item.text}`} className={`d-insight d-insight--${item.kind}`}>
          <KindBadge kind={item.kind} />
          <span className="d-insight__text">{item.text}</span>
          {item.source && <span className="d-insight__source">Source : {item.source}</span>}
        </li>
      ))}
    </ul>
  );
}

const PRODUCTION_TONES: Record<ProductionStatus, string> = {
  draft: 'neutral',
  pending_review: 'warn',
  approved: 'ok',
  changes_requested: 'warn',
  rejected: 'error',
  generated: 'ok',
  failed: 'error',
  sent: 'info',
  superseded: 'muted',
};

export function ProductionBadge({ status }: { status: ProductionStatus }) {
  return (
    <span className={`d-badge d-badge--${PRODUCTION_TONES[status]}`}>
      {PRODUCTION_STATUS_LABELS[status]}
    </span>
  );
}

export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`d-badge d-badge--${tone}`}>{children}</span>;
}

export function EmptyState({
  icon = '🗂️',
  title,
  children,
}: {
  icon?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="d-empty" role="status">
      <div className="d-empty__icon" aria-hidden="true">
        {icon}
      </div>
      <p className="d-empty__title">{title}</p>
      {children && <div className="d-empty__hint">{children}</div>}
    </div>
  );
}

/** Illustration du prospect : initiales sur fond coloré (aucune photo réelle). */
export function Avatar({
  name,
  url,
  size = 96,
}: {
  name: string;
  url: string | null;
  size?: number;
}) {
  const hue = hueFromText(name);
  if (url) {
    return <img className="d-avatar" src={url} alt="" width={size} height={size} />;
  }
  return (
    <div
      className="d-avatar d-avatar--initials"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, hsl(${hue} 55% 62%), hsl(${(hue + 40) % 360} 50% 42%))`,
      }}
      aria-hidden="true"
    >
      {initials(name)}
    </div>
  );
}

/** Priorité 1 à 5, sous forme de pastilles. */
export function PriorityDots({ value }: { value: number }) {
  return (
    <span
      className="d-priority"
      aria-label={`Priorité ${value} sur 5`}
      title={`Priorité ${value} sur 5`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= value ? 'is-on' : ''} />
      ))}
    </span>
  );
}

/** Choix d'une version (analyses, propositions, e-mails). */
export function VersionPicker<T extends { id: string; version: number }>({
  items,
  selectedId,
  onSelect,
  label,
}: {
  items: T[];
  selectedId: string;
  onSelect: (id: string) => void;
  label: string;
}) {
  if (items.length < 2) return null;
  return (
    <div className="d-versions" role="group" aria-label={label}>
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          className={`d-versions__item ${item.id === selectedId ? 'is-active' : ''}`}
          aria-pressed={item.id === selectedId}
          onClick={() => onSelect(item.id)}
        >
          Version {item.version}
          {index === 0 && <span className="d-versions__latest">actuelle</span>}
        </button>
      ))}
    </div>
  );
}
