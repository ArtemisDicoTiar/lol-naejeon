import type { FullStats } from '@/lib/stats';
import { Card } from '@/components/ui/Card';

export function HeadToHead({ stats }: { stats: FullStats }) {
  if (stats.headToHead.length === 0) return null;

  const getName = (id: number) => stats.players.find((p) => p.id === id)?.name ?? '';

  // Build matrix
  const playerIds = stats.players.map((p) => p.id!);
  const getH2H = (p1: number, p2: number) => {
    return stats.headToHead.find(
      (h) => (h.player1Id === p1 && h.player2Id === p2) || (h.player1Id === p2 && h.player2Id === p1)
    );
  };

  return (
    <Card title="플레이어 상성 (같은 팀 승률)">
      <p className="text-xs text-lol-gold-light/40 mb-3">두 플레이어가 같은 팀에 있었을 때의 승률입니다.</p>
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr>
              <th className="py-2 px-3 text-left text-lol-gold-light/50"></th>
              {playerIds.map((id) => (
                <th key={id} className="py-2 px-3 text-center text-lol-gold-light/70 min-w-[70px]">
                  {getName(id)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {playerIds.map((rowId) => (
              <tr key={rowId} className="border-t border-lol-border/20">
                <td className="py-2 px-3 text-lol-gold-light font-medium">{getName(rowId)}</td>
                {playerIds.map((colId) => {
                  if (rowId === colId) {
                    return <td key={colId} className="py-2 px-3 text-center text-lol-gold-light/20">-</td>;
                  }
                  const h = getH2H(rowId, colId);
                  if (!h || h.sameTeamWins + h.sameTeamLosses === 0) {
                    return <td key={colId} className="py-2 px-3 text-center text-lol-gold-light/20">-</td>;
                  }
                  const wr = h.sameTeamWinrate;
                  return (
                    <td key={colId} className="py-2 px-3 text-center">
                      <div className={`font-mono font-bold ${wr >= 60 ? 'text-prof-high' : wr >= 40 ? 'text-lol-gold' : 'text-prof-low'}`}>
                        {Math.round(wr)}%
                      </div>
                      <div className="text-lol-gold-light/30 text-[10px]">
                        {h.sameTeamWins}W {h.sameTeamLosses}L
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
