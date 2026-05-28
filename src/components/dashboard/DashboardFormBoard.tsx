import type { FullStats } from '@/lib/stats';
import { Card } from '@/components/ui/Card';

function formatDelta(delta: number) {
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
}

export function DashboardFormBoard({ stats }: { stats: FullStats }) {
  const rows = stats.players
    .map((player) => {
      const playerId = player.id!;
      const trend = stats.playerTrend[playerId];
      if (!trend || trend.recentGames === 0) return null;
      return { playerId, name: player.name, ...trend };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const rising = [...rows].sort((a, b) => b.delta - a.delta).slice(0, 3);
  const falling = [...rows].sort((a, b) => a.delta - b.delta).slice(0, 3);

  const renderRows = (items: typeof rows, tone: 'up' | 'down') => (
    <div className="space-y-2">
      {items.map((row) => {
        const positive = row.delta >= 0;
        return (
          <div key={`${tone}-${row.playerId}`} className="rounded border border-lol-border/60 bg-lol-dark/35 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-lol-gold-light">{row.name}</span>
              <span className={`font-mono text-sm font-bold ${positive ? 'text-prof-high' : 'text-prof-low'}`}>
                {formatDelta(row.delta)}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-lol-gold-light/40">
              최근 {row.recentWins}승 {row.recentLosses}패 · {row.recentWinrate.toFixed(1)}%
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <Card title="오늘의 폼">
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-lol-gold-light/45">완료된 경기 기록이 필요합니다.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="mb-2 text-xs font-medium text-prof-high">최근 상승세</div>
            {renderRows(rising, 'up')}
          </div>
          <div>
            <div className="mb-2 text-xs font-medium text-prof-low">주의 구간</div>
            {renderRows(falling, 'down')}
          </div>
        </div>
      )}
    </Card>
  );
}
