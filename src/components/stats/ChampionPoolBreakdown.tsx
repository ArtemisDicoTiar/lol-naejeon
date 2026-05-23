import type { FullStats } from '@/lib/stats';
import { Card } from '@/components/ui/Card';

export function ChampionPoolBreakdown({ stats }: { stats: FullStats }) {
  const champById = (id: string) => stats.champions.find((c) => c.id === id);

  const rows = stats.players
    .map((p) => ({ player: p, pool: stats.playerChampionPool[p.id!] }))
    .filter((r) => r.pool && r.pool.uniqueCount > 0);

  if (rows.length === 0) return null;

  rows.sort((a, b) => b.pool.uniqueCount - a.pool.uniqueCount);

  return (
    <Card title="플레이어 챔피언 폭 / 픽 분포">
      <p className="text-xs text-lol-gold-light/40 mb-3">플레이어별 사용한 고유 챔피언 수와 자주 픽한 상위 5종.</p>
      <div className="space-y-2">
        {rows.map(({ player, pool }) => (
          <div key={player.id} className="p-3 rounded border border-lol-border bg-lol-dark/30">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-bold text-lol-gold-light">{player.name}</span>
                <span className="text-xs text-lol-gold-light/50">
                  고유 {pool.uniqueCount}종 · 풀 점수 {Math.round(pool.poolScore)}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {pool.topChamps.map((tc) => {
                const c = champById(tc.championId);
                if (!c) return null;
                const total = tc.wins + tc.losses;
                const wr = total > 0 ? Math.round((tc.wins / total) * 100) : 0;
                return (
                  <div key={tc.championId} className="flex items-center gap-1.5 px-2 py-1 rounded bg-lol-blue/40 border border-lol-border/50">
                    <img src={c.imageUrl} className="w-6 h-6 rounded" />
                    <div className="text-[11px] leading-tight">
                      <div className="text-lol-gold-light">{c.nameKo}</div>
                      <div className="text-lol-gold-light/50 font-mono">
                        {tc.picks}픽
                        {total > 0 && (
                          <span className={`ml-1 ${wr >= 55 ? 'text-prof-high' : wr <= 45 ? 'text-prof-low' : 'text-lol-gold-light/50'}`}>
                            {wr}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
