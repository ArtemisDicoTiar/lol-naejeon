import { GAME_MODE_LABELS, type Game } from '@/lib/db';
import { Card } from '@/components/ui/Card';

export function SessionTimeline({ games }: { games: Game[] }) {
  if (games.length === 0) return null;

  const team1Wins = games.filter((game) => game.winningTeam === 1).length;
  const team2Wins = games.filter((game) => game.winningTeam === 2).length;
  const pending = games.filter((game) => game.winningTeam === null).length;

  return (
    <Card title="세션 타임라인">
      <div className="mb-4 grid gap-2 text-sm md:grid-cols-3">
        <div className="rounded border border-blue-700/30 bg-blue-950/20 px-3 py-2 text-blue-200">
          Team 1 · {team1Wins}승
        </div>
        <div className="rounded border border-red-700/30 bg-red-950/20 px-3 py-2 text-red-200">
          Team 2 · {team2Wins}승
        </div>
        <div className="rounded border border-lol-border/70 bg-lol-dark/40 px-3 py-2 text-lol-gold-light/60">
          결과 대기 · {pending}게임
        </div>
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max items-center gap-2">
          {games.map((game, index) => {
            const wonByTeam1 = game.winningTeam === 1;
            const wonByTeam2 = game.winningTeam === 2;
            return (
              <div key={game.id ?? game.gameNumber} className="flex items-center gap-2">
                {index > 0 && <div className="h-px w-5 bg-lol-border/80" />}
                <div
                  className={`min-w-[92px] rounded-lg border px-3 py-2 text-center ${
                    wonByTeam1
                      ? 'border-blue-500/50 bg-blue-950/35 text-blue-200'
                      : wonByTeam2
                        ? 'border-red-500/50 bg-red-950/35 text-red-200'
                        : 'border-lol-gold/30 bg-lol-gold/10 text-lol-gold'
                  }`}
                >
                  <div className="text-xs font-bold">G{game.gameNumber}</div>
                  <div className="mt-0.5 text-[11px] opacity-80">
                    {game.winningTeam ? `T${game.winningTeam} 승` : '진행중'}
                  </div>
                  <div className="mt-1 text-[10px] text-lol-gold-light/40">
                    {game.format} · {GAME_MODE_LABELS[game.mode ?? 'aram']}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
