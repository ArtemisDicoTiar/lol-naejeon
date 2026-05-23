import { useEffect, useMemo, useState } from 'react';
import type { FullStats } from '@/lib/stats';
import { Card } from '@/components/ui/Card';
import { loadSynergyCounterData, type SynergyCounterData } from '@/lib/recommendation/data-loader';

type Sort = 'winrate' | 'games';

export function TrioChampionSynergy({ stats }: { stats: FullStats }) {
  const [data, setData] = useState<SynergyCounterData | null>(null);
  const [sort, setSort] = useState<Sort>('winrate');

  useEffect(() => { loadSynergyCounterData().then(setData); }, []);

  const champ = useMemo(() => {
    const map = new Map<string, { nameKo: string; imageUrl: string }>();
    for (const c of stats.champions) map.set(c.id, { nameKo: c.nameKo, imageUrl: c.imageUrl });
    return map;
  }, [stats.champions]);

  const rows = useMemo(() => {
    if (!data?.trioSynergies) return [];
    const list = Object.entries(data.trioSynergies).map(([key, s]) => ({
      key, ids: key.split('+'), wins: s.wins, total: s.total, winrate: s.winrate,
    }));
    list.sort((a, b) => sort === 'games' ? b.total - a.total : b.winrate - a.winrate);
    return list.slice(0, 25);
  }, [data, sort]);

  if (!data) return null;
  if (rows.length === 0) {
    return (
      <Card title="3챔피언 조합 시너지 (외부 메타)">
        <p className="text-xs text-lol-gold-light/40 py-4 text-center">
          3챔피언 조합 데이터가 아직 없습니다. `npx tsx scripts/compute-synergy-counter.ts`를 실행해 재생성하세요.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`3챔피언 조합 시너지 (외부 메타, ${data.matchCount.toLocaleString()}경기 기반)`}>
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
              <th className="text-right py-2 px-2">승률</th>
              <th className="text-right py-2 px-2">게임수</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-lol-border/20 hover:bg-lol-blue/30">
                <td className="py-2 px-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {r.ids.map((cid) => {
                      const c = champ.get(cid);
                      return (
                        <div key={cid} className="flex items-center gap-1">
                          {c?.imageUrl && <img src={c.imageUrl} className="w-6 h-6 rounded" />}
                          <span className="text-xs text-lol-gold-light">{c?.nameKo ?? cid}</span>
                        </div>
                      );
                    })}
                  </div>
                </td>
                <td className={`py-2 px-2 text-right font-mono font-bold ${
                  r.winrate >= 55 ? 'text-prof-high' : r.winrate >= 45 ? 'text-lol-gold' : 'text-prof-low'
                }`}>
                  {r.winrate.toFixed(1)}%
                </td>
                <td className="py-2 px-2 text-right text-lol-gold-light/50">{r.total.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
