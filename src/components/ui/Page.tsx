import type { ReactNode } from 'react';

type Tone = 'gold' | 'green' | 'blue' | 'red' | 'purple' | 'yellow' | 'muted';

const pillTone: Record<Tone, string> = {
  gold: 'border-lol-gold/35 bg-lol-gold/12 text-lol-gold',
  green: 'border-prof-high/35 bg-prof-high/10 text-prof-high',
  blue: 'border-blue-500/35 bg-blue-950/35 text-blue-300',
  red: 'border-red-700/40 bg-red-950/30 text-red-300',
  purple: 'border-purple-500/35 bg-purple-950/35 text-purple-300',
  yellow: 'border-yellow-600/40 bg-yellow-950/25 text-yellow-300',
  muted: 'border-lol-border bg-lol-dark/45 text-lol-gold-light/55',
};

const statTone: Record<Tone, string> = {
  gold: 'text-lol-gold',
  green: 'text-prof-high',
  blue: 'text-blue-300',
  red: 'text-red-300',
  purple: 'text-purple-300',
  yellow: 'text-yellow-300',
  muted: 'text-lol-gold-light/70',
};

interface PageHeaderProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}

export function PageHeader({ title, eyebrow, description, actions, meta, className = '' }: PageHeaderProps) {
  return (
    <section className={`relative overflow-hidden rounded-xl border border-lol-gold/20 bg-[linear-gradient(135deg,rgba(200,155,60,0.12),rgba(10,20,40,0.72))] p-4 shadow-xl shadow-black/20 md:p-5 ${className}`}>
      <div className="absolute -right-16 -top-20 h-52 w-52 rounded-full border border-lol-gold/15 bg-lol-gold/5 blur-sm" />
      <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          {eyebrow && <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-lol-gold-light/35">{eyebrow}</div>}
          <h1 className="text-2xl font-black tracking-tight text-lol-gold md:text-3xl">{title}</h1>
          {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-lol-gold-light/62">{description}</p>}
          {meta && <div className="mt-3 flex flex-wrap gap-2">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
    </section>
  );
}

interface StatusPillProps {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}

export function StatusPill({ children, tone = 'muted', className = '' }: StatusPillProps) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${pillTone[tone]} ${className}`}>
      {children}
    </span>
  );
}

interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  className?: string;
}

export function StatTile({ label, value, sub, tone = 'gold', className = '' }: StatTileProps) {
  return (
    <div className={`rounded-lg border border-lol-border/70 bg-lol-dark/42 p-3 ${className}`}>
      <div className="text-xs text-lol-gold-light/42">{label}</div>
      <div className={`mt-1 truncate text-2xl font-black ${statTone[tone]}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-lol-gold-light/42">{sub}</div>}
    </div>
  );
}

interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`rounded-lg border border-dashed border-lol-border bg-lol-dark/35 px-4 py-8 text-center ${className}`}>
      <div className="text-sm font-medium text-lol-gold-light/75">{title}</div>
      {description && <p className="mx-auto mt-2 max-w-md text-sm text-lol-gold-light/45">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

interface FilterBarProps {
  children: ReactNode;
  summary?: ReactNode;
  className?: string;
}

export function FilterBar({ children, summary, className = '' }: FilterBarProps) {
  return (
    <div className={`rounded-lg border border-lol-border bg-lol-gray/95 p-3 ${className}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap gap-2">{children}</div>
        {summary && <div className="shrink-0 text-sm text-lol-gold-light/45">{summary}</div>}
      </div>
    </div>
  );
}

export function ActionGroup({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-wrap items-center gap-2 ${className}`}>{children}</div>;
}
