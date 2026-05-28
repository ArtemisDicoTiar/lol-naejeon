import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '@/hooks/useSession';
import { useChampions } from '@/hooks/useChampions';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ChampionIcon } from '@/components/champions/ChampionIcon';
import { EogStatsPanel } from '@/components/session/EogStatsPanel';
import { StreakStrip } from '@/components/stats/StreakStrip';
import { db, GAME_MODE_LABELS, type GameBan, type GameEogCapture, type GameParticipantStat, type GamePick, type Player } from '@/lib/db';
import { useIdentityContext, useLcuContext } from '@/App';
import { computeWinrateStats, estimateCompWinrate, type WinrateStats } from '@/lib/recommendation/winrate';
import type { Champion } from '@/lib/db';
import { championTraits, type MechanicTag } from '@/data/champion-tags';
import { getTagLabel, getTagColor } from '@/data/tag-display';

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
  const autoNavigateRef = useRef(false);

  useEffect(() => { db.players.toArray().then(setPlayers); }, []);
  useEffect(() => { computeWinrateStats().then(setWrStats); }, [games]);

  // Pending game = last game without winningTeam (in progress)
  const pendingGame = useMemo(
    () => games.length > 0 ? games[games.length - 1] : null,
    [games],
  );
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
      !autoNavigateRef.current &&
      location.pathname !== '/session/new-game'
    ) {
      autoNavigateRef.current = true;
      navigate('/session/new-game?fromLcu=true');
    }
  }, [lcu.champSelectActive, lcu.connected, lcu.gameStartedAt, location.pathname, session, isMaster, navigate]);

  const loadAncillaryGameData = useCallback(async () => {
    const picks: Record<number, GamePick[]> = {};
    const bans: Record<number, GameBan[]> = {};
    const eogMap: Record<number, GameEogCapture> = {};
    const eogStatsMap: Record<number, GameParticipantStat[]> = {};

    for (const game of games) {
      picks[game.id!] = await db.gamePicks.where('gameId').equals(game.id!).toArray();
      bans[game.id!] = await db.gameBans.where('gameId').equals(game.id!).toArray();
      const capture = await db.gameEogCaptures.where('gameId').equals(game.id!).last();
      if (capture) {
        eogMap[game.id!] = capture;
        eogStatsMap[game.id!] = await db.gameParticipantStats.where('captureId').equals(capture.id!).toArray();
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
  const bannedChampions = champions.filter((c) => fierlessBans.includes(c.id));
  const availableCount = champions.length - fierlessBans.length;

  const handleEndSession = async () => {
    if (!confirm('세션을 종료하시겠습니까? 종료 후에는 게임을 추가할 수 없습니다.')) return;
    const syncMsg = await endSession(isMaster);
    if (syncMsg) alert(syncMsg);
    navigate('/');
  };

  if (loading) return <div className="text-center py-8 text-lol-gold">로딩 중...</div>;

  if (!session) {
    return (
      <div className="text-center py-16 space-y-4">
        <p className="text-lol-gold-light/60">활성 세션이 없습니다.</p>
        <Link to="/"><Button>대시보드로 이동</Button></Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-lol-gold">{session.name}</h1>
          <span className="text-sm text-lol-gold-light/50">
            {new Date(session.createdAt).toLocaleString('ko-KR')} 시작
          </span>
        </div>
        <div className="flex gap-2">
          <Link to="/session/new-game">
            <Button>새 게임</Button>
          </Link>
          <Button variant="danger" onClick={handleEndSession}>세션 종료</Button>
        </div>
      </div>

      {/* Team carry-over */}
      {lastGameTeams && (
        <Card title="다음 게임">
          <div className="flex items-center gap-4 mb-3">
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
          <div className="flex gap-2">
            <Link to="/session/new-game?keepTeams=true">
              <Button size="sm">팀 유지하고 새 게임</Button>
            </Link>
            <Link to="/session/new-game">
              <Button variant="secondary" size="sm">팀 변경하고 새 게임</Button>
            </Link>
          </div>
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
            <span className={`px-2 py-1 rounded border ${
              lcu.eog.status === 'captured'
                ? 'border-prof-high/40 text-prof-high'
                : lcu.eog.status === 'failed'
                  ? 'border-red-700/40 text-red-300'
                  : 'border-lol-gold/40 text-lol-gold'
            }`}>
              {lcu.eog.status === 'captured' ? 'EOG 수집 완료' : lcu.eog.status === 'failed' ? 'EOG 수집 실패' : 'EOG 수집 중'}
            </span>
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
        {bannedChampions.length === 0 ? (
          <p className="text-lol-gold-light/50 text-center py-4">첫 게임을 시작하세요!</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {bannedChampions.map((c) => <ChampionIcon key={c.id} champion={c} size="sm" disabled showName />)}
          </div>
        )}
      </Card>

      {/* Live game picks correction — shown when bridge sends actual picks */}
      {liveGamePlayers && pendingGame && pendingGame.winningTeam === null && (
        <Card title="🎮 실제 픽 확인 (게임 중)">
          <p className="text-xs text-lol-gold-light/60 mb-3">
            게임 클라이언트에서 실제 픽 정보를 가져왔습니다. 잘못 기록된 픽이 있다면 여기서 보정할 수 있습니다.
          </p>
          <button
            onClick={() => setShowLivePanel(!showLivePanel)}
            className="cursor-pointer text-sm text-lol-gold-light/70 hover:text-lol-gold mb-3">
            {showLivePanel ? '▲ 숨기기' : '▼ 픽 정보 보기'}
          </button>
          {showLivePanel && correctedPicks && (
            <div className="space-y-3">
              {([
                { label: 'T1 (ORDER/블루)', team: correctedPicks.team1 },
                { label: 'T2 (CHAOS/레드)', team: correctedPicks.team2 },
              ] as const).map(({ label, team }) => (
                <div key={label}>
                  <div className="text-xs text-lol-gold-light/50 mb-1">{label}</div>
                  <div className="space-y-1">
                    {team.map((row, i) => {
                      const recorded = pendingGamePicks.find((p) =>
                        row.player && p.playerId === row.player.id && p.team === row.teamNum,
                      );
                      const matches = recorded?.championId === row.champ?.id;
                      return (
                        <div key={i} className={`flex items-center gap-2 p-1.5 rounded text-sm ${
                          !row.player ? 'opacity-50' : matches ? '' : 'bg-yellow-900/20 border border-yellow-700/30'
                        }`}>
                          {row.champ && <img src={row.champ.imageUrl} className="w-7 h-7 rounded" />}
                          <span className="text-lol-gold-light">
                            {row.player?.name ?? row.livePlayer.alias ?? row.livePlayer.summonerName}
                          </span>
                          <span className="text-lol-gold-light/60">{row.champ?.nameKo ?? row.livePlayer.championName}</span>
                          {!row.player && <span className="text-yellow-400/70 text-xs">(매핑 없음)</span>}
                          {row.player && !matches && recorded && (
                            <span className="text-yellow-400/70 text-xs">
                              ← 기록: {champions.find((c) => c.id === recorded.championId)?.nameKo ?? recorded.championId}
                            </span>
                          )}
                          {row.player && !matches && !recorded && (
                            <span className="text-yellow-400/70 text-xs">← 기록 없음</span>
                          )}
                          {matches && <span className="text-prof-high/60 text-xs">✓ 일치</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="pt-2 flex gap-2">
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
          )}
        </Card>
      )}

      {/* Games */}
      <Card title={`게임 기록 (${games.length}개)`}>
        {games.length === 0 ? (
          <p className="text-lol-gold-light/50 text-center py-4">진행된 게임이 없습니다.</p>
        ) : (
          <div className="space-y-4">
            {games.map((game, idx) => {
              const picks = gamePicks[game.id!] ?? [];
              const bans = gameBansMap[game.id!] ?? [];
              const eogCapture = gameEogMap[game.id!];
              const eogStats = gameParticipantStatsMap[game.id!] ?? [];
              const team1 = picks.filter((p) => p.team === 1);
              const team2 = picks.filter((p) => p.team === 2);
              const isLatest = idx === games.length - 1;
              return (
                <div key={game.id} className="p-4 bg-lol-blue rounded border border-lol-border">
                  {bans.length > 0 && (
                    <div className="flex gap-4 mb-3 pb-2 border-b border-lol-border/50">
                      {([1, 2] as const).map((t) => {
                        const teamBanList = bans.filter((b) => b.team === t);
                        if (teamBanList.length === 0) return null;
                        return (
                          <div key={t} className="flex items-center gap-1.5">
                            <span className="text-[10px] text-red-400/70">T{t} 밴</span>
                            {teamBanList.map((b) => {
                              const champ = getChampion(b.championId);
                              return champ ? <ChampionIcon key={b.id} champion={champ} size="sm" disabled /> : null;
                            })}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lol-gold font-bold">Game #{game.gameNumber}</span>
                      <span className="text-xs bg-lol-gold/20 text-lol-gold px-2 py-0.5 rounded">{game.format}</span>
                      <button
                        onClick={() => setGameMode(game.id!, game.mode === 'augmented' ? 'aram' : 'augmented')}
                        title="클릭해서 모드 전환"
                        className={`cursor-pointer text-xs px-2 py-0.5 rounded transition-colors ${
                          (game.mode ?? 'aram') === 'augmented'
                            ? 'bg-purple-900/40 text-purple-300 border border-purple-700/50 hover:bg-purple-800/50'
                            : 'bg-lol-blue/40 text-lol-gold-light/70 border border-lol-border hover:border-lol-gold/50'
                        }`}>
                        {GAME_MODE_LABELS[game.mode ?? 'aram']}
                      </button>
                      {eogCapture && (
                        <span className={`text-[10px] px-2 py-0.5 rounded border ${
                          eogCapture.status === 'captured'
                            ? 'border-prof-high/30 text-prof-high'
                            : eogCapture.status === 'unlinked'
                              ? 'border-yellow-700/30 text-yellow-300'
                              : 'border-red-700/30 text-red-300'
                        }`}>
                          EOG {eogCapture.status === 'captured' ? '완료' : eogCapture.status === 'unlinked' ? '미연결' : '실패'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {game.winningTeam ? (
                        <span className="text-prof-high text-sm font-medium">Team {game.winningTeam} 승리</span>
                      ) : (
                        <div className="flex gap-2">
                          <Button size="sm" variant="secondary" onClick={() => setGameResult(game.id!, 1)}>T1 승</Button>
                          <Button size="sm" variant="secondary" onClick={() => setGameResult(game.id!, 2)}>T2 승</Button>
                        </div>
                      )}
                      <Button size="sm" variant="danger" onClick={() => {
                        if (confirm(`Game #${game.gameNumber}을 삭제하시겠습니까?`)) removeGame(game.id!);
                      }}>삭제</Button>
                    </div>
                  </div>
                  {isLatest && wrStats && picks.length > 0 && (
                    <ActiveGameStats
                      team1={team1}
                      team2={team2}
                      wrStats={wrStats}
                      getChampion={getChampion}
                      getPlayer={getPlayer}
                    />
                  )}
                  {eogCapture && eogStats.length > 0 && (
                    <div className="mb-3 pb-3 border-b border-lol-border/50">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs text-lol-gold-light/60">
                          종료 후 통계 · {new Date(eogCapture.capturedAt).toLocaleTimeString('ko-KR')}
                        </div>
                        <div className="text-[10px] text-lol-gold-light/45">
                          {eogCapture.mappedParticipants}/{eogCapture.participantCount}명 매핑
                        </div>
                      </div>
                      <EogStatsPanel
                        participantStats={eogStats}
                        players={players}
                        champions={champions}
                        winnerTeam={eogCapture.winnerTeam}
                      />
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    {[{ team: team1, num: 1 }, { team: team2, num: 2 }].map(({ team, num }) => (
                      <div key={num} className={`p-2 rounded ${game.winningTeam === num ? 'bg-prof-high/10 border border-prof-high/30' : 'bg-lol-dark/50'}`}>
                        <div className="text-xs text-lol-gold mb-2 font-medium">Team {num}</div>
                        <div className="space-y-1">
                          {team.map((pick) => {
                            const champ = getChampion(pick.championId);
                            const player = getPlayer(pick.playerId);
                            return (
                              <div key={pick.id} className="flex items-center gap-2">
                                {champ && <ChampionIcon champion={champ} size="sm" />}
                                <div>
                                  <span className="text-sm text-lol-gold-light">{player?.name}</span>
                                  <span className="text-xs text-lol-gold-light/50 ml-1">{champ?.nameKo}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
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
