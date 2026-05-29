import { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '@/hooks/useSession';
import { usePlayers } from '@/hooks/usePlayers';
import { useChampions } from '@/hooks/useChampions';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useIdentityContext, useLcuContext } from '@/App';
import { computeFullStats, type FullStats } from '@/lib/stats';
import { DashboardPresenceBars } from '@/components/dashboard/DashboardPresenceBars';
import { DashboardFormBoard } from '@/components/dashboard/DashboardFormBoard';
import { DashboardMvpCandidates } from '@/components/dashboard/DashboardMvpCandidates';

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatNumber(value: number) {
  return Math.round(value).toLocaleString('ko-KR');
}

export function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isMaster } = useIdentityContext();
  const lcu = useLcuContext();
  const { session, games, fierlessBans, loading: sessionLoading, createSession } = useSession();
  const { players } = usePlayers();
  const { champions, syncing } = useChampions();
  const [sessionName, setSessionName] = useState('');
  const [creating, setCreating] = useState(false);
  const [stats, setStats] = useState<FullStats | null>(null);
  const autoNavigateRef = useRef(false);

  // Auto-navigate to new game when LCU detects champion select
  useEffect(() => {
    if (!lcu.champSelectActive) {
      autoNavigateRef.current = false;
      return;
    }
    if (
      lcu.connected &&
      !lcu.gameStartedAt &&
      session &&
      isMaster &&
      !autoNavigateRef.current &&
      location.pathname !== '/session/new-game'
    ) {
      autoNavigateRef.current = true;
      navigate('/session/new-game?fromLcu=true');
    }
  }, [lcu.champSelectActive, lcu.connected, lcu.gameStartedAt, location.pathname, session, isMaster, navigate]);

  useEffect(() => {
    let cancelled = false;
    const loadStats = async () => {
      const next = await computeFullStats();
      if (!cancelled) setStats(next);
    };
    void loadStats();
    const handleDataChanged = () => { void loadStats(); };
    window.addEventListener('lol-data-changed', handleDataChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('lol-data-changed', handleDataChanged);
    };
  }, []);

  const playerName = useMemo(() => {
    return new Map(players.map((player) => [player.id!, player.name]));
  }, [players]);

  const dashboardHighlights = useMemo(() => {
    if (!stats) return null;
    const topWinrate = Object.values(stats.wrStats.playerOverallStats)
      .filter((entry) => entry.totalPicks >= 3)
      .sort((a, b) => b.winrate - a.winrate || b.totalPicks - a.totalPicks)[0] ?? null;
    const damageKing = stats.playerEogSummary
      .filter((entry) => entry.games >= 1)
      .sort((a, b) => b.avgDamageDealtToChampions - a.avgDamageDealtToChampions)[0] ?? null;
    const hotChampion = [...stats.champCompare]
      .sort((a, b) => (b.internalPicks + b.internalBans) - (a.internalPicks + a.internalBans))[0] ?? null;
    const bestTrio = stats.trioPlayerSynergy[0] ?? null;
    const currentStreak = Object.entries(stats.playerStreak)
      .map(([id, streak]) => ({ playerId: Number(id), ...streak }))
      .filter((entry) => entry.type && entry.count > 0)
      .sort((a, b) => b.count - a.count)[0] ?? null;
    return { topWinrate, damageKing, hotChampion, bestTrio, currentStreak };
  }, [stats]);

  const completedSessionGames = games.filter((game) => game.winningTeam !== null);
  const team1Wins = completedSessionGames.filter((game) => game.winningTeam === 1).length;
  const team2Wins = completedSessionGames.filter((game) => game.winningTeam === 2).length;
  const globalSideTotal = stats?.sideStats.total ?? 0;
  const globalTeam1Wr = globalSideTotal > 0 ? ((stats?.sideStats.team1Wins ?? 0) / globalSideTotal) * 100 : 0;
  const globalTeam2Wr = globalSideTotal > 0 ? ((stats?.sideStats.team2Wins ?? 0) / globalSideTotal) * 100 : 0;
  const lcuStatus = lcu.connected ? (lcu.champSelectActive ? '챔셀 감지' : '클라 연결됨') : '클라 미연결';

  if (sessionLoading || syncing) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lol-gold">
          {syncing ? '챔피언 데이터 동기화 중...' : '로딩 중...'}
        </div>
      </div>
    );
  }

  const handleCreateSession = async () => {
    setCreating(true);
    try {
      await createSession(sessionName.trim() || undefined);
      setSessionName('');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-xl border border-lol-gold/30 bg-[radial-gradient(circle_at_15%_20%,rgba(200,155,60,0.18),transparent_28%),linear-gradient(135deg,#010a13_0%,#0a1428_55%,#1e2328_100%)] p-4 md:p-5 shadow-xl shadow-black/25">
        <div className="absolute -right-14 -top-16 h-48 w-48 rounded-full border border-lol-gold/20 bg-lol-gold/5 blur-sm" />
        <div className="absolute bottom-3 right-5 hidden text-7xl font-black tracking-[-0.12em] text-lol-gold/5 md:block">ARAM</div>
        <div className="relative grid gap-4 lg:grid-cols-[1.4fr_1fr] lg:items-end">
          <div>
            <div className="mb-3 flex flex-wrap gap-2">
              <span className="inline-flex rounded-full border border-lol-gold/30 bg-lol-dark/50 px-3 py-1 text-xs text-lol-gold-light/60">
                {new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
              </span>
              <span className={`inline-flex rounded-full border px-3 py-1 text-xs ${
                lcu.connected
                  ? lcu.champSelectActive
                    ? 'border-prof-high/40 bg-prof-high/10 text-prof-high'
                    : 'border-blue-500/40 bg-blue-950/30 text-blue-300'
                  : 'border-lol-border bg-lol-dark/50 text-lol-gold-light/45'
              }`}>
                {lcuStatus}
              </span>
              <span className="inline-flex rounded-full border border-lol-border bg-lol-dark/50 px-3 py-1 text-xs text-lol-gold-light/55">
                {session ? `${session.name} 진행중` : '활성 세션 없음'}
              </span>
            </div>
            <h1 className="text-3xl font-black tracking-tight text-lol-gold md:text-4xl">
              눈오는 헤네시스
            </h1>
            <p className="mt-2.5 max-w-2xl text-sm leading-6 text-lol-gold-light/65">
              우리끼리 하는 칼바람 내전 기록실. 밴픽, 피어리스 밴, 유저별 통계, LCU 종료 후 세부 지표까지 한 곳에 모읍니다.
            </p>
            <div className="mt-4 flex flex-wrap gap-2.5">
              {session ? (
                <>
                  <Link to="/session/new-game"><Button size="lg">새 게임 시작</Button></Link>
                  <Link to="/session"><Button variant="secondary" size="lg">현재 세션 보기</Button></Link>
                </>
              ) : (
                <Link to="/players"><Button variant="secondary" size="lg">선수 먼저 보기</Button></Link>
              )}
              <Link to="/stats"><Button variant="ghost" size="lg">누적 통계</Button></Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-lg border border-lol-gold/20 bg-lol-dark/45 p-3">
              <div className="text-xs text-lol-gold-light/45">누적 게임</div>
              <div className="mt-1 text-2xl font-black text-lol-gold">{stats?.wrStats.totalGames ?? 0}</div>
            </div>
            <div className="rounded-lg border border-lol-gold/20 bg-lol-dark/45 p-3">
              <div className="text-xs text-lol-gold-light/45">등록 선수</div>
              <div className="mt-1 text-2xl font-black text-lol-gold">{players.length}</div>
            </div>
            <div className="rounded-lg border border-blue-500/20 bg-blue-950/20 p-3">
              <div className="text-xs text-lol-gold-light/45">Team 1 누적</div>
              <div className="mt-1 text-xl font-black text-blue-300">{formatPercent(globalTeam1Wr)}</div>
            </div>
            <div className="rounded-lg border border-red-500/20 bg-red-950/20 p-3">
              <div className="text-xs text-lol-gold-light/45">Team 2 누적</div>
              <div className="mt-1 text-xl font-black text-red-300">{formatPercent(globalTeam2Wr)}</div>
            </div>
            <div className="col-span-2 rounded-lg border border-lol-gold/15 bg-lol-dark/45 p-3">
              <div className="mb-2 flex items-center justify-between text-xs text-lol-gold-light/45">
                <span>누적 진영 밸런스</span>
                <span>{globalSideTotal}게임</span>
              </div>
              <div className="flex h-3 overflow-hidden rounded-full bg-lol-blue">
                <div className="bg-blue-500/80" style={{ width: `${globalTeam1Wr}%` }} />
                <div className="bg-red-500/80" style={{ width: `${globalTeam2Wr}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-[10px] text-lol-gold-light/35">
                <span>현재 세션 T1 {team1Wins}승</span>
                <span>현재 세션 T2 {team2Wins}승</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {dashboardHighlights && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-xl border border-lol-border bg-lol-gray p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-lol-gold-light/35">Winrate Boss</div>
            <div className="mt-2 text-lg font-bold text-lol-gold">
              {dashboardHighlights.topWinrate ? playerName.get(dashboardHighlights.topWinrate.playerId) ?? '알 수 없음' : '기록 없음'}
            </div>
            <div className="text-sm text-lol-gold-light/55">
              {dashboardHighlights.topWinrate
                ? `${formatPercent(dashboardHighlights.topWinrate.winrate)} · ${dashboardHighlights.topWinrate.totalPicks}게임`
                : '3게임 이상 기록 필요'}
            </div>
          </div>
          <div className="rounded-xl border border-lol-border bg-lol-gray p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-lol-gold-light/35">Damage King</div>
            <div className="mt-2 text-lg font-bold text-lol-gold">
              {dashboardHighlights.damageKing ? playerName.get(dashboardHighlights.damageKing.playerId) ?? '알 수 없음' : '수집 대기'}
            </div>
            <div className="text-sm text-lol-gold-light/55">
              {dashboardHighlights.damageKing
                ? `평균 ${formatNumber(dashboardHighlights.damageKing.avgDamageDealtToChampions)} 딜`
                : 'EOG 세부통계 필요'}
            </div>
          </div>
          <div className="rounded-xl border border-lol-border bg-lol-gray p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-lol-gold-light/35">핫 챔피언</div>
            <div className="mt-2 text-lg font-bold text-lol-gold">
              {dashboardHighlights.hotChampion?.nameKo ?? '기록 없음'}
            </div>
            <div className="text-sm text-lol-gold-light/55">
              {dashboardHighlights.hotChampion
                ? `${dashboardHighlights.hotChampion.internalPicks}픽 · ${dashboardHighlights.hotChampion.internalBans}밴`
                : '픽/밴 기록 필요'}
            </div>
          </div>
          <div className="rounded-xl border border-lol-border bg-lol-gray p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-lol-gold-light/35">최고 3인 조합</div>
            <div className="mt-2 truncate text-lg font-bold text-lol-gold">
              {dashboardHighlights.bestTrio
                ? dashboardHighlights.bestTrio.playerIds.map((id) => playerName.get(id) ?? '알 수 없음').join(' · ')
                : '기록 없음'}
            </div>
            <div className="text-sm text-lol-gold-light/55">
              {dashboardHighlights.bestTrio
                ? `${formatPercent(dashboardHighlights.bestTrio.winrate)} · ${dashboardHighlights.bestTrio.sameTeamWins + dashboardHighlights.bestTrio.sameTeamLosses}게임`
                : '같은 팀 3게임 이상 필요'}
            </div>
          </div>
          <div className="rounded-xl border border-lol-border bg-lol-gray p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-lol-gold-light/35">현재 흐름</div>
            <div className={`mt-2 text-lg font-bold ${dashboardHighlights.currentStreak?.type === 'W' ? 'text-prof-high' : dashboardHighlights.currentStreak?.type === 'L' ? 'text-prof-low' : 'text-lol-gold'}`}>
              {dashboardHighlights.currentStreak ? playerName.get(dashboardHighlights.currentStreak.playerId) ?? '알 수 없음' : '기록 없음'}
            </div>
            <div className="text-sm text-lol-gold-light/55">
              {dashboardHighlights.currentStreak
                ? `${dashboardHighlights.currentStreak.count}${dashboardHighlights.currentStreak.type === 'W' ? '연승' : '연패'}`
                : '완료된 게임 필요'}
            </div>
          </div>
        </div>
      )}

      {stats && (
        <div className="grid gap-4 xl:grid-cols-3">
          <DashboardMvpCandidates stats={stats} />
          <DashboardPresenceBars stats={stats} />
          <DashboardFormBoard stats={stats} />
        </div>
      )}

      {/* No active session */}
      {!session && (
        <Card title="새 세션 시작">
          <p className="text-sm text-lol-gold-light/60 mb-4">
            내전을 시작하려면 새 세션을 만드세요. 세션 안에서 여러 게임을 진행하고, 피어리스 밴이 누적됩니다.
          </p>
          {!isMaster && (
            <p className="text-xs text-lol-gold-light/40 mb-4">
              이 세션은 브라우저에만 저장됩니다. 공식 기록은 마스터 계정에서 진행해 주세요.
            </p>
          )}
          <div className="flex gap-3">
            <input
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder={new Date().toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) + ' 내전'}
              className="flex-1 bg-lol-blue border border-lol-border rounded px-3 py-2 text-lol-gold-light placeholder:text-lol-gold-light/30 focus:outline-none focus:border-lol-gold"
            />
            <Button onClick={handleCreateSession} disabled={creating} size="lg">
              {creating ? '생성 중...' : '세션 시작'}
            </Button>
          </div>
        </Card>
      )}

      {/* Active session */}
      {session && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <div className="text-center">
                <div className="text-2xl font-bold text-lol-gold">{players.length}</div>
                <div className="text-sm text-lol-gold-light/60 mt-1">등록 선수</div>
              </div>
            </Card>
            <Card>
              <div className="text-center">
                <div className="text-2xl font-bold text-lol-gold">{games.length}</div>
                <div className="text-sm text-lol-gold-light/60 mt-1">세션 게임</div>
              </div>
            </Card>
            <Card>
              <div className="text-center">
                <div className="text-2xl font-bold text-tier-s">{fierlessBans.length}</div>
                <div className="text-sm text-lol-gold-light/60 mt-1">피어리스 밴</div>
              </div>
            </Card>
            <Card>
              <div className="text-center">
                <div className="text-2xl font-bold text-prof-high">
                  {Math.max(0, champions.length - fierlessBans.length)}
                </div>
                <div className="text-sm text-lol-gold-light/60 mt-1">남은 챔피언</div>
              </div>
            </Card>
          </div>

          <Card title={`세션: ${session.name}`}>
            <div className="flex flex-wrap gap-3">
              <Link to="/session/new-game">
                <Button size="lg">새 게임 시작</Button>
              </Link>
              <Link to="/session">
                <Button variant="secondary" size="lg">세션 현황</Button>
              </Link>
              <Link to="/players">
                <Button variant="secondary" size="lg">선수 관리</Button>
              </Link>
            </div>
          </Card>

          {games.length > 0 && (
            <Card title="최근 게임">
              <div className="space-y-2">
                {games.slice(-5).reverse().map((game) => (
                  <div key={game.id} className="flex items-center justify-between p-3 bg-lol-blue rounded border border-lol-border">
                    <div className="flex items-center gap-3">
                      <span className="text-lol-gold font-mono text-sm">#{game.gameNumber}</span>
                      <span className="text-xs bg-lol-gold/20 text-lol-gold px-2 py-0.5 rounded">{game.format}</span>
                    </div>
                    <div className="text-sm">
                      {game.winningTeam ? (
                        <span className="text-prof-high">Team {game.winningTeam} 승리</span>
                      ) : (
                        <span className="text-lol-gold-light/50">결과 미입력</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {players.length === 0 && (
        <Card>
          <div className="text-center py-8">
            <p className="text-lol-gold-light/60 mb-4">아직 등록된 선수가 없습니다.</p>
            <Link to="/players"><Button>선수 등록하기</Button></Link>
          </div>
        </Card>
      )}
    </div>
  );
}
