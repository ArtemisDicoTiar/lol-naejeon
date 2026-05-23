import type { FullStats } from '@/lib/stats';
import { Card } from '@/components/ui/Card';

export function PlayerTrend({ stats }: { stats: FullStats }) {
  const rows = stats.players
    .map((p) => ({ player: p, trend: stats.playerTrend[p.id!] }))
    .filter((r) => r.trend && r.trend.recentGames > 0);

  if (rows.length === 0) return null;

  rows.sort((a, b) => b.trend.delta - a.trend.delta);

  return (
    <Card title="최근 트렌드 (최근 5게임 vs 전체)">
      <p className="text-xs text-lol-gold-light/40 mb-3">최근 5게임 승률에서 전체 승률을 뺀 값. 양수면 폼이 올라온 상태입니다.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-lol-gold-light/50 border-b border-lol-border">
              <th className="text-left py-2 px-2">플레이어</th>
              <th className="text-right py-2 px-2">최근 N</th>
              <th className="text-right py-2 px-2">최근 승률</th>
              <th className="text-right py-2 px-2">전체 승률</th>
              <th className="text-right py-2 px-2">변화</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ player, trend }) => {
              const up = trend.delta > 1;
              const down = trend.delta < -1;
              return (
                <tr key={player.id} className="border-b border-lol-border/20 hover:bg-lol-blue/30">
                  <td className="py-2 px-2 text-lol-gold-light">{player.name}</td>
                  <td className="py-2 px-2 text-right text-lol-gold-light/50">
                    {trend.recentWins}승 {trend.recentLosses}패
                  </td>
                  <td className={`py-2 px-2 text-right font-mono ${
                    trend.recentWinrate >= 55 ? 'text-prof-high'
                      : trend.recentWinrate >= 45 ? 'text-lol-gold'
                      : 'text-prof-low'
                  }`}>
                    {Math.round(trend.recentWinrate)}%
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-lol-gold-light/60">
                    {Math.round(trend.allWinrate)}%
                  </td>
                  <td className={`py-2 px-2 text-right font-mono font-bold ${
                    up ? 'text-prof-high' : down ? 'text-prof-low' : 'text-lol-gold-light/40'
                  }`}>
                    {up ? '▲ ' : down ? '▼ ' : ''}{trend.delta > 0 ? '+' : ''}{Math.round(trend.delta)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
