import { useCallback, useEffect, useMemo, useState } from 'react';
import { computeFullStats, type FullStats } from '@/lib/stats';
import { GAME_MODE_LABELS, type GameMode } from '@/lib/db';
import { Card } from '@/components/ui/Card';
import { CombatRadar } from '@/components/stats/CombatRadar';
import { PlayerRanking } from '@/components/stats/PlayerRanking';
import { PlayerStreak } from '@/components/stats/PlayerStreak';
import { PlayerTrend } from '@/components/stats/PlayerTrend';
import { PlayerRadar } from '@/components/stats/PlayerRadar';
import { PlayerRoleRadar } from '@/components/stats/PlayerRoleRadar';
import { PlayerStyleRadar } from '@/components/stats/PlayerStyleRadar';
import { ChampionStatsTable } from '@/components/stats/ChampionStats';
import { ChampionPriority } from '@/components/stats/ChampionPriority';
import { ChampionPoolBreakdown } from '@/components/stats/ChampionPoolBreakdown';
import { MetaComparison } from '@/components/stats/MetaComparison';
import { RoleDistribution } from '@/components/stats/RoleDistribution';
import { HeadToHead } from '@/components/stats/HeadToHead';
import { TrioRadar } from '@/components/stats/TrioRadar';
import { TrioPlayerSynergy } from '@/components/stats/TrioPlayerSynergy';
import { TrioChampionSynergy } from '@/components/stats/TrioChampionSynergy';

type ModeFilter = 'all' | GameMode;

export function Stats() {
  const [stats, setStats] = useState<FullStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [selectedCombatPlayerIds, setSelectedCombatPlayerIds] = useState<number[]>([]);

  const loadStats = useCallback(() => {
    setLoading(true);
    const filter = modeFilter === 'all' ? undefined : modeFilter;
    computeFullStats(filter).then((s) => { setStats(s); setLoading(false); });
  }, [modeFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => { loadStats(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadStats]);

  useEffect(() => {
    const handleDataChanged = () => { loadStats(); };
    window.addEventListener('lol-data-changed', handleDataChanged);
    return () => window.removeEventListener('lol-data-changed', handleDataChanged);
  }, [loadStats]);

  const playerIdsWithCombatData = useMemo(() => {
    if (!stats) return new Set<number>();
    return new Set(stats.playerEogSummary.map((entry) => entry.playerId));
  }, [stats]);

  const resolvedSelectedCombatPlayerIds = useMemo(() => {
    if (!stats) return [];
    const availableIds = stats.players
      .map((player) => player.id)
      .filter((id): id is number => typeof id === 'number' && playerIdsWithCombatData.has(id));
    if (availableIds.length === 0) return [];
    const next = selectedCombatPlayerIds.filter((id) => playerIdsWithCombatData.has(id));
    return next.length > 0 ? next : availableIds.slice(0, 3);
  }, [playerIdsWithCombatData, selectedCombatPlayerIds, stats]);

  const combatRadarSeries = useMemo(() => {
    if (!stats) return [];
    return resolvedSelectedCombatPlayerIds
      .map((playerId, index) => {
        const summary = stats.playerEogSummary.find((entry) => entry.playerId === playerId);
        const player = stats.players.find((entry) => entry.id === playerId);
        if (!summary || !player) return null;
        const colors = ['#c89b3c', '#3b82f6', '#ef4444', '#22c55e', '#a855f7', '#f97316'];
        return {
          key: `player-${playerId}`,
          label: player.name,
          color: colors[index % colors.length],
          metrics: {
            damage: summary.avgDamageDealtToChampions,
            frontline: summary.avgFrontlineContribution,
            heal: summary.avgTotalHeal,
            cc: summary.avgTimeCCingOthers,
            kda: summary.avgKdaParticipation,
            goldEfficiency: summary.avgGoldEfficiency,
          },
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }, [resolvedSelectedCombatPlayerIds, stats]);

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

      <Card title="EOG 전투 지표">
        {stats.eogOverview.capturedGames === 0 ? (
          <p className="text-sm text-lol-gold-light/50">
            아직 종료 후 상세 통계가 수집된 게임이 없습니다. 브릿지를 연결한 상태에서 게임을 끝내면 여기에 누적됩니다.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded border border-lol-border/60 bg-lol-dark/40 p-3">
                <div className="text-2xl font-bold text-lol-gold">{stats.eogOverview.capturedGames}</div>
                <div className="text-xs text-lol-gold-light/55">수집된 게임</div>
              </div>
              <div className="rounded border border-lol-border/60 bg-lol-dark/40 p-3">
                <div className="text-2xl font-bold text-lol-gold">{Math.round(stats.eogOverview.avgDamageDealtToChampions).toLocaleString('ko-KR')}</div>
                <div className="text-xs text-lol-gold-light/55">평균 챔피언 피해</div>
              </div>
              <div className="rounded border border-lol-border/60 bg-lol-dark/40 p-3">
                <div className="text-2xl font-bold text-lol-gold">{Math.round(stats.eogOverview.avgDamageTaken).toLocaleString('ko-KR')}</div>
                <div className="text-xs text-lol-gold-light/55">평균 받은 피해</div>
              </div>
              <div className="rounded border border-lol-border/60 bg-lol-dark/40 p-3">
                <div className="text-2xl font-bold text-lol-gold">{Math.round(stats.eogOverview.avgTimeCCingOthers).toLocaleString('ko-KR')}</div>
                <div className="text-xs text-lol-gold-light/55">평균 CC 시간</div>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="rounded border border-lol-border/60 bg-lol-dark/40 p-3">
                <div className="text-xs text-lol-gold-light/55 mb-2">평균 힐 / 실드 / 죽은 시간</div>
                <div className="space-y-1 text-sm text-lol-gold-light/75">
                  <div>힐 {Math.round(stats.eogOverview.avgTotalHeal).toLocaleString('ko-KR')}</div>
                  <div>실드 {Math.round(stats.eogOverview.avgTotalShielded).toLocaleString('ko-KR')}</div>
                  <div>죽은 시간 {Math.round(stats.eogOverview.avgTimeSpentDead).toLocaleString('ko-KR')}</div>
                </div>
              </div>
              <div className="rounded border border-lol-border/60 bg-lol-dark/40 p-3">
                <div className="text-xs text-lol-gold-light/55 mb-2">플레이어별 평균 딜량 TOP</div>
                <div className="space-y-1.5">
                  {stats.playerEogSummary.slice(0, 5).map((entry, index) => {
                    const player = stats.players.find((row) => row.id === entry.playerId);
                    return (
                      <div key={entry.playerId} className="flex items-center justify-between text-sm">
                        <span className="text-lol-gold-light/80">
                          {index + 1}. {player?.name ?? entry.playerId}
                        </span>
                        <span className="text-lol-gold">
                          {Math.round(entry.avgDamageDealtToChampions).toLocaleString('ko-KR')}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>

      {stats.playerEogSummary.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {stats.players.map((player) => {
              const playerId = player.id;
              if (typeof playerId !== 'number') return null;
              const hasCombatData = playerIdsWithCombatData.has(playerId);
              const selected = resolvedSelectedCombatPlayerIds.includes(playerId);
              return (
                <button
                  key={playerId}
                  disabled={!hasCombatData}
                  onClick={() => setSelectedCombatPlayerIds((prev) => (
                    prev.includes(playerId)
                      ? prev.filter((id) => id !== playerId)
                      : [...prev, playerId]
                  ))}
                  title={hasCombatData ? undefined : '이 모드에서 수집된 전투 지표가 없습니다.'}
                  className={`px-3 py-1 rounded text-sm border transition-colors ${
                    !hasCombatData
                      ? 'cursor-not-allowed border-lol-border/50 text-lol-gold-light/25 bg-lol-dark/20'
                      : selected
                      ? 'border-lol-gold bg-lol-gold/20 text-lol-gold'
                      : 'cursor-pointer border-lol-border text-lol-gold-light/50 hover:border-lol-gold/50'
                  }`}
                >
                  {player.name}
                </button>
              );
            })}
          </div>
          <CombatRadar
            title="플레이어 전투 지표 레이더"
            description="선택한 선수들의 평균 딜량, 전방 기여, 힐량, CC, KDA 관여, 골드 효율을 비교합니다."
            series={combatRadarSeries}
            emptyMessage="비교할 선수를 하나 이상 선택하세요."
          />
        </div>
      )}

      {/* Player Ranking */}
      <PlayerRanking stats={stats} />

      {/* Streak + Trend */}
      <PlayerStreak stats={stats} />
      <PlayerTrend stats={stats} />

      {/* Ability Radar (champion pool removed) */}
      <PlayerRadar stats={stats} />

      {/* Role-based Radar */}
      <PlayerRoleRadar stats={stats} />

      {/* EOG-based playstyle radar */}
      <PlayerStyleRadar stats={stats} />

      {/* Trio Radar */}
      <TrioRadar stats={stats} />

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
