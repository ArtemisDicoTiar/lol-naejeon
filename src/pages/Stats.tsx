import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeFullStats, type FullStats } from '@/lib/stats';
import { GAME_MODE_LABELS, type GameMode } from '@/lib/db';
import { Card } from '@/components/ui/Card';
import { EmptyState, PageHeader, StatusPill } from '@/components/ui/Page';
import { PlayerRanking } from '@/components/stats/PlayerRanking';
import { PlayerStreak } from '@/components/stats/PlayerStreak';
import { PlayerTrend } from '@/components/stats/PlayerTrend';
import { PlayerRadar } from '@/components/stats/PlayerRadar';
import { PlayerRoleRadar } from '@/components/stats/PlayerRoleRadar';
import { PlayerStyleRadar } from '@/components/stats/PlayerStyleRadar';
import { ChampionPowerRanking } from '@/components/stats/ChampionPowerRanking';
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
type LoadOptions = {
  background?: boolean;
  clearCache?: boolean;
};

export function Stats() {
  const [stats, setStats] = useState<FullStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [slowLoad, setSlowLoad] = useState(false);
  const [eogLoading, setEogLoading] = useState(false);
  const [showDetailedStats, setShowDetailedStats] = useState(false);
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [selectedRadarPlayerIds, setSelectedRadarPlayerIds] = useState<number[]>([]);
  const radarSelectionInitializedRef = useRef(false);
  const statsCacheRef = useRef(new Map<ModeFilter, FullStats>());
  const fastStatsCacheRef = useRef(new Map<ModeFilter, FullStats>());
  const loadRequestIdRef = useRef(0);

  const loadStats = useCallback((options: LoadOptions = {}) => {
    const requestId = ++loadRequestIdRef.current;
    const targetMode = modeFilter;
    const filter = targetMode === 'all' ? undefined : targetMode;
    const slowTimer = window.setTimeout(() => {
      if (!options.background && requestId === loadRequestIdRef.current) setSlowLoad(true);
    }, 2500);
    if (options.clearCache) {
      statsCacheRef.current.clear();
      fastStatsCacheRef.current.clear();
    }
    const fullCached = options.clearCache ? undefined : statsCacheRef.current.get(targetMode);
    const fastCached = options.clearCache ? undefined : fastStatsCacheRef.current.get(targetMode);
    if (!options.background) {
      setShowDetailedStats(false);
      setSlowLoad(false);
    }

    if (fullCached) {
      window.clearTimeout(slowTimer);
      setStats(fullCached);
      setLoading(false);
      setEogLoading(false);
      setLoadError(false);
      return;
    }

    if (fastCached) {
      setStats(fastCached);
      setLoading(false);
    } else if (!options.background) {
      setLoading(true);
    }

    setLoadError(false);

    const loadFullStats = () => {
      setEogLoading(true);
      computeFullStats(filter, { includeEog: true })
        .then((s) => {
          if (requestId !== loadRequestIdRef.current) return;
          statsCacheRef.current.set(targetMode, s);
          setStats(s);
        })
        .catch((error) => {
          if (requestId !== loadRequestIdRef.current) return;
          console.error('Failed to load detailed stats:', error);
        })
        .finally(() => {
          if (requestId !== loadRequestIdRef.current) return;
          setEogLoading(false);
        });
    };

    const fastPromise = fastCached
      ? Promise.resolve(fastCached)
      : computeFullStats(filter, { includeEog: false });

    fastPromise
      .then((s) => {
        if (requestId !== loadRequestIdRef.current) return;
        fastStatsCacheRef.current.set(targetMode, s);
        setStats(s);
        setLoading(false);
        setSlowLoad(false);
        window.clearTimeout(slowTimer);
        window.setTimeout(loadFullStats, 0);
      })
      .catch((error) => {
        if (requestId !== loadRequestIdRef.current) return;
        console.error('Failed to load stats:', error);
        if (!options.background) {
          setStats(null);
          setLoadError(true);
        }
      })
      .finally(() => {
        window.clearTimeout(slowTimer);
        if (requestId !== loadRequestIdRef.current) return;
        setLoading(false);
        if (!options.background) setSlowLoad(false);
      });
  }, [modeFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => { loadStats(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadStats]);

  useEffect(() => {
    const handleDataChanged = () => { loadStats({ background: true, clearCache: true }); };
    window.addEventListener('lol-data-changed', handleDataChanged);
    return () => window.removeEventListener('lol-data-changed', handleDataChanged);
  }, [loadStats]);

  useEffect(() => {
    if (!stats || radarSelectionInitializedRef.current) return;
    setSelectedRadarPlayerIds(stats.players.slice(0, 2).map((player) => player.id!));
    radarSelectionInitializedRef.current = true;
  }, [stats]);

  useEffect(() => {
    if (!stats || loading) return;
    const timer = window.setTimeout(() => {
      setShowDetailedStats(true);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [loading, modeFilter, stats]);

  const resolvedSelectedRadarPlayerIds = useMemo(() => {
    if (!stats) return [];
    const playerIdSet = new Set(stats.players.map((player) => player.id));
    return selectedRadarPlayerIds.filter((id) => playerIdSet.has(id));
  }, [selectedRadarPlayerIds, stats]);

  const toggleRadarPlayer = (playerId: number) => {
    setSelectedRadarPlayerIds((prev) =>
      prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId],
    );
  };

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

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Analytics"
          title="통계"
          description="내전 누적 승률, 챔피언 메타, 플레이어 성향, 3인 조합을 분석합니다."
          actions={modeToggle}
        />
        <Card title="통계 계산 중">
          <div className="py-5 text-center">
            <div className="text-lol-gold">통계 로딩 중...</div>
            {slowLoad && (
              <div className="mt-2 text-sm text-lol-gold-light/45">
                데이터가 많아 계산이 길어지고 있습니다. 완료되면 기본 지표부터 먼저 표시합니다.
              </div>
            )}
          </div>
        </Card>
      </div>
    );
  }

  if (!stats || loadError) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Analytics"
          title="통계"
          description="내전 누적 승률, 챔피언 메타, 플레이어 성향, 3인 조합을 분석합니다."
          actions={modeToggle}
        />
        <EmptyState
          title="통계를 불러오지 못했습니다."
          description="데이터가 손상되었거나 일시적으로 IndexedDB 조회가 실패했습니다. 새로고침 후에도 반복되면 설정에서 백업/복원을 확인하세요."
        />
      </div>
    );
  }

  if (stats.wrStats.totalGames === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Analytics"
          title="통계"
          description="내전 누적 승률, 챔피언 메타, 플레이어 성향, 3인 조합을 분석합니다."
          actions={modeToggle}
        />
        <EmptyState
          title={modeFilter === 'all' ? '게임 기록이 없습니다.' : `${GAME_MODE_LABELS[modeFilter as GameMode]} 모드 기록이 없습니다.`}
          description="내전을 진행한 후 통계를 확인하세요."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Analytics"
        title="통계"
        description="내전 누적 승률, 챔피언 메타, 플레이어 성향, 3인 조합을 분석합니다."
        meta={(
          <>
            <StatusPill tone="gold">{stats.wrStats.totalGames}게임</StatusPill>
            <StatusPill tone="blue">{stats.players.length}명</StatusPill>
            <StatusPill tone={modeFilter === 'augmented' ? 'purple' : 'muted'}>
              {modeFilter === 'all' ? '전체 모드' : GAME_MODE_LABELS[modeFilter as GameMode]}
            </StatusPill>
            {eogLoading && <StatusPill tone="blue">전투 로그 로딩</StatusPill>}
          </>
        )}
        actions={modeToggle}
      />

      {/* Summary dashboard */}
      {(() => {
        const sideTotal = stats.sideStats.total || 1;
        const t1Wr = (stats.sideStats.team1Wins / sideTotal) * 100;
        const t2Wr = (stats.sideStats.team2Wins / sideTotal) * 100;
        const t1Better = t1Wr >= t2Wr;
        const hotChampion = [...stats.champCompare]
          .sort((a, b) => (b.internalPicks + b.internalBans) - (a.internalPicks + a.internalBans))[0];
        return (
          <div className="rounded-xl border border-lol-gold/20 bg-[linear-gradient(135deg,rgba(200,155,60,0.13),rgba(10,20,40,0.65))] p-3.5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.25em] text-lol-gold-light/35">Inhouse Overview</div>
                <div className="mt-1 text-xl font-bold text-lol-gold">요약 대시보드</div>
              </div>
              <div className="rounded-full border border-lol-border bg-lol-dark/45 px-3 py-1 text-xs text-lol-gold-light/55">
                {modeFilter === 'all' ? '전체 모드' : GAME_MODE_LABELS[modeFilter as GameMode]}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-lol-border/70 bg-lol-dark/45 p-3">
                <div className="text-xs text-lol-gold-light/45">총 게임</div>
                <div className="mt-1 text-2xl font-black text-lol-gold">{stats.wrStats.totalGames}</div>
              </div>
              <div className="rounded-lg border border-lol-border/70 bg-lol-dark/45 p-3">
                <div className="text-xs text-lol-gold-light/45">플레이어</div>
                <div className="mt-1 text-2xl font-black text-lol-gold">{stats.players.length}</div>
              </div>
              <div className="rounded-lg border border-lol-border/70 bg-lol-dark/45 p-3">
                <div className="text-xs text-lol-gold-light/45">핫 챔피언</div>
                <div className="mt-1 truncate text-2xl font-black text-lol-gold">{hotChampion?.nameKo ?? '-'}</div>
                <div className="text-[10px] text-lol-gold-light/40">
                  {hotChampion ? `${hotChampion.internalPicks}픽 · ${hotChampion.internalBans}밴` : '기록 없음'}
                </div>
              </div>
              <div className="rounded-lg border border-lol-border/70 bg-lol-dark/45 p-3">
                <div className="text-xs text-lol-gold-light/45">EOG 수집</div>
                <div className="mt-1 text-2xl font-black text-lol-gold">{stats.eogOverview.capturedGames}</div>
                <div className="text-[10px] text-lol-gold-light/40">{stats.eogOverview.participantRows}명 통계</div>
              </div>
            </div>
            <div className="mt-3 rounded-lg border border-lol-border/60 bg-lol-dark/35 p-3">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className={t1Better ? 'text-blue-300' : 'text-blue-400/70'}>Team 1 {Math.round(t1Wr)}%</span>
                <span className={!t1Better ? 'text-red-300' : 'text-red-400/70'}>Team 2 {Math.round(t2Wr)}%</span>
              </div>
              <div className="flex h-3 overflow-hidden rounded-full bg-lol-blue">
                <div className="bg-blue-500/85" style={{ width: `${t1Wr}%` }} />
                <div className="bg-red-500/85" style={{ width: `${t2Wr}%` }} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-lol-gold-light/40">
                <div>
                  T1 {stats.sideStats.team1Wins}W / {stats.sideStats.total - stats.sideStats.team1Wins}L
                </div>
                <div className="text-right">
                  T2 {stats.sideStats.team2Wins}W / {stats.sideStats.total - stats.sideStats.team2Wins}L
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <Card title="EOG 전투 지표">
        {eogLoading && stats.eogOverview.capturedGames === 0 ? (
          <p className="text-sm text-lol-gold-light/50">
            승률/픽밴 통계를 먼저 표시했습니다. 딜량, 받은 피해, CC 같은 전투 로그는 백그라운드에서 불러오는 중입니다.
          </p>
        ) : stats.eogOverview.capturedGames === 0 ? (
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
                <div className="text-xs text-lol-gold-light/55 mb-2">전방/효율 평균</div>
                <div className="space-y-1 text-sm text-lol-gold-light/75">
                  <div>전방 기여 {Math.round(stats.eogOverview.avgFrontlineContribution).toLocaleString('ko-KR')}</div>
                  <div>골드 효율 {stats.eogOverview.avgGoldEfficiency.toFixed(2)}</div>
                  <div>KDA 관여 {stats.eogOverview.avgKdaParticipation.toFixed(2)}</div>
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

      <div>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-lol-gold">플레이어 능력치 레이더</h2>
            <p className="text-sm text-lol-gold-light/45">
              이 선택 버튼 하나로 기본 능력치, 역할별 승률, 플레이스타일을 같이 비교합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {stats.players.map((player, index) => {
              const playerId = player.id!;
              const selected = resolvedSelectedRadarPlayerIds.includes(playerId);
              const color = ['#c89b3c', '#3b82f6', '#ef4444', '#22c55e', '#a855f7', '#f97316', '#06b6d4'][index % 7];
              return (
                <button
                  key={playerId}
                  onClick={() => toggleRadarPlayer(playerId)}
                  className={`cursor-pointer rounded border px-3 py-1 text-sm transition-colors ${
                    selected
                      ? 'bg-lol-gold/20 text-lol-gold'
                      : 'border-lol-border text-lol-gold-light/50 hover:border-lol-gold/50'
                  }`}
                  style={selected ? { borderColor: color, color } : {}}
                >
                  {player.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          <PlayerRadar stats={stats} compact selectedIds={resolvedSelectedRadarPlayerIds} onTogglePlayer={toggleRadarPlayer} hideSelector />
          <PlayerRoleRadar stats={stats} compact selectedIds={resolvedSelectedRadarPlayerIds} onTogglePlayer={toggleRadarPlayer} hideSelector />
          <PlayerStyleRadar
            stats={stats}
            compact
            selectedIds={resolvedSelectedRadarPlayerIds}
            onTogglePlayer={toggleRadarPlayer}
            hideSelector
          />
        </div>
      </div>

      {/* Player Ranking */}
      <PlayerRanking stats={stats} />

      {showDetailedStats ? (
        <>
          <TrioRadar stats={stats} chartHeight={390} />

          {/* Streak + Trend */}
          <PlayerStreak stats={stats} />
          <PlayerTrend stats={stats} />

          {/* Role Distribution */}
          <RoleDistribution stats={stats} />

          <ChampionPowerRanking stats={stats} />

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
        </>
      ) : (
        <Card title="상세 통계 준비 중">
          <p className="py-4 text-center text-sm text-lol-gold-light/45">
            기본 지표를 먼저 표시했습니다. 조합, 챔피언 메타, 상대전적 차트는 잠시 후 이어서 렌더링됩니다.
          </p>
        </Card>
      )}
    </div>
  );
}
