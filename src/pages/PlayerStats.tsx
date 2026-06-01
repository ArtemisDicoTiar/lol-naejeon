import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChampionIcon } from '@/components/champions/ChampionIcon';
import { CombatRadar } from '@/components/stats/CombatRadar';
import { Card } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/Page';
import { GAME_MODE_LABELS, type Champion, type GameMode } from '@/lib/db';
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

function signedPercent(value: number) {
  return `${value >= 0 ? '+' : ''}${formatDecimal(value)}%`;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function championStub(entry: { championId: string; championNameKo: string; championImageUrl: string }): Champion {
  return {
    id: entry.championId,
    nameKo: entry.championNameKo,
    imageUrl: entry.championImageUrl,
    tags: [],
    damageType: 'HYBRID',
    aramRole: 'utility',
    aramTier: 'B',
    aramWinrate: 50,
    patchVersion: '',
  };
}

function MetricTile({
  label,
  value,
  sub,
  tone = 'gold',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'gold' | 'green' | 'red' | 'blue';
}) {
  const toneClass = {
    gold: 'text-lol-gold',
    green: 'text-prof-high',
    red: 'text-red-300',
    blue: 'text-blue-300',
  }[tone];

  return (
    <div className="rounded-lg border border-lol-border/70 bg-lol-dark/42 p-2.5">
      <div className="text-[11px] text-lol-gold-light/45">{label}</div>
      <div className={`mt-0.5 text-lg font-black leading-tight ${toneClass}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-lol-gold-light/40">{sub}</div>}
    </div>
  );
}

function MiniMeter({
  label,
  value,
  right,
  color = 'bg-lol-gold',
}: {
  label: string;
  value: number;
  right?: string;
  color?: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-lol-gold-light/55">{label}</span>
        {right && <span className="text-lol-gold-light/40">{right}</span>}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-lol-blue">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${clampPercent(value)}%` }} />
      </div>
    </div>
  );
}

export function PlayerStats() {
  const { players, loading: playersLoading } = usePlayers();
  const { userId } = useIdentityContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const [profile, setProfile] = useState<PlayerProfileStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

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
    setLoadError(false);
    const filter = modeFilter === 'all' ? undefined : modeFilter;
    computePlayerProfile(selectedPlayerId, filter)
      .then((nextProfile) => {
        setProfile(nextProfile);
      })
      .catch((error) => {
        console.error('Failed to load player profile:', error);
        setProfile(null);
        setLoadError(true);
      })
      .finally(() => {
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
    <div className="flex flex-wrap gap-2">
      {([
        { k: 'all' as ModeFilter, label: '전체' },
        { k: 'aram' as ModeFilter, label: GAME_MODE_LABELS.aram },
        { k: 'augmented' as ModeFilter, label: GAME_MODE_LABELS.augmented },
      ]).map((opt) => (
        <button
          key={opt.k}
          onClick={() => setParam('mode', opt.k)}
          className={`cursor-pointer rounded border px-3 py-1 text-sm transition-colors ${
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

  const modeLabel = modeFilter === 'all' ? '전체 모드' : GAME_MODE_LABELS[modeFilter];

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-xl border border-lol-gold/25 bg-[radial-gradient(circle_at_15%_20%,rgba(200,155,60,0.18),transparent_30%),linear-gradient(135deg,#010a13_0%,#0a1428_52%,#1e2328_100%)] p-4 shadow-xl shadow-black/25 md:p-5">
        <div className="absolute -right-16 -top-20 h-52 w-52 rounded-full border border-lol-gold/20 bg-lol-gold/5 blur-sm" />
        <div className="absolute bottom-2 right-6 hidden text-6xl font-black tracking-[-0.12em] text-lol-gold/5 lg:block">PLAYER</div>
        <div className="relative flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-3 flex flex-wrap gap-2">
              <StatusPill tone="gold">
                Player Dossier
              </StatusPill>
              <StatusPill>
                {modeLabel}
              </StatusPill>
            </div>
            <h1 className="text-3xl font-black tracking-tight text-lol-gold md:text-4xl">
              {profile?.player.name ?? '유저 통계'}
            </h1>
            <p className="mt-2.5 max-w-2xl text-sm leading-6 text-lol-gold-light/65">
              선수별 승률, 최근 흐름, 주력 챔피언, 종료 후 전투 지표를 한 페이지에서 확인합니다.
            </p>
          </div>

          <div className="w-full max-w-3xl rounded-lg border border-lol-gold/20 bg-lol-dark/45 p-3">
            <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <label htmlFor="player-stats-select" className="text-sm text-lol-gold-light/70">선수</label>
                <select
                  id="player-stats-select"
                  value={selectedPlayerId || ''}
                  onChange={(event) => setParam('player', event.target.value)}
                  className="min-w-[200px] rounded border border-lol-border bg-lol-blue px-3 py-2 text-sm text-lol-gold-light cursor-pointer focus:border-lol-gold focus:outline-none"
                >
                  {sortedPlayers.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                    </option>
                  ))}
                </select>
              </div>
              {modeToggle}
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-lol-gold">유저 통계 로딩 중...</div>
      ) : loadError || !profile ? (
        <Card>
          <p className="text-center py-8 text-lol-gold-light/50">
            유저 통계를 불러오지 못했습니다. 새로고침 후에도 반복되면 기록 데이터를 확인하세요.
          </p>
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="space-y-4">
              <div className="grid gap-3 xl:grid-cols-[minmax(210px,240px)_minmax(220px,1fr)_minmax(260px,1.05fr)_minmax(220px,1fr)]">
                <div className="flex flex-col items-center justify-center rounded-xl border border-lol-gold/20 bg-lol-dark/45 p-4 text-center">
                  <div
                    className="grid h-32 w-32 place-items-center rounded-full p-1.5"
                    style={{
                      background: `conic-gradient(#c89b3c ${clampPercent(profile.winrate) * 3.6}deg, rgba(70,55,20,0.8) 0deg)`,
                    }}
                  >
                    <div className="grid h-full w-full place-items-center rounded-full bg-lol-dark">
                      <div>
                        <div className="text-xs text-lol-gold-light/45">승률</div>
                        <div className="text-3xl font-black text-lol-gold">{formatDecimal(profile.winrate)}%</div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 text-base font-bold text-lol-gold-light">{profile.player.name}</div>
                  <div className="mt-1 text-sm text-lol-gold-light/45">
                    {profile.totalGames}전 · {profile.wins}승 {profile.losses}패
                  </div>
                  <div className="mt-3 grid w-full grid-cols-2 gap-2 text-xs">
                    <div className="rounded border border-lol-border/60 bg-lol-blue/40 px-2 py-2 text-lol-gold-light/65">
                      챔프폭 <span className="font-bold text-lol-gold">{profile.uniqueChampions}</span>
                    </div>
                    <div className="rounded border border-lol-border/60 bg-lol-blue/40 px-2 py-2 text-lol-gold-light/65">
                      EOG <span className="font-bold text-lol-gold">{profile.eogGames}</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <MetricTile label="최근 폼" value={`${formatDecimal(profile.recentWinrate)}%`} sub={`${profile.recentWins}승 ${profile.recentLosses}패`} />
                  <MetricTile
                    label="현재 흐름"
                    value={profile.streakType ? `${profile.streakCount}${profile.streakType === 'W' ? '연승' : '연패'}` : '-'}
                    tone={profile.streakType === 'W' ? 'green' : profile.streakType === 'L' ? 'red' : 'gold'}
                  />
                  <MetricTile
                    label="최근 편차"
                    value={signedPercent(profile.trendDelta)}
                    tone={profile.trendDelta >= 0 ? 'green' : 'red'}
                  />
                  <MetricTile
                    label="평균 KDA"
                    value={`${formatDecimal(profile.avgKills)} / ${formatDecimal(profile.avgDeaths)} / ${formatDecimal(profile.avgAssists)}`}
                    sub={`관여 ${formatDecimal(profile.avgKdaParticipation)}`}
                    tone="blue"
                  />
                </div>

                <div className="rounded-xl border border-lol-border/70 bg-lol-dark/35 p-3">
                  <div className="mb-2 text-sm font-medium text-lol-gold">핵심 지표</div>
                  <div className="space-y-2.5">
                    <MiniMeter label="시즌 승률" value={profile.winrate} right={`${profile.wins}W / ${profile.losses}L`} color="bg-lol-gold" />
                    <MiniMeter label="최근 폼" value={profile.recentWinrate} right={`${profile.recentGames}게임`} color="bg-prof-high" />
                    <MiniMeter label="폼 편차" value={50 + profile.trendDelta} right={signedPercent(profile.trendDelta)} color={profile.trendDelta >= 0 ? 'bg-prof-high' : 'bg-red-400'} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <MetricTile label="평균 딜량" value={formatNumber(profile.avgDamageDealtToChampions)} />
                  <MetricTile label="받은 피해" value={formatNumber(profile.avgDamageTaken)} />
                  <MetricTile label="전방 기여" value={formatNumber(profile.avgFrontlineContribution)} />
                  <MetricTile label="CC 시간" value={formatNumber(profile.avgTimeCCingOthers)} />
                  <MetricTile label="골드 효율" value={formatDecimal(profile.avgGoldEfficiency)} />
                  <MetricTile label="힐량" value={formatNumber(profile.avgTotalHeal)} />
                </div>
              </div>

              <CombatRadar
                title="전투 지표 레이더"
                description="현재 필터 기준 전체 평균과 비교합니다."
                series={combatRadarSeries}
                emptyMessage="전투 로그가 충분하지 않아 레이더를 그릴 수 없습니다."
                chartHeight={260}
              />
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <Card title="주력 챔피언">
              {profile.topChampions.length === 0 ? (
                <p className="text-sm text-lol-gold-light/50">아직 이 선수의 경기 기록이 없습니다.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {profile.topChampions.slice(0, 6).map((entry, index) => {
                    const champion = championStub(entry);
                    return (
                      <div key={entry.championId} className="relative overflow-hidden rounded-xl border border-lol-border/70 bg-lol-dark/40 p-3">
                        <div className="absolute right-2 top-2 text-4xl font-black text-lol-gold/5">#{index + 1}</div>
                        <div className="relative flex items-center gap-3">
                          <ChampionIcon champion={champion} size="sm" />
                          <div className="min-w-0">
                            <div className="truncate font-bold text-lol-gold">{entry.championNameKo}</div>
                            <div className="text-xs text-lol-gold-light/45">{entry.games}전 {entry.wins}승 {entry.losses}패</div>
                          </div>
                        </div>
                        <div className="mt-3">
                          <MiniMeter label="승률" value={entry.winrate} right={`${formatDecimal(entry.winrate)}%`} color="bg-lol-gold" />
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded bg-lol-blue/40 p-2">
                            <div className="text-lol-gold-light/40">평균 KDA</div>
                            <div className="font-semibold text-lol-gold">
                              {formatDecimal(entry.avgKills)} / {formatDecimal(entry.avgDeaths)} / {formatDecimal(entry.avgAssists)}
                            </div>
                          </div>
                          <div className="rounded bg-lol-blue/40 p-2">
                            <div className="text-lol-gold-light/40">평균 딜량</div>
                            <div className="font-semibold text-lol-gold">{formatNumber(entry.avgDamageDealtToChampions)}</div>
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
                <div className="space-y-4">
                  {profile.roleStats.map((entry) => (
                    <div key={entry.role} className="rounded border border-lol-border/60 bg-lol-dark/35 p-3">
                      <MiniMeter
                        label={entry.label}
                        value={entry.winrate}
                        right={`${entry.games}전 · ${entry.wins}승 · ${formatDecimal(entry.winrate)}%`}
                        color="bg-gradient-to-r from-lol-gold/80 to-prof-high/80"
                      />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <Card title="최근 경기">
            {profile.recentMatches.length === 0 ? (
              <p className="text-sm text-lol-gold-light/50">최근 경기 기록이 없습니다.</p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {profile.recentMatches.map((match) => {
                  const champion = championStub(match);
                  const isWin = match.result === 'W';
                  const isLoss = match.result === 'L';
                  return (
                    <div key={match.gameId} className={`rounded-xl border bg-lol-dark/40 p-3 ${
                      isWin
                        ? 'border-prof-high/30'
                        : isLoss
                          ? 'border-red-700/35'
                          : 'border-lol-border/70'
                    }`}>
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-lg text-sm font-black ${
                            isWin
                              ? 'bg-prof-high/15 text-prof-high'
                              : isLoss
                                ? 'bg-red-900/25 text-red-300'
                                : 'bg-lol-blue text-lol-gold-light/65'
                          }`}>
                            {match.result}
                          </div>
                          <ChampionIcon champion={champion} size="sm" />
                          <div>
                            <div className="font-bold text-lol-gold">{match.championNameKo}</div>
                            <div className="text-xs text-lol-gold-light/45">
                              {GAME_MODE_LABELS[match.mode]} · {match.format} · Game #{match.gameNumber}
                            </div>
                          </div>
                        </div>
                        <div className="text-xs text-lol-gold-light/35">
                          {match.playedAt.toLocaleString('ko-KR')}
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
                        <div className="rounded bg-lol-blue/35 p-2">
                          <div className="text-lol-gold-light/40">KDA</div>
                          <div className="font-semibold text-lol-gold">
                            {match.kills === null ? '-' : `${match.kills} / ${match.deaths} / ${match.assists}`}
                          </div>
                        </div>
                        <div className="rounded bg-lol-blue/35 p-2">
                          <div className="text-lol-gold-light/40">딜량</div>
                          <div className="font-semibold text-lol-gold">
                            {match.totalDamageDealtToChampions === null ? '-' : formatNumber(match.totalDamageDealtToChampions)}
                          </div>
                        </div>
                        <div className="rounded bg-lol-blue/35 p-2">
                          <div className="text-lol-gold-light/40">받은 피해</div>
                          <div className="font-semibold text-lol-gold">
                            {match.totalDamageTaken === null ? '-' : formatNumber(match.totalDamageTaken)}
                          </div>
                        </div>
                        <div className="rounded bg-lol-blue/35 p-2">
                          <div className="text-lol-gold-light/40">CC / 골드</div>
                          <div className="font-semibold text-lol-gold">
                            {match.timeCCingOthers === null ? '-' : `${formatNumber(match.timeCCingOthers)} / ${formatNumber(match.goldEarned ?? 0)}`}
                          </div>
                        </div>
                        <div className="rounded bg-lol-blue/35 p-2">
                          <div className="text-lol-gold-light/40">힐</div>
                          <div className="font-semibold text-lol-gold">
                            {match.totalHeal === null ? '-' : formatNumber(match.totalHeal)}
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
