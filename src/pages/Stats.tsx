import { useEffect, useState } from 'react';
import { computeFullStats, type FullStats } from '@/lib/stats';
import { Card } from '@/components/ui/Card';
import { PlayerRanking } from '@/components/stats/PlayerRanking';
import { PlayerRadar } from '@/components/stats/PlayerRadar';
import { ChampionStatsTable } from '@/components/stats/ChampionStats';
import { MetaComparison } from '@/components/stats/MetaComparison';
import { RoleDistribution } from '@/components/stats/RoleDistribution';
import { HeadToHead } from '@/components/stats/HeadToHead';

export function Stats() {
  const [stats, setStats] = useState<FullStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    computeFullStats().then((s) => { setStats(s); setLoading(false); });
  }, []);

  if (loading || !stats) {
    return <div className="text-center py-8 text-lol-gold">통계 로딩 중...</div>;
  }

  if (stats.wrStats.totalGames === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-lol-gold">통계</h1>
        <Card><p className="text-center py-8 text-lol-gold-light/50">게임 기록이 없습니다. 내전을 진행한 후 통계를 확인하세요.</p></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-lol-gold">통계</h1>

      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <div className="text-center">
            <div className="text-3xl font-bold text-lol-gold">{stats.wrStats.totalGames}</div>
            <div className="text-sm text-lol-gold-light/60">총 게임</div>
          </div>
        </Card>
        <Card>
          <div className="text-center">
            <div className="text-3xl font-bold text-lol-gold">{stats.players.length}</div>
            <div className="text-sm text-lol-gold-light/60">플레이어</div>
          </div>
        </Card>
        <Card>
          <div className="text-center">
            <div className="text-3xl font-bold text-blue-400">{stats.sideStats.team1Wins}</div>
            <div className="text-sm text-lol-gold-light/60">Team 1 승</div>
          </div>
        </Card>
        <Card>
          <div className="text-center">
            <div className="text-3xl font-bold text-red-400">{stats.sideStats.team2Wins}</div>
            <div className="text-sm text-lol-gold-light/60">Team 2 승</div>
          </div>
        </Card>
      </div>

      {/* Player Ranking */}
      <PlayerRanking stats={stats} />

      {/* Radar Chart */}
      <PlayerRadar stats={stats} />

      {/* Role Distribution */}
      <RoleDistribution stats={stats} />

      {/* Meta Comparison */}
      <MetaComparison stats={stats} />

      {/* Champion Stats Table */}
      <ChampionStatsTable stats={stats} />

      {/* Head to Head */}
      <HeadToHead stats={stats} />
    </div>
  );
}
