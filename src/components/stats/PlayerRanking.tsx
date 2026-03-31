import type { FullStats } from '@/lib/stats';
import { Card } from '@/components/ui/Card';

export function PlayerRanking({ stats }: { stats: FullStats }) {
  const ranked = stats.players
    .map((p) => ({ ...p, ...(stats.wrStats.playerOverallStats[p.id!] ?? { wins: 0, losses: 0, winrate: 0, totalPicks: 0 }) }))
    .sort((a, b) => b.winrate - a.winrate);

  return (
    <Card title="플레이어 랭킹">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-lol-gold-light/50 border-b border-lol-border">
              <th className="text-left py-2 px-2">#</th>
              <th className="text-left py-2 px-2">플레이어</th>
              <th className="text-right py-2 px-2">승률</th>
              <th className="text-right py-2 px-2">승</th>
              <th className="text-right py-2 px-2">패</th>
              <th className="text-right py-2 px-2">게임</th>
              <th className="text-left py-2 px-2">승률 바</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p, i) => (
              <tr key={p.id} className="border-b border-lol-border/30 hover:bg-lol-blue/30">
                <td className="py-2 px-2 text-lol-gold font-bold">{i + 1}</td>
                <td className="py-2 px-2 text-lol-gold-light font-medium">{p.name}</td>
                <td className={`py-2 px-2 text-right font-mono ${p.winrate >= 55 ? 'text-prof-high' : p.winrate >= 45 ? 'text-lol-gold' : 'text-prof-low'}`}>
                  {p.totalPicks > 0 ? `${Math.round(p.winrate)}%` : '-'}
                </td>
                <td className="py-2 px-2 text-right text-prof-high/80">{p.wins}</td>
                <td className="py-2 px-2 text-right text-prof-low/80">{p.losses}</td>
                <td className="py-2 px-2 text-right text-lol-gold-light/50">{p.totalPicks}</td>
                <td className="py-2 px-2 w-32">
                  {p.totalPicks > 0 && (
                    <div className="w-full h-3 bg-lol-dark rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${p.winrate >= 55 ? 'bg-prof-high' : p.winrate >= 45 ? 'bg-lol-gold' : 'bg-prof-low'}`}
                        style={{ width: `${Math.round(p.winrate)}%` }} />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
