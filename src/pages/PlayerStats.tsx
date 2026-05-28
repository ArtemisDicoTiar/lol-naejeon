import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChampionIcon } from '@/components/champions/ChampionIcon';
import { CombatRadar } from '@/components/stats/CombatRadar';
import { Card } from '@/components/ui/Card';
import { GAME_MODE_LABELS, type GameMode } from '@/lib/db';
import { computePlayerProfile, type PlayerProfileStats } from '@/lib/player-profile';
import { usePlayers } from '@/hooks/usePlayers';
import { useIdentityContext } from '@/App';

type ModeFilter = 'all' | GameMode;

function formatNumber(value: number) {
  return Math.round(value).toLocaleString('ko-KR');
}

function formatDecimal(value: number) {
  return value.toFixed(1);
}

export function PlayerStats() {
  const { players, loading: playersLoading } = usePlayers();
  const { userId } = useIdentityContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const [profile, setProfile] = useState<PlayerProfileStats | null>(null);
  const [loading, setLoading] = useState(true);

  const selectedPlayerId = Number(searchParams.get('player') ?? '');
  const rawMode = searchParams.get('mode');
  const modeFilter: ModeFilter = rawMode === 'aram' || rawMode === 'augmented' ? rawMode : 'all';

  const setParam = useCallback((key: 'player' | 'mode', value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set(key, value);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (playersLoading || players.length === 0) return;
    const hasSelectedPlayer = players.some((player) => player.id === selectedPlayerId);
    if (hasSelectedPlayer) return;

    const fallbackId = players.find((player) => player.id === userId)?.id ?? players[0].id;
    if (fallbackId) {
      const next = new URLSearchParams(searchParams);
      next.set('player', String(fallbackId));
      if (!next.get('mode')) next.set('mode', 'all');
      setSearchParams(next, { replace: true });
    }
  }, [players, playersLoading, searchParams, selectedPlayerId, setSearchParams, userId]);

  const loadProfile = useCallback(() => {
    if (!selectedPlayerId || !players.some((player) => player.id === selectedPlayerId)) {
      setProfile(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const filter = modeFilter === 'all' ? undefined : modeFilter;
    computePlayerProfile(selectedPlayerId, filter).then((nextProfile) => {
      setProfile(nextProfile);
      setLoading(false);
    });
  }, [modeFilter, players, selectedPlayerId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { loadProfile(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProfile]);

  useEffect(() => {
    const handleDataChanged = () => { loadProfile(); };
    window.addEventListener('lol-data-changed', handleDataChanged);
    return () => window.removeEventListener('lol-data-changed', handleDataChanged);
  }, [loadProfile]);

  const sortedPlayers = [...players].sort((a, b) => a.name.localeCompare(b.name, 'ko-KR'));
  const combatRadarSeries = useMemo(() => {
    if (!profile) return [];
    return [
      {
        key: 'player',
        label: profile.player.name,
        color: '#c89b3c',
        metrics: {
          damage: profile.avgDamageDealtToChampions,
          frontline: profile.avgFrontlineContribution,
          heal: profile.avgTotalHeal,
          cc: profile.avgTimeCCingOthers,
          kda: profile.avgKdaParticipation,
          goldEfficiency: profile.avgGoldEfficiency,
        },
      },
      {
        key: 'average',
        label: '전체 평균',
        color: '#3b82f6',
        metrics: profile.overallCombatAverages,
      },
    ];
  }, [profile]);

  const modeToggle = (
    <div className="flex gap-2 flex-wrap">
      {([
        { k: 'all' as ModeFilter, label: '전체' },
        { k: 'aram' as ModeFilter, label: GAME_MODE_LABELS.aram },
        { k: 'augmented' as ModeFilter, label: GAME_MODE_LABELS.augmented },
      ]).map((opt) => (
        <button
          key={opt.k}
          onClick={() => setParam('mode', opt.k)}
          className={`cursor-pointer px-3 py-1 rounded text-sm border transition-colors ${
            modeFilter === opt.k
              ? (opt.k === 'augmented'
                ? 'border-purple-400 bg-purple-900/30 text-purple-300'
                : 'border-lol-gold bg-lol-gold/20 text-lol-gold')
              : 'border-lol-border text-lol-gold-light/50 hover:border-lol-gold/50'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  if (playersLoading) {
    return <div className="text-center py-8 text-lol-gold">선수 목록 로딩 중...</div>;
  }

  if (players.length === 0) {
    return (
      <Card>
        <p className="text-center py-8 text-lol-gold-light/50">
          등록된 선수가 없습니다. 먼저 선수 관리에서 선수 목록을 추가하세요.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-lol-gold">유저 통계</h1>
          <p className="text-sm text-lol-gold-light/55">현재 로그인 사용자에 고정하지 않고 원하는 선수를 골라서 OPGG 스타일로 확인합니다.</p>
        </div>
        {modeToggle}
      </div>

      <Card>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <label htmlFor="player-stats-select" className="text-sm text-lol-gold-light/70">
              선수 선택
            </label>
            <select
              id="player-stats-select"
              value={selectedPlayerId || ''}
              onChange={(event) => setParam('player', event.target.value)}
              className="min-w-[220px] bg-lol-blue border border-lol-border rounded px-3 py-2 text-sm text-lol-gold-light cursor-pointer focus:outline-none focus:border-lol-gold"
            >
              {sortedPlayers.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                </option>
              ))}
            </select>
          </div>
          <div className="text-xs text-lol-gold-light/45">
            최근 경기, 주력 챔피언, 전투 지표는 수집된 내전 기록과 EOG 데이터 기준입니다.
          </div>
        </div>
      </Card>

      {loading || !profile ? (
        <div className="text-center py-8 text-lol-gold">유저 통계 로딩 중...</div>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.3em] text-lol-gold-light/35">Player Snapshot</div>
                  <h2 className="mt-2 text-3xl font-bold text-lol-gold">{profile.player.name}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-lol-gold-light/65">
                    <span>{profile.totalGames}전</span>
                    <span>{profile.wins}승 {profile.losses}패</span>
                    <span>{profile.uniqueChampions}챔피언 사용</span>
                    <span>{profile.eogGames}판 상세 전투 로그</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div className="rounded border border-lol-border/70 bg-lol-dark/40 p-3">
                    <div className="text-xs text-lol-gold-light/45">승률</div>
                    <div className="mt-1 text-3xl font-bold text-lol-gold">{formatDecimal(profile.winrate)}%</div>
                  </div>
                  <div className="rounded border border-lol-border/70 bg-lol-dark/40 p-3">
                    <div className="text-xs text-lol-gold-light/45">최근 폼</div>
                    <div className="mt-1 text-3xl font-bold text-lol-gold">{formatDecimal(profile.recentWinrate)}%</div>
                    <div className="text-xs text-lol-gold-light/45">{profile.recentWins}승 {profile.recentLosses}패</div>
                  </div>
                  <div className="rounded border border-lol-border/70 bg-lol-dark/40 p-3">
                    <div className="text-xs text-lol-gold-light/45">현재 흐름</div>
                    <div className={`mt-1 text-3xl font-bold ${profile.streakType === 'W' ? 'text-prof-high' : profile.streakType === 'L' ? 'text-red-300' : 'text-lol-gold'}`}>
                      {profile.streakType ? `${profile.streakType}${profile.streakCount}` : '-'}
                    </div>
                  </div>
                  <div className="rounded border border-lol-border/70 bg-lol-dark/40 p-3">
                    <div className="text-xs text-lol-gold-light/45">최근 편차</div>
                    <div className={`mt-1 text-3xl font-bold ${profile.trendDelta >= 0 ? 'text-prof-high' : 'text-red-300'}`}>
                      {profile.trendDelta >= 0 ? '+' : ''}{formatDecimal(profile.trendDelta)}%
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded border border-lol-border/70 bg-lol-dark/40 p-4">
                  <div className="text-xs text-lol-gold-light/45">평균 KDA</div>
                  <div className="mt-2 text-lg font-semibold text-lol-gold">
                    {formatDecimal(profile.avgKills)} / {formatDecimal(profile.avgDeaths)} / {formatDecimal(profile.avgAssists)}
                  </div>
                </div>
                <div className="rounded border border-lol-border/70 bg-lol-dark/40 p-4">
                  <div className="text-xs text-lol-gold-light/45">평균 챔피언 피해</div>
                  <div className="mt-2 text-lg font-semibold text-lol-gold">{formatNumber(profile.avgDamageDealtToChampions)}</div>
                </div>
                <div className="rounded border border-lol-border/70 bg-lol-dark/40 p-4">
                  <div className="text-xs text-lol-gold-light/45">평균 받은 피해</div>
                  <div className="mt-2 text-lg font-semibold text-lol-gold">{formatNumber(profile.avgDamageTaken)}</div>
                </div>
                <div className="rounded border border-lol-border/70 bg-lol-dark/40 p-4">
                  <div className="text-xs text-lol-gold-light/45">평균 힐 / 실드</div>
                  <div className="mt-2 text-lg font-semibold text-lol-gold">
                    {formatNumber(profile.avgTotalHeal)} / {formatNumber(profile.avgTotalShielded)}
                  </div>
                </div>
                <div className="rounded border border-lol-border/70 bg-lol-dark/40 p-4">
                  <div className="text-xs text-lol-gold-light/45">평균 CC 시간</div>
                  <div className="mt-2 text-lg font-semibold text-lol-gold">{formatNumber(profile.avgTimeCCingOthers)}</div>
                </div>
                <div className="rounded border border-lol-border/70 bg-lol-dark/40 p-4">
                  <div className="text-xs text-lol-gold-light/45">평균 사망 시간</div>
                  <div className="mt-2 text-lg font-semibold text-lol-gold">{formatNumber(profile.avgTimeSpentDead)}</div>
                </div>
              </div>
            </div>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <Card title="주력 챔피언">
              {profile.topChampions.length === 0 ? (
                <p className="text-sm text-lol-gold-light/50">아직 이 선수의 경기 기록이 없습니다.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {profile.topChampions.slice(0, 6).map((entry) => {
                    const champion = {
                      id: entry.championId,
                      nameKo: entry.championNameKo,
                      imageUrl: entry.championImageUrl,
                      tags: [],
                      damageType: 'HYBRID' as const,
                      aramRole: 'utility' as const,
                      aramTier: 'B' as const,
                      aramWinrate: 50,
                      patchVersion: '',
                    };
                    return (
                      <div key={entry.championId} className="rounded border border-lol-border/70 bg-lol-dark/40 p-3">
                        <div className="flex items-center gap-3">
                          <ChampionIcon champion={champion} size="sm" />
                          <div className="min-w-0">
                            <div className="font-medium text-lol-gold">{entry.championNameKo}</div>
                            <div className="text-xs text-lol-gold-light/45">{entry.games}전 {entry.wins}승 {entry.losses}패</div>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <div className="text-lol-gold-light/40">승률</div>
                            <div className="font-semibold text-lol-gold">{formatDecimal(entry.winrate)}%</div>
                          </div>
                          <div>
                            <div className="text-lol-gold-light/40">평균 KDA</div>
                            <div className="font-semibold text-lol-gold">
                              {formatDecimal(entry.avgKills)} / {formatDecimal(entry.avgDeaths)} / {formatDecimal(entry.avgAssists)}
                            </div>
                          </div>
                          <div>
                            <div className="text-lol-gold-light/40">평균 딜량</div>
                            <div className="font-semibold text-lol-gold">{formatNumber(entry.avgDamageDealtToChampions)}</div>
                          </div>
                          <div>
                            <div className="text-lol-gold-light/40">평균 받은 피해</div>
                            <div className="font-semibold text-lol-gold">{formatNumber(entry.avgDamageTaken)}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card title="역할 성향">
              {profile.roleStats.length === 0 ? (
                <p className="text-sm text-lol-gold-light/50">역할별 집계를 표시할 기록이 없습니다.</p>
              ) : (
                <div className="space-y-3">
                  {profile.roleStats.map((entry) => (
                    <div key={entry.role} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-lol-gold-light/80">{entry.label}</span>
                        <span className="text-lol-gold-light/55">{entry.games}전 {entry.wins}승</span>
                      </div>
                      <div className="h-2 rounded-full bg-lol-dark/70 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-lol-gold/70 to-prof-high/70"
                          style={{ width: `${Math.max(entry.winrate, 6)}%` }}
                        />
                      </div>
                      <div className="text-right text-xs text-lol-gold">{formatDecimal(entry.winrate)}%</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <CombatRadar
            title="전투 지표 레이더"
            description="선택한 선수의 딜량, 전방 기여, 힐량, CC, KDA 관여, 골드 효율을 현재 필터 기준 전체 평균과 비교합니다."
            series={combatRadarSeries}
            emptyMessage="전투 로그가 충분하지 않아 레이더를 그릴 수 없습니다."
          />

          <Card title="최근 경기">
            {profile.recentMatches.length === 0 ? (
              <p className="text-sm text-lol-gold-light/50">최근 경기 기록이 없습니다.</p>
            ) : (
              <div className="space-y-3">
                {profile.recentMatches.map((match) => {
                  const champion = {
                    id: match.championId,
                    nameKo: match.championNameKo,
                    imageUrl: match.championImageUrl,
                    tags: [],
                    damageType: 'HYBRID' as const,
                    aramRole: 'utility' as const,
                    aramTier: 'B' as const,
                    aramWinrate: 50,
                    patchVersion: '',
                  };
                  return (
                    <div key={match.gameId} className="rounded border border-lol-border/70 bg-lol-dark/40 p-3">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-14 shrink-0 rounded px-2 py-2 text-center text-sm font-bold ${
                            match.result === 'W'
                              ? 'bg-prof-high/15 text-prof-high'
                              : match.result === 'L'
                                ? 'bg-red-900/25 text-red-300'
                                : 'bg-lol-blue text-lol-gold-light/65'
                          }`}>
                            {match.result}
                          </div>
                          <ChampionIcon champion={champion} size="sm" />
                          <div>
                            <div className="font-medium text-lol-gold">{match.championNameKo}</div>
                            <div className="text-xs text-lol-gold-light/45">
                              {GAME_MODE_LABELS[match.mode]} · {match.format} · #{match.gameNumber}
                            </div>
                          </div>
                        </div>
                        <div className="text-xs text-lol-gold-light/45">
                          {match.playedAt.toLocaleString('ko-KR')}
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
                        <div>
                          <div className="text-lol-gold-light/40">KDA</div>
                          <div className="font-semibold text-lol-gold">
                            {match.kills === null ? '-' : `${match.kills} / ${match.deaths} / ${match.assists}`}
                          </div>
                        </div>
                        <div>
                          <div className="text-lol-gold-light/40">딜량</div>
                          <div className="font-semibold text-lol-gold">
                            {match.totalDamageDealtToChampions === null ? '-' : formatNumber(match.totalDamageDealtToChampions)}
                          </div>
                        </div>
                        <div>
                          <div className="text-lol-gold-light/40">받은 피해</div>
                          <div className="font-semibold text-lol-gold">
                            {match.totalDamageTaken === null ? '-' : formatNumber(match.totalDamageTaken)}
                          </div>
                        </div>
                        <div>
                          <div className="text-lol-gold-light/40">힐 / 실드</div>
                          <div className="font-semibold text-lol-gold">
                            {match.totalHeal === null ? '-' : `${formatNumber(match.totalHeal)} / ${formatNumber(match.totalDamageShieldedOnTeammates ?? 0)}`}
                          </div>
                        </div>
                        <div>
                          <div className="text-lol-gold-light/40">CC / 골드</div>
                          <div className="font-semibold text-lol-gold">
                            {match.timeCCingOthers === null ? '-' : `${formatNumber(match.timeCCingOthers)} / ${formatNumber(match.goldEarned ?? 0)}`}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
