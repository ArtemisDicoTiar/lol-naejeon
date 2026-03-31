import { useState, useMemo } from 'react';
import type { FullStats } from '@/lib/stats';
import { Card } from '@/components/ui/Card';

type SortKey = 'nameKo' | 'internalWinrate' | 'internalPickRate' | 'internalBanRate' | 'aramWinrate' | 'diff';

export function ChampionStatsTable({ stats }: { stats: FullStats }) {
  const [sortKey, setSortKey] = useState<SortKey>('internalPicks' as any);
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch] = useState('');

  const sorted = useMemo(() => {
    let list = [...stats.champCompare];
    if (search) {
      list = list.filter((c) => c.nameKo.includes(search) || c.championId.toLowerCase().includes(search.toLowerCase()));
    }
    list.sort((a, b) => {
      const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0;
      if (typeof av === 'string') return sortAsc ? (av as string).localeCompare(bv as string) : (bv as string).localeCompare(av as string);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return list;
  }, [stats.champCompare, sortKey, sortAsc, search]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc); else { setSortKey(key); setSortAsc(false); }
  };

  const SortHeader = ({ k, label }: { k: SortKey; label: string }) => (
    <th className="py-2 px-2 text-right cursor-pointer hover:text-lol-gold select-none" onClick={() => toggleSort(k)}>
      {label} {sortKey === k && (sortAsc ? '\u25B2' : '\u25BC')}
    </th>
  );

  return (
    <Card title="챔피언 통계 (내전 vs ARAM 메타)">
      <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="챔피언 검색..."
        className="w-full bg-lol-blue border border-lol-border rounded px-3 py-1.5 text-sm text-lol-gold-light placeholder:text-lol-gold-light/30 focus:outline-none focus:border-lol-gold mb-3" />
      <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-lol-gray">
            <tr className="text-lol-gold-light/50 border-b border-lol-border">
              <th className="text-left py-2 px-2 cursor-pointer hover:text-lol-gold" onClick={() => toggleSort('nameKo')}>챔피언</th>
              <SortHeader k="internalWinrate" label="내전 승률" />
              <SortHeader k="internalPickRate" label="픽률" />
              <SortHeader k="internalBanRate" label="밴률" />
              <SortHeader k="aramWinrate" label="ARAM 승률" />
              <SortHeader k="diff" label="차이" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.championId} className="border-b border-lol-border/20 hover:bg-lol-blue/30">
                <td className="py-1.5 px-2 text-lol-gold-light">
                  <div className="flex items-center gap-1.5">
                    <img src={stats.champions.find((ch) => ch.id === c.championId)?.imageUrl} className="w-5 h-5 rounded" />
                    {c.nameKo}
                    <span className="text-lol-gold-light/30">{c.aramTier}</span>
                  </div>
                </td>
                <td className={`py-1.5 px-2 text-right font-mono ${c.internalWinrate >= 55 ? 'text-prof-high' : c.internalWinrate >= 45 ? 'text-lol-gold-light/70' : 'text-prof-low'}`}>
                  {Math.round(c.internalWinrate)}%
                  <span className="text-lol-gold-light/30 ml-1">({c.internalPicks})</span>
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-lol-gold-light/60">{Math.round(c.internalPickRate)}%</td>
                <td className="py-1.5 px-2 text-right font-mono text-red-400/60">{Math.round(c.internalBanRate)}%</td>
                <td className="py-1.5 px-2 text-right font-mono text-lol-gold-light/50">{c.aramWinrate}%</td>
                <td className={`py-1.5 px-2 text-right font-mono font-bold ${c.diff > 5 ? 'text-prof-high' : c.diff < -5 ? 'text-prof-low' : 'text-lol-gold-light/40'}`}>
                  {c.diff > 0 ? '+' : ''}{Math.round(c.diff)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
