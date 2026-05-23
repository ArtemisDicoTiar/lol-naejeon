import { useEffect, useState } from 'react';
import { computeFullStats, type FullStats } from '@/lib/stats';
import { GAME_MODE_LABELS, type GameMode } from '@/lib/db';
import { Card } from '@/components/ui/Card';
import { PlayerRanking } from '@/components/stats/PlayerRanking';
import { PlayerStreak } from '@/components/stats/PlayerStreak';
import { PlayerTrend } from '@/components/stats/PlayerTrend';
import { PlayerRadar } from '@/components/stats/PlayerRadar';
import { PlayerRoleRadar } from '@/components/stats/PlayerRoleRadar';
import { ChampionStatsTable } from '@/components/stats/ChampionStats';
import { ChampionPriority } from '@/components/stats/ChampionPriority';
import { ChampionPoolBreakdown } from '@/components/stats/ChampionPoolBreakdown';
import { MetaComparison } from '@/components/stats/MetaComparison';
import { RoleDistribution } from '@/components/stats/RoleDistribution';
import { HeadToHead } from '@/components/stats/HeadToHead';
import { TrioPlayerSynergy } from '@/components/stats/TrioPlayerSynergy';
import { TrioChampionSynergy } from '@/components/stats/TrioChampionSynergy';

type ModeFilter = 'all' | GameMode;

export function Stats() {
  const [stats, setStats] = useState<FullStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');

  useEffect(() => {
    setLoading(true);
    const filter = modeFilter === 'all' ? undefined : modeFilter;
    computeFullStats(filter).then((s) => { setStats(s); setLoading(false); });
  }, [modeFilter]);

  const modeToggle = (
    <div className="flex gap-2">
      {([
        { k: 'all' as ModeFilter, label: '전체' },
        { k: 'aram' as ModeFilter, label: GAME_MODE_LABELS.aram },
        { k: 'augmented' as ModeFilter, label: GAME_MODE_LABELS.augmented },
      ]).map((opt) => (
        <button key={opt.k} onClick={() => setModeFilter(opt.k)}
          className={`cursor-pointer px-3 py-1 rounded text-sm border transition-colors ${
            modeFilter === opt.k
              ? (opt.k === 'augmented'
                ? 'border-purple-400 bg-purple-900/30 text-purple-300'
                : 'border-lol-gold bg-lol-gold/20 text-lol-gold')
              : 'border-lol-border text-lol-gold-light/50 hover:border-lol-gold/50'
          }`}>
          {opt.label}
        </button>
      ))}
    </div>
  );

  if (loading || !stats) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-lol-gold">통계</h1>
          {modeToggle}
        </div>
        <div className="text-center py-8 text-lol-gold">통계 로딩 중...</div>
      </div>
    );
  }

  if (stats.wrStats.totalGames === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-lol-gold">통계</h1>
          {modeToggle}
        </div>
        <Card>
          <p className="text-center py-8 text-lol-gold-light/50">
            {modeFilter === 'all'
              ? '게임 기록이 없습니다. 내전을 진행한 후 통계를 확인하세요.'
              : `${GAME_MODE_LABELS[modeFilter as GameMode]} 모드 기록이 없습니다.`}
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-lol-gold">통계</h1>
        {modeToggle}
      </div>

      {/* Quick stats */}
      {(() => {
        const sideTotal = stats.sideStats.total || 1;
        const t1Wr = (stats.sideStats.team1Wins / sideTotal) * 100;
        const t2Wr = (stats.sideStats.team2Wins / sideTotal) * 100;
        const t1Better = t1Wr >= t2Wr;
        return (
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
                <div className={`text-3xl font-bold font-mono ${t1Better ? 'text-prof-high' : 'text-blue-400/70'}`}>
                  {Math.round(t1Wr)}%
                </div>
                <div className="text-sm text-lol-gold-light/60">
                  Team 1 승률
                </div>
                <div className="text-[10px] text-lol-gold-light/40">
                  {stats.sideStats.team1Wins}W / {stats.sideStats.total - stats.sideStats.team1Wins}L
                </div>
              </div>
            </Card>
            <Card>
              <div className="text-center">
                <div className={`text-3xl font-bold font-mono ${!t1Better ? 'text-prof-high' : 'text-red-400/70'}`}>
                  {Math.round(t2Wr)}%
                </div>
                <div className="text-sm text-lol-gold-light/60">
                  Team 2 승률
                </div>
                <div className="text-[10px] text-lol-gold-light/40">
                  {stats.sideStats.team2Wins}W / {stats.sideStats.total - stats.sideStats.team2Wins}L
                </div>
              </div>
            </Card>
          </div>
        );
      })()}

      {/* Player Ranking */}
      <PlayerRanking stats={stats} />

      {/* Streak + Trend */}
      <PlayerStreak stats={stats} />
      <PlayerTrend stats={stats} />

      {/* Ability Radar (champion pool removed) */}
      <PlayerRadar stats={stats} />

      {/* Role-based Radar */}
      <PlayerRoleRadar stats={stats} />

      {/* Role Distribution */}
      <RoleDistribution stats={stats} />

      {/* Meta Comparison */}
      <MetaComparison stats={stats} />

      {/* Ban/Pick Priority */}
      <ChampionPriority stats={stats} />

      {/* Champion Stats Table */}
      <ChampionStatsTable stats={stats} />

      {/* Champion Pool Breakdown */}
      <ChampionPoolBreakdown stats={stats} />

      {/* Head to Head */}
      <HeadToHead stats={stats} />

      {/* Trio synergies (players + champions) */}
      <TrioPlayerSynergy stats={stats} />
      <TrioChampionSynergy stats={stats} />
    </div>
  );
}
