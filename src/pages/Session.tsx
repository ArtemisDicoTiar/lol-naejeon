import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '@/hooks/useSession';
import { useChampions } from '@/hooks/useChampions';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ActionGroup, EmptyState, PageHeader, StatusPill } from '@/components/ui/Page';
import { ChampionIcon } from '@/components/champions/ChampionIcon';
import { EogStatsPanel } from '@/components/session/EogStatsPanel';
import { StreakStrip } from '@/components/stats/StreakStrip';
import { db, GAME_MODE_LABELS, type Game, type GameBan, type GameEogCapture, type GameParticipantStat, type GamePick, type Player } from '@/lib/db';
import { useIdentityContext, useLcuContext } from '@/App';
import { computeWinrateStats, estimateCompWinrate, type WinrateStats } from '@/lib/recommendation/winrate';
import type { Champion } from '@/lib/db';
import { championTraits, type MechanicTag } from '@/data/champion-tags';
import { getTagLabel, getTagColor } from '@/data/tag-display';
import { isLcuAutoNavigateSuppressed } from '@/lib/lcu-navigation';

type EditableGamePick = GamePick & { draftId: string };

export function Session() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isMaster } = useIdentityContext();
  const lcu = useLcuContext();
  const { session, games, fierlessBans, lastGameTeams, loading, setGameResult, endSession, removeGame, setGameMode, correctGamePicks } = useSession();
  const { champions } = useChampions();
  const [gamePicks, setGamePicks] = useState<Record<number, GamePick[]>>({});
  const [gameBansMap, setGameBansMap] = useState<Record<number, GameBan[]>>({});
  const [gameEogMap, setGameEogMap] = useState<Record<number, GameEogCapture>>({});
  const [gameParticipantStatsMap, setGameParticipantStatsMap] = useState<Record<number, GameParticipantStat[]>>({});
  const [unlinkedCaptures, setUnlinkedCaptures] = useState<GameEogCapture[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [wrStats, setWrStats] = useState<WinrateStats | null>(null);
  const [editingGameId, setEditingGameId] = useState<number | null>(null);
  const [draftPicksByGameId, setDraftPicksByGameId] = useState<Record<number, EditableGamePick[]>>({});
  const [expandedGameIds, setExpandedGameIds] = useState<Set<number>>(() => new Set());
  const autoNavigateRef = useRef(false);

  useEffect(() => { db.players.toArray().then(setPlayers); }, []);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void computeWinrateStats().then((next) => {
        if (!cancelled) setWrStats(next);
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [games]);

  // Pending game = last game without winningTeam (in progress)
  const pendingGame = useMemo(
    () => games.length > 0 ? games[games.length - 1] : null,
    [games],
  );
  const hasPendingGame = games.some((game) => game.winningTeam === null);
  const pendingGamePicks = pendingGame ? (gamePicks[pendingGame.id!] ?? []) : [];

  // Build a champion-name → champion map for normalising live pick data
  const championByNormId = useMemo(() => {
    const map = new Map<string, Champion>();
    for (const c of champions) {
      map.set(c.id.toLowerCase(), c);
    }
    return map;
  }, [champions]);

  // Try to resolve Live Client Data champion ID → our Champion
  const resolveLiveChampion = (championId: string): Champion | undefined => {
    // Direct match (most common)
    const c = championByNormId.get(championId.toLowerCase());
    if (c) return c;
    // Some names differ — try stripping special chars
    const stripped = championId.replace(/[^a-zA-Z]/g, '').toLowerCase();
    for (const [key, val] of championByNormId) {
      if (key.replace(/[^a-z]/g, '') === stripped) return val;
    }
    return undefined;
  };

  // Compute what a corrected pick list would look like from live data
  const [showLivePanel, setShowLivePanel] = useState(false);
  const liveGamePlayers = lcu.liveGamePlayers;

  const correctedPicks = useMemo(() => {
    if (!liveGamePlayers || !pendingGame || !players.length) return null;
    const playerByAlias = new Map<string, Player>();
    for (const p of players) playerByAlias.set(p.name, p);

    const buildTeam = (
      liveTeam: typeof liveGamePlayers.team1,
      teamNum: 1 | 2,
    ) => liveTeam
      .map((lp) => {
        const champ = resolveLiveChampion(lp.championId);
        const player = lp.alias ? playerByAlias.get(lp.alias) : undefined;
        return { livePlayer: lp, champ, player, teamNum };
      });

    return {
      team1: buildTeam(liveGamePlayers.team1, 1),
      team2: buildTeam(liveGamePlayers.team2, 2),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveGamePlayers, pendingGame, players, champions]);

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
      !loading &&
      !hasPendingGame &&
      !isLcuAutoNavigateSuppressed() &&
      !autoNavigateRef.current &&
      location.pathname !== '/session/new-game'
    ) {
      autoNavigateRef.current = true;
      navigate('/session/new-game?fromLcu=true');
    }
  }, [hasPendingGame, lcu.champSelectActive, lcu.connected, lcu.gameStartedAt, loading, location.pathname, session, isMaster, navigate]);

  const loadAncillaryGameData = useCallback(async () => {
    const rows = await Promise.all(games.map(async (game) => {
      const [picks, bans, capture] = await Promise.all([
        db.gamePicks.where('gameId').equals(game.id!).toArray(),
        db.gameBans.where('gameId').equals(game.id!).toArray(),
        db.gameEogCaptures.where('gameId').equals(game.id!).last(),
      ]);
      const participantStats = capture
        ? await db.gameParticipantStats.where('captureId').equals(capture.id!).toArray()
        : [];
      return { gameId: game.id!, picks, bans, capture, participantStats };
    }));

    const picks: Record<number, GamePick[]> = {};
    const bans: Record<number, GameBan[]> = {};
    const eogMap: Record<number, GameEogCapture> = {};
    const eogStatsMap: Record<number, GameParticipantStat[]> = {};

    for (const row of rows) {
      picks[row.gameId] = row.picks;
      bans[row.gameId] = row.bans;
      if (row.capture) {
        eogMap[row.gameId] = row.capture;
        eogStatsMap[row.gameId] = row.participantStats;
      }
    }

    const sessionCaptures = session?.id
      ? await db.gameEogCaptures.where('sessionId').equals(session.id).toArray()
      : [];

    setGamePicks(picks);
    setGameBansMap(bans);
    setGameEogMap(eogMap);
    setGameParticipantStatsMap(eogStatsMap);
    setUnlinkedCaptures(
      sessionCaptures
        .filter((capture) => !capture.gameId)
        .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime()),
    );
  }, [games, session?.id]);

  useEffect(() => {
    void loadAncillaryGameData();
  }, [loadAncillaryGameData]);

  useEffect(() => {
    const handleDataChanged = () => { void loadAncillaryGameData(); };
    window.addEventListener('lol-data-changed', handleDataChanged);
    return () => window.removeEventListener('lol-data-changed', handleDataChanged);
  }, [loadAncillaryGameData]);

  const getChampion = (id: string) => champions.find((c) => c.id === id);
  const getPlayer = (id: number) => players.find((p) => p.id === id);
  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [players],
  );
  const sortedChampions = useMemo(
    () => [...champions].sort((a, b) => a.nameKo.localeCompare(b.nameKo, 'ko')),
    [champions],
  );
  const bannedChampions = champions.filter((c) => fierlessBans.includes(c.id));
  const availableCount = champions.length - fierlessBans.length;
  const bannedPercent = champions.length > 0 ? (fierlessBans.length / champions.length) * 100 : 0;
  const completedGames = games.filter((game) => game.winningTeam !== null).length;
  const pendingGames = games.length - completedGames;
  const latestGameId = games.at(-1)?.id;
  const displayGames = useMemo(() => [...games].sort((a, b) => {
    const aPending = a.winningTeam === null;
    const bPending = b.winningTeam === null;
    if (aPending !== bPending) return aPending ? -1 : 1;
    return b.gameNumber - a.gameNumber;
  }), [games]);
  const livePickSummary = useMemo(() => {
    if (!correctedPicks) return null;
    const rows = [...correctedPicks.team1, ...correctedPicks.team2];
    let mapped = 0;
    let matched = 0;
    let needsFix = 0;
    for (const row of rows) {
      if (row.player && row.champ) mapped++;
      const recorded = pendingGamePicks.find((pick) =>
        row.player && pick.playerId === row.player.id && pick.team === row.teamNum,
      );
      const isMatched = !!recorded && recorded.championId === row.champ?.id;
      if (isMatched) matched++;
      else if (row.player && row.champ) needsFix++;
    }
    return { total: rows.length, mapped, matched, needsFix };
  }, [correctedPicks, pendingGamePicks]);

  const toggleGameExpanded = (gameId: number) => {
    setExpandedGameIds((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) next.delete(gameId);
      else next.add(gameId);
      return next;
    });
  };

  const handleEndSession = async () => {
    if (!confirm('세션을 종료하시겠습니까? 종료 후에는 게임을 추가할 수 없습니다.')) return;
    const syncMsg = await endSession(isMaster);
    if (syncMsg) alert(syncMsg);
    navigate('/');
  };

  const makeEditablePick = (pick: GamePick, index: number): EditableGamePick => ({
    ...pick,
    draftId: `${pick.id ?? 'new'}-${index}-${pick.team}-${pick.playerId}-${pick.championId}`,
  });

  const startEditingGamePicks = (gameId: number) => {
    const currentPicks = gamePicks[gameId] ?? [];
    setDraftPicksByGameId((prev) => ({
      ...prev,
      [gameId]: currentPicks.map(makeEditablePick),
    }));
    setEditingGameId(gameId);
  };

  const cancelEditingGamePicks = (gameId: number) => {
    setDraftPicksByGameId((prev) => {
      const next = { ...prev };
      delete next[gameId];
      return next;
    });
    setEditingGameId(null);
  };

  const updateDraftPick = (
    gameId: number,
    draftId: string,
    changes: Partial<Pick<GamePick, 'playerId' | 'championId' | 'team'>>,
  ) => {
    setDraftPicksByGameId((prev) => ({
      ...prev,
      [gameId]: (prev[gameId] ?? []).map((pick) =>
        pick.draftId === draftId ? { ...pick, ...changes } : pick,
      ),
    }));
  };

  const addDraftPick = (gameId: number, team: 1 | 2) => {
    const current = draftPicksByGameId[gameId] ?? [];
    const usedPlayerIds = new Set(current.map((pick) => pick.playerId));
    const fallbackPlayer = sortedPlayers.find((player) => !usedPlayerIds.has(player.id!)) ?? sortedPlayers[0];
    const fallbackChampion = sortedChampions[0];
    if (!fallbackPlayer || !fallbackChampion) return;

    setDraftPicksByGameId((prev) => ({
      ...prev,
      [gameId]: [
        ...(prev[gameId] ?? []),
        {
          draftId: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          gameId,
          team,
          playerId: fallbackPlayer.id!,
          championId: fallbackChampion.id,
        },
      ],
    }));
  };

  const removeDraftPick = (gameId: number, draftId: string) => {
    setDraftPicksByGameId((prev) => ({
      ...prev,
      [gameId]: (prev[gameId] ?? []).filter((pick) => pick.draftId !== draftId),
    }));
  };

  const saveEditingGamePicks = async (gameId: number) => {
    const draftPicks = draftPicksByGameId[gameId] ?? [];
    const validPicks = draftPicks.filter((pick) => pick.playerId && pick.championId);
    if (validPicks.length === 0) {
      alert('저장할 픽이 없습니다.');
      return;
    }

    const duplicatePlayer = validPicks.find((pick, index) =>
      validPicks.findIndex((candidate) => candidate.playerId === pick.playerId) !== index,
    );
    if (duplicatePlayer) {
      alert(`같은 플레이어가 중복으로 들어가 있습니다: ${getPlayer(duplicatePlayer.playerId)?.name ?? duplicatePlayer.playerId}`);
      return;
    }

    await correctGamePicks(gameId, validPicks.map((pick) => ({
      playerId: pick.playerId,
      championId: pick.championId,
      team: pick.team,
    })));
    await loadAncillaryGameData();
    cancelEditingGamePicks(gameId);
  };

  if (loading) return <div className="text-center py-8 text-lol-gold">로딩 중...</div>;

  if (!session) {
    return (
      <EmptyState
        title="활성 세션이 없습니다."
        description="대시보드에서 새 세션을 시작하면 현재 세션 현황을 볼 수 있습니다."
        action={<Link to="/"><Button>대시보드로 이동</Button></Link>}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Current Session"
        title={session.name}
        description={`${new Date(session.createdAt).toLocaleString('ko-KR')} 시작 · 게임 진행, 피어리스 풀, 종료 후 통계를 한 화면에서 관리합니다.`}
        meta={(
          <>
            <StatusPill tone={lcu.connected ? 'blue' : 'muted'}>
              {lcu.connected ? '클라 연결됨' : '클라 미연결'}
            </StatusPill>
            {pendingGames > 0 && <StatusPill tone="yellow">결과 대기 {pendingGames}</StatusPill>}
            <StatusPill tone="gold">완료 {completedGames}</StatusPill>
          </>
        )}
        actions={(
          <ActionGroup>
          <Link to="/session/new-game">
            <Button>새 게임</Button>
          </Link>
          <Button variant="danger" onClick={handleEndSession}>세션 종료</Button>
          </ActionGroup>
        )}
      />

      <SessionOverviewPanel
        games={games}
        fearlessBans={fierlessBans.length}
        availableCount={availableCount}
        championCount={champions.length}
        eogCount={Object.keys(gameEogMap).length}
      />

      {/* Team carry-over */}
      {lastGameTeams && (
        <Card title="다음 게임">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 p-2 bg-blue-950/20 rounded border border-blue-900/30">
              <div className="text-xs text-blue-400 mb-1">Team 1</div>
              <div className="text-sm text-lol-gold-light">
                {lastGameTeams.team1.map((id) => getPlayer(id)?.name).join(', ')}
              </div>
            </div>
            <div className="flex-1 p-2 bg-red-950/20 rounded border border-red-900/30">
              <div className="text-xs text-red-400 mb-1">Team 2</div>
              <div className="text-sm text-lol-gold-light">
                {lastGameTeams.team2.map((id) => getPlayer(id)?.name).join(', ')}
              </div>
            </div>
          </div>
          <ActionGroup>
            <Link to="/session/new-game?keepTeams=true">
              <Button size="sm">팀 유지하고 새 게임</Button>
            </Link>
            <Link to="/session/new-game">
              <Button variant="secondary" size="sm">팀 변경하고 새 게임</Button>
            </Link>
          </ActionGroup>
        </Card>
      )}

      {/* Day-based streak status */}
      {players.length > 0 && (
        <StreakStrip
          players={players}
          // Re-mount when games array changes so today's results refresh the strip
          key={`streak-${games.length}`}
        />
      )}

      {lcu.connected && (lcu.eog.status === 'capturing' || lcu.eog.status === 'failed' || lcu.eog.status === 'captured') && (
        <Card title="종료 후 수집 상태">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <StatusPill tone={lcu.eog.status === 'captured' ? 'green' : lcu.eog.status === 'failed' ? 'red' : 'gold'}>
              {lcu.eog.status === 'captured' ? 'EOG 수집 완료' : lcu.eog.status === 'failed' ? 'EOG 수집 실패' : 'EOG 수집 중'}
            </StatusPill>
            {lcu.eog.capture && (
              <span className="text-lol-gold-light/60">
                {lcu.eog.capture.participantCount}명 캡처 · {lcu.eog.capture.mappedParticipants}명 매핑
              </span>
            )}
            {lcu.eog.capture?.gameId === null && (
              <span className="text-yellow-300/80">현재 세션 게임과 자동 연결되지 않았습니다.</span>
            )}
            {lcu.eog.error && <span className="text-red-300/80">{lcu.eog.error}</span>}
          </div>
        </Card>
      )}

      {unlinkedCaptures.length > 0 && (
        <Card title="미연결 종료 데이터">
          <div className="space-y-2">
            {unlinkedCaptures.map((capture) => (
              <div key={capture.id} className="rounded border border-yellow-700/30 bg-yellow-950/10 px-3 py-2 text-sm text-yellow-100/85">
                {new Date(capture.capturedAt).toLocaleString('ko-KR')} · {capture.participantCount}명 · raw 캡처만 저장됨
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Fierless */}
      <Card title={`피어리스 밴 (${fierlessBans.length}개 사용 / ${availableCount}개 남음)`}>
        <div className="mb-4 rounded border border-lol-border/70 bg-lol-dark/40 p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-lol-gold-light/55">
            <span>사용 불가 챔피언</span>
            <span>{Math.round(bannedPercent)}%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-lol-blue">
            <div className="h-full rounded-full bg-gradient-to-r from-tier-a to-tier-s" style={{ width: `${bannedPercent}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-lol-gold-light/35">
            <span>누적 밴 {fierlessBans.length}</span>
            <span>남은 풀 {availableCount}</span>
          </div>
        </div>
        {bannedChampions.length === 0 ? (
          <p className="text-lol-gold-light/50 text-center py-4">첫 게임을 시작하세요!</p>
        ) : (
          <div className="flex max-h-24 flex-wrap gap-2 overflow-y-auto pr-1">
            {bannedChampions.map((c) => <ChampionIcon key={c.id} champion={c} size="sm" disabled showName />)}
          </div>
        )}
      </Card>

      {/* Live game picks correction — shown when bridge sends actual picks */}
      {liveGamePlayers && pendingGame && pendingGame.winningTeam === null && (
        <Card className="border-lol-gold/35 bg-[radial-gradient(circle_at_18%_0%,rgba(200,155,60,0.16),transparent_34%),linear-gradient(180deg,rgba(30,35,40,0.96),rgba(1,10,19,0.78))]">
          <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-lol-gold-light/35">Live Pick Verification</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-black text-lol-gold">실제 픽 확인</h3>
                <StatusPill tone={livePickSummary?.needsFix ? 'yellow' : 'green'}>
                  {livePickSummary?.needsFix ? `${livePickSummary.needsFix}개 보정 필요` : '기록 일치'}
                </StatusPill>
              </div>
              <p className="mt-1 text-sm text-lol-gold-light/55">
                클라이언트에서 읽은 실제 픽과 현재 기록을 비교합니다. 순서가 어긋난 판은 여기서 한 번에 보정하세요.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-lol-border/70 bg-lol-dark/45 px-3 py-2">
                <div className="text-lg font-black text-lol-gold">{livePickSummary?.mapped ?? 0}</div>
                <div className="text-[10px] text-lol-gold-light/40">매핑</div>
              </div>
              <div className="rounded-lg border border-prof-high/25 bg-prof-high/8 px-3 py-2">
                <div className="text-lg font-black text-prof-high">{livePickSummary?.matched ?? 0}</div>
                <div className="text-[10px] text-lol-gold-light/40">일치</div>
              </div>
              <div className="rounded-lg border border-yellow-600/25 bg-yellow-950/20 px-3 py-2">
                <div className="text-lg font-black text-yellow-300">{livePickSummary?.needsFix ?? 0}</div>
                <div className="text-[10px] text-lol-gold-light/40">차이</div>
              </div>
            </div>
          </div>
          <button
            onClick={() => setShowLivePanel(!showLivePanel)}
            className="mb-3 w-full cursor-pointer rounded-lg border border-lol-border/70 bg-lol-dark/35 px-3 py-2 text-sm text-lol-gold-light/70 transition-colors hover:border-lol-gold/50 hover:text-lol-gold">
            {showLivePanel ? '실제 픽 패널 접기' : '실제 픽 비교 펼치기'}
          </button>
          {showLivePanel && correctedPicks && (
            <div className="space-y-3">
              {([
                { label: 'Team 1', sub: 'ORDER / 블루', team: correctedPicks.team1, accent: 'border-blue-600/30 bg-blue-950/12' },
                { label: 'Team 2', sub: 'CHAOS / 레드', team: correctedPicks.team2, accent: 'border-red-600/30 bg-red-950/12' },
              ] as const).map(({ label, sub, team, accent }) => (
                <div key={label} className={`rounded-xl border p-3 ${accent}`}>
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-lol-gold">{label}</div>
                      <div className="text-[10px] text-lol-gold-light/35">{sub}</div>
                    </div>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    {team.map((row, i) => {
                      const recorded = pendingGamePicks.find((p) =>
                        row.player && p.playerId === row.player.id && p.team === row.teamNum,
                      );
                      const matches = recorded?.championId === row.champ?.id;
                      const recordedChamp = recorded ? champions.find((c) => c.id === recorded.championId) : undefined;
                      return (
                        <div key={i} className={`relative overflow-hidden rounded-lg border p-2.5 ${
                          !row.player
                            ? 'border-yellow-700/30 bg-yellow-950/10 opacity-75'
                            : matches
                              ? 'border-prof-high/25 bg-prof-high/8'
                              : 'border-yellow-600/35 bg-yellow-950/18'
                        }`}>
                          <div className="flex items-center gap-2">
                            {row.champ
                              ? <img src={row.champ.imageUrl} className="h-10 w-10 rounded-lg border border-lol-border/60 object-cover" />
                              : <div className="h-10 w-10 rounded-lg border border-dashed border-lol-border/70 bg-lol-blue/40" />}
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-semibold text-lol-gold-light">
                                {row.player?.name ?? row.livePlayer.alias ?? row.livePlayer.summonerName}
                              </div>
                              <div className="truncate text-xs text-lol-gold/80">{row.champ?.nameKo ?? row.livePlayer.championName}</div>
                            </div>
                            <StatusPill tone={!row.player ? 'yellow' : matches ? 'green' : 'yellow'} className="px-2 py-0.5 text-[10px]">
                              {!row.player ? '미매핑' : matches ? '일치' : '보정'}
                            </StatusPill>
                          </div>
                          {row.player && !matches && (
                            <div className="mt-2 rounded border border-yellow-700/25 bg-lol-dark/45 px-2 py-1 text-[10px] text-yellow-100/75">
                              현재 기록: {recordedChamp?.nameKo ?? recorded?.championId ?? '없음'}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="flex flex-col gap-2 rounded-xl border border-lol-border/70 bg-lol-dark/45 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-lol-gold-light/60">
                  보정 적용 시 현재 진행 중 게임의 픽 기록을 실제 클라이언트 픽으로 교체합니다.
                </div>
                <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    if (!confirm('실제 픽 정보로 현재 게임 기록을 보정하시겠습니까? 기존 픽이 교체됩니다.')) return;
                    const allRows = [...correctedPicks.team1, ...correctedPicks.team2];
                    const newPicks: Array<{ playerId: number; championId: string; team: 1 | 2 }> = [];
                    for (const row of allRows) {
                      if (row.player && row.champ) {
                        newPicks.push({ playerId: row.player.id!, championId: row.champ.id, team: row.teamNum });
                      }
                    }
                    if (newPicks.length > 0) {
                      await correctGamePicks(pendingGame.id!, newPicks);
                      setShowLivePanel(false);
                      alert(`${newPicks.length}명 픽 보정 완료.`);
                    } else {
                      alert('매핑된 픽이 없습니다. 플레이어-소환사명 매핑을 브릿지에서 확인해주세요.');
                    }
                  }}>
                  보정 적용
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowLivePanel(false)}>닫기</Button>
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Games */}
      <Card title={`게임 기록 (${games.length}개)`}>
        {games.length === 0 ? (
          <EmptyState
            title="진행된 게임이 없습니다."
            description="새 게임을 시작하면 밴픽, 결과, EOG 통계가 이곳에 쌓입니다."
            action={<Link to="/session/new-game"><Button>새 게임 시작</Button></Link>}
          />
        ) : (
          <div className="space-y-4">
            {displayGames.map((game) => {
              const picks = gamePicks[game.id!] ?? [];
              const isEditingPicks = editingGameId === game.id;
              const displayPicks = isEditingPicks
                ? (draftPicksByGameId[game.id!] ?? picks.map(makeEditablePick))
                : picks.map(makeEditablePick);
              const bans = gameBansMap[game.id!] ?? [];
              const eogCapture = gameEogMap[game.id!];
              const eogStats = gameParticipantStatsMap[game.id!] ?? [];
              const team1 = displayPicks.filter((p) => p.team === 1);
              const team2 = displayPicks.filter((p) => p.team === 2);
              const isLatest = game.winningTeam === null || (!hasPendingGame && game.id === latestGameId);
              const isExpanded = game.winningTeam === null || isEditingPicks || expandedGameIds.has(game.id!);
              return (
                <div key={game.id} className={`relative overflow-hidden rounded-xl border bg-[linear-gradient(135deg,rgba(10,20,40,0.92),rgba(1,10,19,0.72))] shadow-[0_14px_38px_rgba(0,0,0,0.22)] ${
                  game.winningTeam === null ? 'border-lol-gold/60 shadow-lol-gold/10' : 'border-lol-border/80'
                }`}>
                  <div className={`pointer-events-none absolute inset-x-0 top-0 h-1 ${
                    game.winningTeam === 1 ? 'bg-blue-500/70' : game.winningTeam === 2 ? 'bg-red-500/70' : 'bg-lol-gold/70'
                  }`} />
                  <div className="flex flex-col gap-3 border-b border-lol-border/60 bg-lol-dark/28 p-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="text-lg font-black text-lol-gold">Game #{game.gameNumber}</span>
                        <StatusPill tone={game.winningTeam === null ? 'yellow' : 'green'}>
                          {game.winningTeam === null ? '진행 중' : `Team ${game.winningTeam} 승리`}
                        </StatusPill>
                        <StatusPill tone="blue">{game.format}</StatusPill>
                        <button
                          onClick={() => setGameMode(game.id!, game.mode === 'augmented' ? 'aram' : 'augmented')}
                          title="클릭해서 모드 전환"
                          className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                            (game.mode ?? 'aram') === 'augmented'
                              ? 'border-purple-500/35 bg-purple-950/35 text-purple-300 hover:bg-purple-900/45'
                              : 'border-lol-border/80 bg-lol-dark/50 text-lol-gold-light/65 hover:border-lol-gold/50'
                          }`}>
                          {GAME_MODE_LABELS[game.mode ?? 'aram']}
                        </button>
                        {eogCapture && (
                          <StatusPill tone={
                            eogCapture.status === 'captured' ? 'green' : eogCapture.status === 'unlinked' ? 'yellow' : 'red'
                          }>
                            EOG {eogCapture.status === 'captured' ? '완료' : eogCapture.status === 'unlinked' ? '미연결' : '실패'}
                          </StatusPill>
                        )}
                      </div>
                      <div className="text-xs text-lol-gold-light/38">
                        {new Date(game.playedAt).toLocaleString('ko-KR')} · {team1.length}v{team2.length}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {game.winningTeam ? null : (
                        <>
                          <Button size="sm" variant="secondary" onClick={() => setGameResult(game.id!, 1)}>T1 승</Button>
                          <Button size="sm" variant="secondary" onClick={() => setGameResult(game.id!, 2)}>T2 승</Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant={isEditingPicks ? 'primary' : 'ghost'}
                        onClick={() => isEditingPicks ? void saveEditingGamePicks(game.id!) : startEditingGamePicks(game.id!)}
                      >
                        {isEditingPicks ? '픽 수정 완료' : '픽 수정'}
                      </Button>
                      {isEditingPicks && (
                        <Button size="sm" variant="ghost" onClick={() => cancelEditingGamePicks(game.id!)}>
                          취소
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleGameExpanded(game.id!)}
                        disabled={game.winningTeam === null || isEditingPicks}
                      >
                        {isExpanded ? '접기' : '상세'}
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => {
                        if (confirm(`Game #${game.gameNumber}을 삭제하시겠습니까?`)) removeGame(game.id!);
                      }}>삭제</Button>
                    </div>
                  </div>
                  {!isExpanded ? (
                    <CompactGameSummary
                      team1={team1}
                      team2={team2}
                      eogStats={eogStats}
                      winnerTeam={game.winningTeam}
                      getChampion={getChampion}
                      getPlayer={getPlayer}
                    />
                  ) : (
                    <div className="space-y-3 p-3">
                      {bans.length > 0 && <CompactBanStrip bans={bans} getChampion={getChampion} />}
                      {isLatest && wrStats && displayPicks.length > 0 && (
                        <ActiveGameStats
                          team1={team1}
                          team2={team2}
                          wrStats={wrStats}
                          getChampion={getChampion}
                          getPlayer={getPlayer}
                        />
                      )}
                      <div className={`grid gap-3 ${eogCapture && eogStats.length > 0 ? 'xl:grid-cols-[0.82fr_1.18fr]' : ''}`}>
                        <GamePickPanel
                          gameId={game.id!}
                          team1={team1}
                          team2={team2}
                          winningTeam={game.winningTeam}
                          isEditingPicks={isEditingPicks}
                          sortedPlayers={sortedPlayers}
                          sortedChampions={sortedChampions}
                          getChampion={getChampion}
                          getPlayer={getPlayer}
                          onAddPick={addDraftPick}
                          onUpdatePick={updateDraftPick}
                          onRemovePick={removeDraftPick}
                        />
                        {eogCapture && eogStats.length > 0 && (
                          <div className="rounded-xl border border-lol-border/65 bg-lol-dark/30 p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div className="text-xs font-semibold text-lol-gold-light/70">
                                EOG · {new Date(eogCapture.capturedAt).toLocaleTimeString('ko-KR')}
                              </div>
                              <div className="text-[10px] text-lol-gold-light/45">
                                {eogCapture.mappedParticipants}/{eogCapture.participantCount}
                              </div>
                            </div>
                            <div className="max-h-[360px] overflow-y-auto pr-1">
                              <EogStatsPanel
                                participantStats={eogStats}
                                players={players}
                                champions={champions}
                                winnerTeam={eogCapture.winnerTeam}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function formatShortNumber(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}만`;
  return Math.round(value).toLocaleString('ko-KR');
}

function SessionOverviewPanel({
  games,
  fearlessBans,
  availableCount,
  championCount,
  eogCount,
}: {
  games: Game[];
  fearlessBans: number;
  availableCount: number;
  championCount: number;
  eogCount: number;
}) {
  const completed = games.filter((game) => game.winningTeam !== null);
  const pending = games.length - completed.length;
  const team1Wins = completed.filter((game) => game.winningTeam === 1).length;
  const team2Wins = completed.filter((game) => game.winningTeam === 2).length;
  const scoreTotal = Math.max(team1Wins + team2Wins, 1);
  const t1Percent = (team1Wins / scoreTotal) * 100;
  const t2Percent = (team2Wins / scoreTotal) * 100;
  const aramCount = games.filter((game) => (game.mode ?? 'aram') === 'aram').length;
  const augmentedCount = games.length - aramCount;
  const modeTotal = Math.max(games.length, 1);
  const banPercent = championCount > 0 ? (fearlessBans / championCount) * 100 : 0;
  const timelineGames = [...games].sort((a, b) => a.gameNumber - b.gameNumber).slice(-18);

  return (
    <Card title="세션 압축 요약">
      <div className="grid gap-3 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-xl border border-lol-border/70 bg-lol-dark/35 p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-lol-gold-light/50">
            <span>스코어 흐름</span>
            <span>{completed.length}완료 · {pending}대기</span>
          </div>
          <div className="flex h-5 overflow-hidden rounded-full bg-lol-blue">
            <div className="bg-blue-500/85" style={{ width: `${t1Percent}%` }} />
            <div className="bg-red-500/85" style={{ width: `${t2Percent}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-xs">
            <span className="text-blue-300">Team 1 {team1Wins}승</span>
            <span className="text-red-300">Team 2 {team2Wins}승</span>
          </div>

          <div className="mt-4 overflow-x-auto pb-1">
            <div className="flex min-w-max gap-1.5">
              {timelineGames.map((game) => (
                <div
                  key={game.id ?? game.gameNumber}
                  className={`w-11 rounded-lg border px-1.5 py-1 text-center ${
                    game.winningTeam === 1
                      ? 'border-blue-500/45 bg-blue-950/35 text-blue-200'
                      : game.winningTeam === 2
                        ? 'border-red-500/45 bg-red-950/35 text-red-200'
                        : 'border-lol-gold/35 bg-lol-gold/12 text-lol-gold'
                  }`}
                  title={`Game #${game.gameNumber} · ${GAME_MODE_LABELS[game.mode ?? 'aram']}`}
                >
                  <div className="text-[10px] font-bold">G{game.gameNumber}</div>
                  <div className="text-[10px] opacity-80">{game.winningTeam ? `T${game.winningTeam}` : '진행'}</div>
                </div>
              ))}
              {timelineGames.length === 0 && (
                <div className="text-xs text-lol-gold-light/40">아직 진행된 게임이 없습니다.</div>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
          <div className="rounded-xl border border-lol-border/70 bg-lol-dark/35 p-3">
            <div className="mb-1 flex justify-between text-xs text-lol-gold-light/50">
              <span>피어리스 풀</span>
              <span>{Math.round(banPercent)}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-lol-blue">
              <div className="h-full rounded-full bg-gradient-to-r from-red-500/75 to-lol-gold" style={{ width: `${banPercent}%` }} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-center text-xs">
              <div className="rounded border border-red-700/25 bg-red-950/12 py-1 text-red-200">{fearlessBans} 사용</div>
              <div className="rounded border border-blue-700/25 bg-blue-950/12 py-1 text-blue-200">{availableCount} 남음</div>
            </div>
          </div>

          <div className="rounded-xl border border-lol-border/70 bg-lol-dark/35 p-3">
            <div className="mb-1 flex justify-between text-xs text-lol-gold-light/50">
              <span>모드 / 통계</span>
              <span>EOG {eogCount}</span>
            </div>
            <div className="flex h-2.5 overflow-hidden rounded-full bg-lol-blue">
              <div className="bg-lol-gold/80" style={{ width: `${(aramCount / modeTotal) * 100}%` }} />
              <div className="bg-purple-500/80" style={{ width: `${(augmentedCount / modeTotal) * 100}%` }} />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded border border-lol-gold/20 bg-lol-gold/8 py-1 text-lol-gold">{aramCount} 칼바람</div>
              <div className="rounded border border-purple-500/25 bg-purple-950/20 py-1 text-purple-200">{augmentedCount} 증바람</div>
              <div className="rounded border border-prof-high/25 bg-prof-high/8 py-1 text-prof-high">{eogCount} 수집</div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function CompactGameSummary({
  team1,
  team2,
  eogStats,
  winnerTeam,
  getChampion,
  getPlayer,
}: {
  team1: GamePick[];
  team2: GamePick[];
  eogStats: GameParticipantStat[];
  winnerTeam: number | null;
  getChampion: (id: string) => Champion | undefined;
  getPlayer: (id: number) => Player | undefined;
}) {
  const topDamage = [...eogStats]
    .sort((a, b) => b.totalDamageDealtToChampions - a.totalDamageDealtToChampions)
    .slice(0, 3);
  const teamDamage = [1, 2].map((team) =>
    eogStats
      .filter((row) => row.team === team)
      .reduce((sum, row) => sum + row.totalDamageDealtToChampions, 0),
  );
  const maxTeamDamage = Math.max(...teamDamage, 1);

  const renderTeam = (picks: GamePick[], teamNum: 1 | 2) => (
    <div className={`min-w-0 rounded-xl border p-2.5 ${
      teamNum === 1 ? 'border-blue-700/25 bg-blue-950/12' : 'border-red-700/25 bg-red-950/12'
    } ${winnerTeam === teamNum ? 'ring-1 ring-prof-high/35' : ''}`}>
      <div className="mb-2 flex items-center justify-between">
        <div className={`text-xs font-bold ${teamNum === 1 ? 'text-blue-300' : 'text-red-300'}`}>Team {teamNum}</div>
        {winnerTeam === teamNum && <span className="text-[10px] text-prof-high">승리</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {picks.map((pick) => {
          const champion = getChampion(pick.championId);
          const player = getPlayer(pick.playerId);
          return (
            <div key={`${pick.gameId}-${pick.playerId}-${pick.championId}`} className="flex items-center gap-1 rounded-lg border border-lol-border/45 bg-lol-dark/35 px-1.5 py-1">
              {champion
                ? <img src={champion.imageUrl} className="h-6 w-6 rounded object-cover" />
                : <div className="h-6 w-6 rounded border border-dashed border-lol-border/60" />}
              <div className="max-w-24 truncate text-[11px] text-lol-gold-light/75">
                {player?.name ?? '?'}
              </div>
            </div>
          );
        })}
        {picks.length === 0 && <div className="text-xs text-lol-gold-light/35">픽 기록 없음</div>}
      </div>
    </div>
  );

  return (
    <div className="space-y-3 p-3">
      <div className="grid grid-cols-2 gap-2">
        {renderTeam(team1, 1)}
        {renderTeam(team2, 2)}
      </div>
      {eogStats.length > 0 && (
        <div className="grid gap-2 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="rounded-xl border border-lol-border/60 bg-lol-dark/35 p-2.5">
            <div className="mb-2 text-xs text-lol-gold-light/50">팀 딜량</div>
            {[1, 2].map((team) => (
              <div key={team} className="mb-1.5 last:mb-0">
                <div className="mb-1 flex justify-between text-[11px] text-lol-gold-light/55">
                  <span>Team {team}</span>
                  <span>{formatShortNumber(teamDamage[team - 1])}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-lol-blue">
                  <div
                    className={`h-full rounded-full ${team === 1 ? 'bg-blue-500/80' : 'bg-red-500/80'}`}
                    style={{ width: `${(teamDamage[team - 1] / maxTeamDamage) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-lol-border/60 bg-lol-dark/35 p-2.5">
            <div className="mb-2 text-xs text-lol-gold-light/50">딜량 TOP</div>
            <div className="flex flex-wrap gap-2">
              {topDamage.map((row, index) => {
                const champion = row.championId ? getChampion(row.championId) : undefined;
                const player = row.playerId ? getPlayer(row.playerId) : undefined;
                return (
                  <div key={row.id ?? `${row.summonerName}-${index}`} className="flex items-center gap-2 rounded-lg border border-lol-border/45 bg-lol-dark/40 px-2 py-1">
                    {champion && <img src={champion.imageUrl} className="h-6 w-6 rounded object-cover" />}
                    <div className="text-[11px]">
                      <div className="text-lol-gold-light/80">{index + 1}. {player?.name ?? row.alias ?? row.summonerName}</div>
                      <div className="text-lol-gold/70">{formatShortNumber(row.totalDamageDealtToChampions)} 딜</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CompactBanStrip({
  bans,
  getChampion,
}: {
  bans: GameBan[];
  getChampion: (id: string) => Champion | undefined;
}) {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {([1, 2] as const).map((team) => {
        const teamBans = bans.filter((ban) => ban.team === team);
        if (teamBans.length === 0) return null;
        return (
          <div key={team} className="flex min-w-0 items-center gap-2 rounded-xl border border-red-700/20 bg-red-950/10 px-2 py-1.5">
            <span className="shrink-0 text-[10px] font-semibold text-red-300/80">🚫 T{team}</span>
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {teamBans.map((ban) => {
                const champion = getChampion(ban.championId);
                return champion ? <ChampionIcon key={ban.id ?? ban.championId} champion={champion} size="sm" disabled /> : null;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GamePickPanel({
  gameId,
  team1,
  team2,
  winningTeam,
  isEditingPicks,
  sortedPlayers,
  sortedChampions,
  getChampion,
  getPlayer,
  onAddPick,
  onUpdatePick,
  onRemovePick,
}: {
  gameId: number;
  team1: EditableGamePick[];
  team2: EditableGamePick[];
  winningTeam: number | null;
  isEditingPicks: boolean;
  sortedPlayers: Player[];
  sortedChampions: Champion[];
  getChampion: (id: string) => Champion | undefined;
  getPlayer: (id: number) => Player | undefined;
  onAddPick: (gameId: number, team: 1 | 2) => void;
  onUpdatePick: (
    gameId: number,
    draftId: string,
    changes: Partial<Pick<GamePick, 'playerId' | 'championId' | 'team'>>,
  ) => void;
  onRemovePick: (gameId: number, draftId: string) => void;
}) {
  const renderTeam = (team: EditableGamePick[], teamNum: 1 | 2) => (
    <div className={`min-w-0 rounded-xl border p-2.5 ${
      teamNum === 1 ? 'border-blue-700/25 bg-blue-950/12' : 'border-red-700/25 bg-red-950/12'
    } ${winningTeam === teamNum ? 'ring-1 ring-prof-high/35' : ''}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={teamNum === 1 ? 'text-blue-300' : 'text-red-300'}>●</span>
          <span className="text-xs font-bold text-lol-gold">T{teamNum}</span>
          {winningTeam === teamNum && <span className="text-[10px] text-prof-high">WIN</span>}
        </div>
        {isEditingPicks && (
          <button
            onClick={() => onAddPick(gameId, teamNum)}
            className="cursor-pointer rounded border border-lol-border/70 px-2 py-0.5 text-[10px] text-lol-gold-light/60 hover:border-lol-gold/60 hover:text-lol-gold"
          >
            + 픽
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {team.map((pick) => {
          const champion = getChampion(pick.championId);
          const player = getPlayer(pick.playerId);
          if (isEditingPicks) {
            return (
              <div key={pick.draftId} className="flex w-full min-w-0 items-center gap-1 rounded-lg border border-lol-border/55 bg-lol-dark/45 p-1.5">
                {champion && <ChampionIcon champion={champion} size="sm" />}
                <select
                  value={pick.playerId}
                  onChange={(event) => onUpdatePick(gameId, pick.draftId, { playerId: Number(event.target.value) })}
                  className="min-w-0 flex-1 cursor-pointer rounded border border-lol-border bg-lol-dark px-1 py-0.5 text-[11px] text-lol-gold-light"
                >
                  {sortedPlayers.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                  ))}
                </select>
                <select
                  value={pick.championId}
                  onChange={(event) => onUpdatePick(gameId, pick.draftId, { championId: event.target.value })}
                  className="min-w-0 flex-1 cursor-pointer rounded border border-lol-border bg-lol-dark px-1 py-0.5 text-[11px] text-lol-gold-light"
                >
                  {sortedChampions.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.nameKo}</option>
                  ))}
                </select>
                <button
                  onClick={() => onRemovePick(gameId, pick.draftId)}
                  className="cursor-pointer px-1 text-xs text-red-400/60 hover:text-red-300"
                  title="픽 삭제"
                >
                  ×
                </button>
              </div>
            );
          }
          return (
            <div key={pick.draftId} className="flex items-center gap-1.5 rounded-lg border border-lol-border/45 bg-lol-dark/35 px-1.5 py-1">
              {champion
                ? <img src={champion.imageUrl} className="h-7 w-7 rounded object-cover" />
                : <div className="h-7 w-7 rounded border border-dashed border-lol-border/60" />}
              <div className="max-w-28 truncate text-[11px] text-lol-gold-light/75">
                {player?.name ?? '?'}
              </div>
            </div>
          );
        })}
        {team.length === 0 && (
          <div className="rounded border border-dashed border-lol-border/50 px-2 py-3 text-center text-xs text-lol-gold-light/35">
            {isEditingPicks ? '픽 추가로 기록을 채우세요.' : '픽 기록 없음'}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-2 gap-2">
      {renderTeam(team1, 1)}
      {renderTeam(team2, 2)}
    </div>
  );
}

interface ActiveGameStatsProps {
  team1: GamePick[];
  team2: GamePick[];
  wrStats: WinrateStats;
  getChampion: (id: string) => Champion | undefined;
  getPlayer: (id: number) => Player | undefined;
}

function ActiveGameStats({ team1, team2, wrStats, getChampion, getPlayer }: ActiveGameStatsProps) {
  const stats = useMemo(() => {
    const buildTeamData = (team: GamePick[]) => {
      const assignments = team.map((p) => {
        const champ = getChampion(p.championId);
        const player = getPlayer(p.playerId);
        return {
          playerId: p.playerId,
          playerName: player?.name ?? '?',
          championId: p.championId,
          championName: champ?.nameKo ?? p.championId,
          proficiency: '중' as const,
        };
      });
      const tagCounts: Record<string, number> = {};
      for (const a of assignments) {
        const t = championTraits[a.championId];
        if (!t) continue;
        for (const m of t.mechanics) tagCounts[m] = (tagCounts[m] ?? 0) + 1;
      }
      const champStats = assignments.map((a) => {
        const cs = wrStats.champOverallStats[a.championId];
        const pcs = wrStats.playerChampStats.find(
          (s) => s.playerId === a.playerId && s.championId === a.championId,
        );
        return { ...a, champOverall: cs, playerChamp: pcs };
      });
      return { assignments, tagCounts, champStats };
    };

    const t1 = buildTeamData(team1);
    const t2 = buildTeamData(team2);
    const t1WR = estimateCompWinrate(t1.assignments, wrStats, 0.5);
    const t2WR = estimateCompWinrate(t2.assignments, wrStats, 0.5);
    return { t1, t2, t1WR, t2WR };
  }, [team1, team2, wrStats, getChampion, getPlayer]);

  const renderTeam = (label: string, color: string, data: typeof stats.t1, wr: number) => {
    const tags = Object.entries(data.tagCounts).sort((a, b) => b[1] - a[1]);
    return (
      <div className={`p-3 rounded border ${color}`}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-lol-gold-light">{label}</span>
          <span className="text-sm font-bold text-lol-gold">예상 승률 {wr.toFixed(1)}%</span>
        </div>
        {data.champStats.length > 0 && (
          <div className="space-y-0.5 mb-2">
            {data.champStats.map((c) => (
              <div key={c.playerId} className="flex items-center justify-between text-xs">
                <span className="text-lol-gold-light/80 truncate">{c.playerName} · {c.championName}</span>
                <span className="text-lol-gold-light/60 ml-2 whitespace-nowrap">
                  {c.playerChamp && c.playerChamp.wins + c.playerChamp.losses > 0
                    ? `본인 ${c.playerChamp.winrate.toFixed(0)}% (${c.playerChamp.wins}/${c.playerChamp.losses})`
                    : '본인 -'}
                  {' / '}
                  {c.champOverall && c.champOverall.wins + c.champOverall.losses > 0
                    ? `전체 ${c.champOverall.winrate.toFixed(0)}%`
                    : '전체 -'}
                </span>
              </div>
            ))}
          </div>
        )}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map(([tag, n]) => (
              <span key={tag} className={`text-[10px] px-1.5 py-0.5 rounded ${getTagColor(tag as MechanicTag)}`}>
                {getTagLabel(tag as MechanicTag)}{n > 1 ? `×${n}` : ''}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-2 gap-3 mb-3 pb-3 border-b border-lol-border/50">
      {renderTeam('Team 1', 'bg-blue-950/20 border-blue-900/30', stats.t1, stats.t1WR)}
      {renderTeam('Team 2', 'bg-red-950/20 border-red-900/30', stats.t2, stats.t2WR)}
    </div>
  );
}
