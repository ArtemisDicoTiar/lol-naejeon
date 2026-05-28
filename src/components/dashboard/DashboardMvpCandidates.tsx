import type { FullStats } from '@/lib/stats';
import { Card } from '@/components/ui/Card';

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function DashboardMvpCandidates({ stats }: { stats: FullStats }) {
  const maxDamage = Math.max(...stats.playerEogSummary.map((entry) => entry.avgDamageDealtToChampions), 1);
  const damageByPlayer = new Map(stats.playerEogSummary.map((entry) => [entry.playerId, entry]));
  const candidates = stats.players
    .map((player) => {
      const playerId = player.id!;
      const overall = stats.wrStats.playerOverallStats[playerId];
      const summary = damageByPlayer.get(playerId);
      const streak = stats.playerStreak[playerId];
      if (!overall && !summary) return null;
      const winrateScore = overall?.winrate ?? 50;
      const damageScore = summary ? (summary.avgDamageDealtToChampions / maxDamage) * 100 : 45;
      const streakScore = streak?.type === 'W'
        ? 50 + streak.count * 12
        : streak?.type === 'L'
          ? 50 - streak.count * 10
          : 50;
      const score = clampScore(winrateScore * 0.45 + damageScore * 0.35 + clampScore(streakScore) * 0.20);
      return {
        playerId,
        name: player.name,
        score,
        winrate: winrateScore,
        games: overall?.totalPicks ?? 0,
        damage: summary?.avgDamageDealtToChampions ?? 0,
        streak,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return (
    <Card title="내전 MVP 후보">
      {candidates.length === 0 ? (
        <p className="py-6 text-center text-sm text-lol-gold-light/45">승패나 EOG 통계가 쌓이면 표시됩니다.</p>
      ) : (
        <div className="space-y-3">
          {candidates.map((candidate, index) => (
            <div key={candidate.playerId} className="rounded-xl border border-lol-border/70 bg-lol-dark/35 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black ${
                    index === 0 ? 'bg-lol-gold text-lol-dark' : 'bg-lol-blue text-lol-gold'
                  }`}>
                    {index + 1}
                  </span>
                  <span className="truncate font-bold text-lol-gold-light">{candidate.name}</span>
                </div>
                <span className="font-mono text-lg font-black text-lol-gold">{candidate.score.toFixed(0)}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px] text-lol-gold-light/45">
                <div>승률 <span className="text-lol-gold-light/75">{candidate.winrate.toFixed(1)}%</span></div>
                <div>게임 <span className="text-lol-gold-light/75">{candidate.games}</span></div>
                <div>
                  {candidate.streak?.type
                    ? `${candidate.streak.count}${candidate.streak.type === 'W' ? '연승' : '연패'}`
                    : '흐름 없음'}
                </div>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-lol-blue">
                <div className="h-full rounded-full bg-lol-gold" style={{ width: `${candidate.score}%` }} />
              </div>
              {candidate.damage > 0 && (
                <div className="mt-1 text-right text-[10px] text-lol-gold-light/35">
                  평균 딜 {Math.round(candidate.damage).toLocaleString('ko-KR')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
