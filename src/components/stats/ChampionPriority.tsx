import { useMemo, useState } from 'react';
import type { FullStats } from '@/lib/stats';
import { Card } from '@/components/ui/Card';

type Mode = 'pick' | 'ban' | 'presence';

export function ChampionPriority({ stats }: { stats: FullStats }) {
  const [mode, setMode] = useState<Mode>('presence');

  const rows = useMemo(() => {
    const list = stats.champCompare.map((c) => ({
      ...c,
      presence: c.internalPickRate + c.internalBanRate,
    }));
    list.sort((a, b) => {
      if (mode === 'pick') return b.internalPickRate - a.internalPickRate;
      if (mode === 'ban') return b.internalBanRate - a.internalBanRate;
      return b.presence - a.presence;
    });
    return list.slice(0, 15);
  }, [stats.champCompare, mode]);

  if (rows.length === 0) return null;

  const champById = (id: string) => stats.champions.find((c) => c.id === id);

  return (
    <Card title="밴/픽 우선순위 분석">
      <div className="flex gap-2 mb-3">
        {([
          { k: 'presence' as Mode, label: '존재감 (픽+밴)' },
          { k: 'pick' as Mode, label: '최다 픽' },
          { k: 'ban' as Mode, label: '최다 밴' },
        ]).map((t) => (
          <button key={t.k} onClick={() => setMode(t.k)}
            className={`cursor-pointer px-3 py-1 rounded text-sm border transition-colors ${
              mode === t.k ? 'border-lol-gold bg-lol-gold/20 text-lol-gold'
                : 'border-lol-border text-lol-gold-light/50 hover:border-lol-gold/50'
            }`}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-lol-gold-light/40 mb-2">
        내전 추천 알고리즘은 픽률과 밴률이 높은(존재감 큰) 챔피언을 우선적으로 밴 후보로 올립니다.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-lol-gold-light/50 border-b border-lol-border">
              <th className="text-left py-2 px-2">#</th>
              <th className="text-left py-2 px-2">챔피언</th>
              <th className="text-right py-2 px-2">픽률</th>
              <th className="text-right py-2 px-2">밴률</th>
              <th className="text-right py-2 px-2">존재감</th>
              <th className="text-right py-2 px-2">승률</th>
              <th className="text-right py-2 px-2">픽수</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const champ = champById(r.championId);
              return (
                <tr key={r.championId} className="border-b border-lol-border/20 hover:bg-lol-blue/30">
                  <td className="py-1.5 px-2 text-lol-gold font-bold">{i + 1}</td>
                  <td className="py-1.5 px-2 text-lol-gold-light">
                    <div className="flex items-center gap-1.5">
                      {champ && <img src={champ.imageUrl} className="w-5 h-5 rounded" />}
                      {r.nameKo}
                    </div>
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono text-lol-gold-light/70">{Math.round(r.internalPickRate)}%</td>
                  <td className="py-1.5 px-2 text-right font-mono text-red-400/70">{Math.round(r.internalBanRate)}%</td>
                  <td className="py-1.5 px-2 text-right font-mono text-lol-gold font-bold">{Math.round(r.presence)}%</td>
                  <td className={`py-1.5 px-2 text-right font-mono ${r.internalWinrate >= 55 ? 'text-prof-high' : r.internalWinrate >= 45 ? 'text-lol-gold-light/70' : 'text-prof-low'}`}>
                    {Math.round(r.internalWinrate)}%
                  </td>
                  <td className="py-1.5 px-2 text-right text-lol-gold-light/50">{r.internalPicks}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
