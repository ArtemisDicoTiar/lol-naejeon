import { useMemo, useState } from 'react';
import type { FullStats } from '@/lib/stats';
import { Card } from '@/components/ui/Card';

type Sort = 'winrate' | 'games';

export function TrioPlayerSynergy({ stats }: { stats: FullStats }) {
  const [sort, setSort] = useState<Sort>('winrate');

  const rows = useMemo(() => {
    const list = [...stats.trioPlayerSynergy];
    list.sort((a, b) => {
      if (sort === 'games') return (b.sameTeamWins + b.sameTeamLosses) - (a.sameTeamWins + a.sameTeamLosses);
      return b.winrate - a.winrate;
    });
    return list.slice(0, 25);
  }, [stats.trioPlayerSynergy, sort]);

  if (rows.length === 0) {
    return (
      <Card title="3인 조합 상성 (같은 팀)">
        <p className="text-xs text-lol-gold-light/40 py-4 text-center">
          같은 팀으로 3명이 함께 한 게임이 3판 이상 있는 조합이 아직 없습니다.
        </p>
      </Card>
    );
  }

  const getName = (id: number) => stats.players.find((p) => p.id === id)?.name ?? '';

  return (
    <Card title="3인 조합 상성 (같은 팀 승률)">
      <div className="flex gap-2 mb-3">
        {([
          { k: 'winrate' as Sort, label: '승률순' },
          { k: 'games' as Sort, label: '게임수순' },
        ]).map((t) => (
          <button key={t.k} onClick={() => setSort(t.k)}
            className={`cursor-pointer px-3 py-1 rounded text-sm border transition-colors ${
              sort === t.k ? 'border-lol-gold bg-lol-gold/20 text-lol-gold'
                : 'border-lol-border text-lol-gold-light/50 hover:border-lol-gold/50'
            }`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-lol-gold-light/50 border-b border-lol-border">
              <th className="text-left py-2 px-2">조합</th>
              <th className="text-right py-2 px-2">승</th>
              <th className="text-right py-2 px-2">패</th>
              <th className="text-right py-2 px-2">승률</th>
              <th className="text-left py-2 px-2 w-32">승률 바</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.playerIds.join('-')} className="border-b border-lol-border/20 hover:bg-lol-blue/30">
                <td className="py-2 px-2 text-lol-gold-light">
                  {r.playerIds.map(getName).join(' · ')}
                </td>
                <td className="py-2 px-2 text-right text-prof-high/80">{r.sameTeamWins}</td>
                <td className="py-2 px-2 text-right text-prof-low/80">{r.sameTeamLosses}</td>
                <td className={`py-2 px-2 text-right font-mono font-bold ${
                  r.winrate >= 60 ? 'text-prof-high' : r.winrate >= 40 ? 'text-lol-gold' : 'text-prof-low'
                }`}>
                  {Math.round(r.winrate)}%
                </td>
                <td className="py-2 px-2">
                  <div className="w-full h-2 bg-lol-dark rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${
                      r.winrate >= 60 ? 'bg-prof-high' : r.winrate >= 40 ? 'bg-lol-gold' : 'bg-prof-low'
                    }`} style={{ width: `${Math.round(r.winrate)}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
