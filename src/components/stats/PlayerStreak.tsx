import type { FullStats } from '@/lib/stats';
import { Card } from '@/components/ui/Card';

export function PlayerStreak({ stats }: { stats: FullStats }) {
  const rows = stats.players
    .map((p) => ({ player: p, streak: stats.playerStreak[p.id!] }))
    .filter((r) => r.streak && r.streak.count > 0);

  if (rows.length === 0) return null;

  rows.sort((a, b) => {
    // Win streaks first, longest first; then loss streaks longest first
    if (a.streak.type !== b.streak.type) {
      return a.streak.type === 'W' ? -1 : 1;
    }
    return b.streak.count - a.streak.count;
  });

  return (
    <Card title="연승·연패 현황 (일자 단위)">
      <p className="text-xs text-lol-gold-light/40 mb-3">
        하루의 종합 결과(승 &gt; 패 = 승일, 승 &lt; 패 = 패일, 동률 = 무로 유지)로 계산합니다.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {rows.map(({ player, streak }) => {
          const isWin = streak.type === 'W';
          const label = isWin ? `${streak.count}일 연승` : `${streak.count}일 연패`;
          return (
            <div key={player.id} className={`p-3 rounded border ${
              isWin
                ? 'border-prof-high/40 bg-prof-high/10'
                : 'border-prof-low/40 bg-prof-low/10'
            }`}>
              <div className="text-sm text-lol-gold-light font-medium">{player.name}</div>
              <div className={`text-xl font-bold mt-1 ${isWin ? 'text-prof-high' : 'text-prof-low'}`}>
                {label}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
