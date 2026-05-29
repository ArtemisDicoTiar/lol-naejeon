import type { ReactNode } from 'react';

type Tone = 'gold' | 'green' | 'blue' | 'red' | 'purple' | 'yellow' | 'muted';

const pillTone: Record<Tone, string> = {
  gold: 'border-lol-gold/40 bg-lol-gold/12 text-lol-gold shadow-[0_0_18px_rgba(200,155,60,0.08)]',
  green: 'border-prof-high/35 bg-prof-high/10 text-prof-high',
  blue: 'border-blue-500/35 bg-blue-950/35 text-blue-300',
  red: 'border-red-700/40 bg-red-950/30 text-red-300',
  purple: 'border-purple-500/35 bg-purple-950/35 text-purple-300',
  yellow: 'border-yellow-600/40 bg-yellow-950/25 text-yellow-300',
  muted: 'border-lol-border/80 bg-lol-dark/50 text-lol-gold-light/55',
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
    <section className={`relative overflow-hidden rounded-2xl border border-lol-gold/25 bg-[radial-gradient(circle_at_14%_0%,rgba(200,155,60,0.18),transparent_28%),linear-gradient(135deg,rgba(30,35,40,0.94),rgba(10,20,40,0.72)_48%,rgba(1,10,19,0.9))] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.28)] backdrop-blur-sm md:p-5 ${className}`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-lol-gold/60 to-transparent" />
      <div className="absolute -right-16 -top-20 h-52 w-52 rounded-full border border-lol-gold/15 bg-lol-gold/6 blur-sm" />
      <div className="absolute -bottom-24 left-1/3 h-44 w-44 rounded-full bg-blue-500/8 blur-3xl" />
      <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          {eyebrow && <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-lol-gold-light/35">{eyebrow}</div>}
          <h1 className="bg-gradient-to-r from-lol-gold-light via-lol-gold to-[#8f6f2b] bg-clip-text text-2xl font-black tracking-tight text-transparent md:text-3xl">{title}</h1>
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
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold backdrop-blur-sm ${pillTone[tone]} ${className}`}>
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
    <div className={`group relative overflow-hidden rounded-xl border border-lol-border/70 bg-[radial-gradient(circle_at_100%_0%,rgba(200,155,60,0.10),transparent_35%),rgba(1,10,19,0.42)] p-3 shadow-[inset_0_1px_0_rgba(240,230,210,0.04)] transition-colors hover:border-lol-gold/35 ${className}`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-lol-gold/25 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
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
    <div className={`rounded-xl border border-dashed border-lol-border/85 bg-[linear-gradient(180deg,rgba(30,35,40,0.62),rgba(1,10,19,0.34))] px-4 py-8 text-center shadow-[inset_0_1px_0_rgba(240,230,210,0.035)] ${className}`}>
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
    <div className={`rounded-xl border border-lol-border/80 bg-[linear-gradient(180deg,rgba(30,35,40,0.94),rgba(10,20,40,0.78))] p-3 shadow-[0_10px_30px_rgba(0,0,0,0.16)] backdrop-blur-sm ${className}`}>
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
