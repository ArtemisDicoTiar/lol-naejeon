import type { FullStats } from '@/lib/stats';
import { Card } from '@/components/ui/Card';

export function DashboardPresenceBars({ stats }: { stats: FullStats }) {
  const rows = [...stats.champCompare]
    .map((champion) => ({
      ...champion,
      presence: champion.internalPicks + champion.internalBans,
    }))
    .filter((champion) => champion.presence > 0)
    .sort((a, b) => b.presence - a.presence || b.internalWinrate - a.internalWinrate)
    .slice(0, 5);
  const maxPresence = Math.max(...rows.map((row) => row.presence), 1);

  return (
    <Card title="핫 챔피언 Presence">
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-lol-gold-light/45">픽/밴 기록이 쌓이면 표시됩니다.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => {
            const width = Math.max(8, (row.presence / maxPresence) * 100);
            return (
              <div key={row.championId}>
                <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="w-5 shrink-0 text-xs font-bold text-lol-gold/70">#{index + 1}</span>
                    <span className="truncate font-medium text-lol-gold-light">{row.nameKo}</span>
                    <span className="rounded border border-lol-gold/30 px-1.5 py-0.5 text-[10px] text-lol-gold">{row.aramTier}</span>
                  </div>
                  <span className="shrink-0 text-xs text-lol-gold-light/50">
                    {row.internalPicks}픽 · {row.internalBans}밴
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-lol-dark">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-lol-gold to-tier-a"
                    style={{ width: `${width}%` }}
                  />
                </div>
                <div className="mt-1 text-right text-[10px] text-lol-gold-light/35">
                  내전 승률 {row.internalWinrate.toFixed(1)}%
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
