import { useEffect, useState } from 'react';
import type { Player } from '@/lib/db';
import { computePlayerStreaks, computeSessionStreaks } from '@/lib/stats';
import type { PlayerStreakEntry } from '@/lib/stats';

interface StreakStripProps {
  players: Player[];
  /** Optional: restrict to a subset (e.g. current draft participants). */
  playerIds?: number[];
  /** Optional class for the outer card. Defaults to a compact card style. */
  className?: string;
  /** When true, omit players with no streak. Default true. */
  hideEmpty?: boolean;
  /** Compact mode for ban-pick top bar. */
  compact?: boolean;
  /**
   * 'day'     = day-aggregated streak across all history (3승3패 = 무 유지).
   * 'session' = round-based streak counting current active session only.
   */
  mode?: 'day' | 'session';
}

export function StreakStrip({
  players, playerIds, className, hideEmpty = true, compact = false, mode = 'day',
}: StreakStripProps) {
  const [streaks, setStreaks] = useState<Record<number, PlayerStreakEntry>>({});

  const ids = playerIds ?? players.map((p) => p.id!);
  const sig = ids.join(',');

  useEffect(() => {
    if (ids.length === 0) { setStreaks({}); return; }
    let cancelled = false;
    const fn = mode === 'session' ? computeSessionStreaks : computePlayerStreaks;
    fn(ids).then((s) => { if (!cancelled) setStreaks(s); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, mode]);

  const rows = ids
    .map((id) => ({ player: players.find((p) => p.id === id), streak: streaks[id] }))
    .filter((r): r is { player: Player; streak: PlayerStreakEntry } => !!r.player && !!r.streak);

  const shown = hideEmpty ? rows.filter((r) => r.streak.count > 0) : rows;

  const headerLabel = mode === 'session' ? '이번 내전 연승·연패' : '일자 연승·연패';
  const emptyLabel = mode === 'session'
    ? '이번 내전에서 결과가 기록된 라운드가 아직 없습니다'
    : '연승·연패 기록 없음 (일자 단위: 3승 3패는 무 유지)';
  const unit = mode === 'session' ? '' : '일 ';

  if (shown.length === 0) {
    return (
      <div className={className ?? 'p-2 bg-lol-gray/50 rounded border border-lol-border'}>
        <div className="text-[10px] text-lol-gold-light/40 text-center">{emptyLabel}</div>
      </div>
    );
  }

  // Sort: win streaks (desc count) first, then loss streaks (desc count)
  shown.sort((a, b) => {
    if (a.streak.type !== b.streak.type) return a.streak.type === 'W' ? -1 : 1;
    return b.streak.count - a.streak.count;
  });

  return (
    <div className={className ?? 'p-2 bg-lol-gray/50 rounded border border-lol-border'}>
      <div className="flex items-center gap-1.5 flex-wrap justify-center">
        <span className={`text-[10px] mr-1 ${compact ? 'text-lol-gold-light/40' : 'text-lol-gold-light/50'}`}>
          {headerLabel}
        </span>
        {shown.map(({ player, streak }) => {
          const isWin = streak.type === 'W';
          return (
            <span key={player.id}
              className={`inline-flex items-center gap-1 ${compact ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'} rounded border ${
                isWin
                  ? 'border-prof-high/40 bg-prof-high/15 text-prof-high'
                  : 'border-prof-low/40 bg-prof-low/15 text-prof-low'
              }`}>
              <span className="font-medium text-lol-gold-light/80">{player.name}</span>
              <span className="font-mono font-bold">{streak.count}{unit}{isWin ? '연승' : '연패'}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
