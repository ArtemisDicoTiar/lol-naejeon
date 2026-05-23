import { useEffect, useState } from 'react';
import { db } from '@/lib/db';

interface SideStats {
  team1Wins: number;
  team2Wins: number;
  total: number;
}

/**
 * Compact "T1 N% / T2 N%" badge for BanPickScreen — shows historical side
 * winrate so players can spot a side bias before drafting.
 */
export function SideStatsBadge({ className }: { className?: string }) {
  const [stats, setStats] = useState<SideStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    db.games.toArray().then((games) => {
      if (cancelled) return;
      let t1 = 0, t2 = 0;
      for (const g of games) {
        if (g.winningTeam === 1) t1++;
        else if (g.winningTeam === 2) t2++;
      }
      setStats({ team1Wins: t1, team2Wins: t2, total: t1 + t2 });
    });
    return () => { cancelled = true; };
  }, []);

  if (!stats || stats.total === 0) return null;

  const t1Wr = (stats.team1Wins / stats.total) * 100;
  const t2Wr = (stats.team2Wins / stats.total) * 100;
  const t1Better = t1Wr >= t2Wr;

  return (
    <div className={className ?? 'p-1.5 bg-lol-gray/40 rounded border border-lol-border/60'}>
      <div className="flex items-center justify-center gap-2 text-[10px]">
        <span className="text-lol-gold-light/40">사이드 승률 (전체 {stats.total}판)</span>
        <span className={`font-mono font-bold ${t1Better ? 'text-prof-high' : 'text-blue-400/70'}`}>
          T1 {Math.round(t1Wr)}%
        </span>
        <span className="text-lol-gold-light/30">·</span>
        <span className={`font-mono font-bold ${!t1Better ? 'text-prof-high' : 'text-red-400/70'}`}>
          T2 {Math.round(t2Wr)}%
        </span>
      </div>
    </div>
  );
}
