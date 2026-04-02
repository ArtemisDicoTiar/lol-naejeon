import type { ProficiencyLevel } from '@/lib/db';
import type { AramTier, AramRole } from '@/data/aram-champion-meta';
import { ARAM_ROLE_LABELS } from '@/data/aram-champion-meta';

const profColors: Record<ProficiencyLevel, string> = {
  '상': 'bg-prof-high/20 text-prof-high border-prof-high/40',
  '중': 'bg-prof-mid/20 text-prof-mid border-prof-mid/40',
  '하': 'bg-prof-low/20 text-prof-low border-prof-low/40',
  '없음': 'bg-prof-none/20 text-prof-none border-prof-none/40',
};

export function ProficiencyBadge({
  level,
  onClick,
  size = 'md',
  estimated,
}: {
  level: ProficiencyLevel;
  onClick?: () => void;
  size?: 'sm' | 'md';
  estimated?: boolean;
}) {
  const sizeClass = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-1';
  return (
    <span
      onClick={onClick}
      className={`inline-block rounded font-medium ${profColors[level]} ${sizeClass} ${onClick ? 'cursor-pointer hover:opacity-80' : ''} ${estimated ? 'border-dashed' : 'border'}`}
      title={estimated ? '게임 기록 기반 추정' : undefined}
    >
      {estimated ? `~${level}` : level}
    </span>
  );
}

const tierColors: Record<AramTier, string> = {
  S: 'bg-tier-s/20 text-tier-s border-tier-s/40',
  A: 'bg-tier-a/20 text-tier-a border-tier-a/40',
  B: 'bg-tier-b/20 text-tier-b border-tier-b/40',
  C: 'bg-tier-c/20 text-tier-c border-tier-c/40',
  D: 'bg-tier-d/20 text-tier-d border-tier-d/40',
};

export function TierBadge({ tier }: { tier: AramTier }) {
  return (
    <span className={`inline-block rounded border text-xs px-1.5 py-0.5 font-bold ${tierColors[tier]}`}>
      {tier}
    </span>
  );
}

export function RoleBadge({ role }: { role: AramRole }) {
  return (
    <span className="inline-block rounded bg-lol-blue border border-lol-border text-xs px-1.5 py-0.5 text-lol-gold-light">
      {ARAM_ROLE_LABELS[role]}
    </span>
  );
}
