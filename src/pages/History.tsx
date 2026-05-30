import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ActionGroup, EmptyState, PageHeader, StatusPill } from '@/components/ui/Page';
import { ChampionIcon } from '@/components/champions/ChampionIcon';
import { db, deleteSession, GAME_MODE_LABELS, updateGameMode, updateSessionName, type Champion, type Game, type GameEogCapture, type GameMode, type GameParticipantStat, type GamePick, type Player, type Session } from '@/lib/db';
import { importRetroCustomGames } from '@/lib/history-import';
import { syncToVercel } from '@/lib/auto-sync';
import { useIdentityContext, useLcuContext } from '@/App';
import { resolveParticipantStatsToPicks } from '@/lib/participant-stats';

interface GameWithDetails extends Game {
  picks: GamePick[];
  eogCapture: GameEogCapture | null;
  participantStats: GameParticipantStat[];
}

interface SessionWithGames extends Session {
  games: GameWithDetails[];
}

export function History() {
  const { isMaster } = useIdentityContext();
  const lcu = useLcuContext();
  const [sessions, setSessions] = useState<SessionWithGames[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [champions, setChampions] = useState<Champion[]>([]);
  const [loading, setLoading] = useState(true);
  const [retroStatus, setRetroStatus] = useState('');
  const [retroLoading, setRetroLoading] = useState(false);
  const [editingGameId, setEditingGameId] = useState<number | null>(null);
  const [draftPicksByGameId, setDraftPicksByGameId] = useState<Record<number, GamePick[]>>({});

  const loadSessions = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const [allSessions, allPlayers, allChampions] = await Promise.all([
        db.sessions.toArray(),
        db.players.toArray(),
        db.champions.toArray(),
      ]);
      setPlayers(allPlayers);
      setChampions(allChampions);

      const sessionsWithGames: SessionWithGames[] = [];
      for (const session of allSessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())) {
        const games = await db.games.where('sessionId').equals(session.id!).toArray();
        games.sort((a, b) => a.gameNumber - b.gameNumber);
        const gamesWithDetails = await Promise.all(
          games.map(async (game) => {
            const picks = await db.gamePicks.where('gameId').equals(game.id!).toArray();
            const eogCapture = await db.gameEogCaptures.where('gameId').equals(game.id!).last();
            const rawParticipantStats = eogCapture?.id
              ? await db.gameParticipantStats.where('captureId').equals(eogCapture.id).toArray()
              : [];
            const participantStats = resolveParticipantStatsToPicks(rawParticipantStats, picks, {
              preferPickChampion: true,
            });
            return { ...game, picks, eogCapture: eogCapture ?? null, participantStats };
          }),
        );
        gamesWithDetails.sort((a, b) => {
          const aPending = a.winningTeam === null;
          const bPending = b.winningTeam === null;
          if (aPending !== bPending) return aPending ? -1 : 1;
          return b.gameNumber - a.gameNumber;
        });
        if (gamesWithDetails.length > 0) {
          sessionsWithGames.push({ ...session, games: gamesWithDetails });
        }
      }

      setSessions(sessionsWithGames);
    } catch (error) {
      console.error('Failed to load history:', error);
      if (showLoading) setSessions([]);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadSessions(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadSessions]);
  useEffect(() => {
    const handleDataChanged = () => { void loadSessions(false); };
    window.addEventListener('lol-data-changed', handleDataChanged);
    return () => window.removeEventListener('lol-data-changed', handleDataChanged);
  }, [loadSessions]);

  const handleDeleteSession = async (sid: number, name: string) => {
    if (!confirm(`"${name}" 세션을 삭제하시겠습니까? 모든 게임 기록도 함께 삭제됩니다.`)) return;
    await deleteSession(sid);
    await loadSessions();
  };

  const handleRenameSession = async (sid: number, currentName: string) => {
    const newName = prompt('새 세션 이름:', currentName);
    if (!newName || newName === currentName) return;
    await updateSessionName(sid, newName);
    await loadSessions();
  };

  const handleToggleGameMode = async (game: GameWithDetails) => {
    const nextMode: GameMode = (game.mode ?? 'aram') === 'augmented' ? 'aram' : 'augmented';
    await updateGameMode(game.id!, nextMode);
    await loadSessions(false);
    if (isMaster) {
      await syncToVercel();
    }
    window.dispatchEvent(new CustomEvent('lol-data-changed', {
      detail: { source: 'history-mode-edit', gameId: game.id, mode: nextMode },
    }));
  };

  const handleRemapGameEogStats = async (game: GameWithDetails) => {
    if (!game.eogCapture?.id) return;
    const [picks, participantRows] = await Promise.all([
      db.gamePicks.where('gameId').equals(game.id!).toArray(),
      db.gameParticipantStats.where('captureId').equals(game.eogCapture.id).toArray(),
    ]);
    const resolvedRows = resolveParticipantStatsToPicks(participantRows, picks, {
      preferPickChampion: true,
    });

    await db.transaction('rw', [db.gameEogCaptures, db.gameParticipantStats], async () => {
      for (const row of resolvedRows) {
        if (!row.id) continue;
        await db.gameParticipantStats.update(row.id, {
          playerId: row.playerId,
          championId: row.championId,
          team: row.team,
          alias: row.alias,
        });
      }
      await db.gameEogCaptures.update(game.eogCapture!.id!, {
        mappedParticipants: resolvedRows.filter((row) => typeof row.playerId === 'number').length,
      });
    });

    await loadSessions(false);
    if (isMaster) {
      await syncToVercel();
    }
    window.dispatchEvent(new CustomEvent('lol-data-changed', {
      detail: { source: 'history-eog-remap', gameId: game.id },
    }));
  };

  const getPlayer = (id: number) => players.find((player) => player.id === id);
  const getChampion = (id: string) => champions.find((champion) => champion.id === id);

  const sortedPlayers = [...players].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const sortedChampions = [...champions].sort((a, b) => a.nameKo.localeCompare(b.nameKo, 'ko'));

  const startEditingGame = (game: GameWithDetails) => {
    setEditingGameId(game.id!);
    setDraftPicksByGameId((prev) => ({
      ...prev,
      [game.id!]: game.picks.map((pick) => ({ ...pick })),
    }));
  };

  const updateDraftPick = (
    gameId: number,
    pickId: number,
    changes: Partial<Pick<GamePick, 'playerId' | 'championId'>>,
  ) => {
    setDraftPicksByGameId((prev) => ({
      ...prev,
      [gameId]: (prev[gameId] ?? []).map((pick) =>
        pick.id === pickId ? { ...pick, ...changes } : pick,
      ),
    }));
  };

  const cancelEditingGame = (gameId: number) => {
    setEditingGameId(null);
    setDraftPicksByGameId((prev) => {
      const next = { ...prev };
      delete next[gameId];
      return next;
    });
  };

  const saveEditingGame = async (gameId: number) => {
    const draftPicks = draftPicksByGameId[gameId] ?? [];
    if (draftPicks.length === 0) {
      cancelEditingGame(gameId);
      return;
    }
    await db.transaction('rw', [db.gamePicks, db.gameParticipantStats], async () => {
      const currentPicks = await db.gamePicks.where('gameId').equals(gameId).toArray();

      for (const draftPick of draftPicks) {
        await db.gamePicks.update(draftPick.id!, {
          playerId: draftPick.playerId,
          championId: draftPick.championId,
        });
      }

      const participantRows = await db.gameParticipantStats.where('gameId').equals(gameId).toArray();
      const draftById = new Map(draftPicks.map((pick) => [pick.id, pick]));
      const updatedPicks = currentPicks.map((pick) => draftById.get(pick.id) ?? pick);
      const resolvedParticipantRows = resolveParticipantStatsToPicks(participantRows, updatedPicks, {
        preferPickChampion: true,
      });

      for (const row of resolvedParticipantRows) {
        if (!row.id) continue;
        await db.gameParticipantStats.update(row.id, {
          playerId: row.playerId,
          championId: row.championId,
          team: row.team,
          alias: row.alias,
        });
      }
    });
    setEditingGameId(null);
    setDraftPicksByGameId((prev) => {
      const next = { ...prev };
      delete next[gameId];
      return next;
    });
    await loadSessions(false);
    if (isMaster) {
      await syncToVercel();
    }
    window.dispatchEvent(new CustomEvent('lol-data-changed', { detail: { source: 'history-edit', gameId } }));
  };

  const handleImportRecentCustomGames = async () => {
    if (!lcu.connected) {
      setRetroStatus('브릿지가 연결되어 있어야 최근 커스텀 경기를 가져올 수 있습니다.');
      return;
    }

    setRetroLoading(true);
    setRetroStatus('최근 커스텀 경기 조회 중...');
    try {
      const games = await lcu.fetchRecentCustomGames(20);
      const result = await importRetroCustomGames(games);
      await loadSessions(false);
      let syncMessage = '';
      if (isMaster) {
        const syncResult = await syncToVercel();
        syncMessage = ` · ${syncResult.message}`;
      }
      setRetroStatus(`가져오기 완료: ${result.imported}개 추가, ${result.updated}개 덮어씀, ${result.skipped}개 건너뜀${syncMessage}`);
    } catch (error) {
      setRetroStatus(`가져오기 실패: ${(error as Error).message}`);
    } finally {
      setRetroLoading(false);
    }
  };

  if (loading) return <div className="text-center py-8 text-lol-gold">로딩 중...</div>;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Match Archive"
        title="게임 기록"
        description="세션별 경기, 픽/밴, 종료 후 세부 통계, 과거 커스텀 경기 가져오기를 관리합니다."
        meta={(
          <>
            <StatusPill tone="gold">{sessions.length}개 세션</StatusPill>
            <StatusPill tone="blue">{sessions.reduce((sum, session) => sum + session.games.length, 0)}게임</StatusPill>
            {lcu.connected ? <StatusPill tone="green">클라 연결됨</StatusPill> : <StatusPill>클라 미연결</StatusPill>}
          </>
        )}
        actions={isMaster ? (
          <Button variant="secondary" onClick={handleImportRecentCustomGames} disabled={retroLoading}>
            {retroLoading ? '가져오는 중...' : '최근 커스텀 가져오기'}
          </Button>
        ) : undefined}
      />

      {retroStatus && (
        <div className="rounded-lg border border-lol-border bg-lol-gray px-3 py-2 text-sm text-lol-gold-light/85">
          {retroStatus}
        </div>
      )}

      {sessions.length === 0 ? (
        <EmptyState
          title="아직 기록된 게임이 없습니다."
          description="세션을 진행하거나 클라이언트 연결 후 최근 커스텀 경기를 가져오면 기록이 쌓입니다."
        />
      ) : (
        sessions.map((session) => {
          const completedCount = session.games.filter((game) => game.winningTeam !== null).length;
          const team1Wins = session.games.filter((game) => game.winningTeam === 1).length;
          const team2Wins = session.games.filter((game) => game.winningTeam === 2).length;
          const scoreTotal = Math.max(team1Wins + team2Wins, 1);
          return (
          <Card key={session.id} title={session.name}>
            <div className="mb-3 rounded-xl border border-lol-border/70 bg-lol-dark/35 p-3">
              <div className="mb-2 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone="gold">◷ {new Date(session.createdAt).toLocaleDateString('ko-KR')}</StatusPill>
                  <StatusPill tone="blue">⚔ {session.games.length}게임</StatusPill>
                  <StatusPill tone="green">✓ {completedCount}완료</StatusPill>
                </div>
                <ActionGroup>
                  <Button size="sm" variant="ghost" onClick={() => handleRenameSession(session.id!, session.name)}>이름 수정</Button>
                  <Button size="sm" variant="danger" onClick={() => handleDeleteSession(session.id!, session.name)}>세션 삭제</Button>
                </ActionGroup>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-lol-blue">
                <div className="bg-blue-500/85" style={{ width: `${(team1Wins / scoreTotal) * 100}%` }} />
                <div className="bg-red-500/85" style={{ width: `${(team2Wins / scoreTotal) * 100}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-[11px]">
                <span className="text-blue-300">T1 {team1Wins}승</span>
                <span className="text-red-300">T2 {team2Wins}승</span>
              </div>
            </div>
            <div className="space-y-2">
              {session.games.map((game) => {
                const isEditing = editingGameId === game.id;
                const displayPicks = isEditing
                  ? (draftPicksByGameId[game.id!] ?? game.picks)
                  : game.picks;
                const displayTeam1 = displayPicks.filter((pick) => pick.team === 1);
                const displayTeam2 = displayPicks.filter((pick) => pick.team === 2);
                return (
                  <div key={game.id} className="overflow-hidden rounded-xl border border-lol-border/80 bg-[linear-gradient(135deg,rgba(10,20,40,0.92),rgba(1,10,19,0.68))]">
                    <div className="flex flex-col gap-2 border-b border-lol-border/55 bg-lol-dark/25 p-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-black ${
                          game.winningTeam === 1
                            ? 'border-blue-500/45 bg-blue-950/35 text-blue-200'
                            : game.winningTeam === 2
                              ? 'border-red-500/45 bg-red-950/35 text-red-200'
                              : 'border-yellow-500/35 bg-yellow-950/25 text-yellow-200'
                        }`}>
                          {game.winningTeam ? `T${game.winningTeam}` : '…'}
                        </span>
                        <span className="text-sm font-bold text-lol-gold">#{game.gameNumber}</span>
                        <span title="포맷" className="rounded border border-lol-border/60 bg-lol-dark/45 px-2 py-0.5 text-[11px] text-lol-gold-light/65">
                          ⚔ {game.format}
                        </span>
                        <button
                          disabled={!isMaster}
                          onClick={() => isMaster ? void handleToggleGameMode(game) : undefined}
                          title={isMaster ? '클릭해서 모드 전환' : undefined}
                          className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
                            (game.mode ?? 'aram') === 'augmented'
                              ? 'border-purple-700/50 bg-purple-900/40 text-purple-300'
                              : 'border-lol-border bg-lol-blue/40 text-lol-gold-light/70'
                          } ${isMaster ? 'cursor-pointer hover:border-lol-gold/50' : ''}`}
                        >
                          {(game.mode ?? 'aram') === 'augmented' ? '✦' : '❄'} {GAME_MODE_LABELS[game.mode ?? 'aram']}
                        </button>
                        <span className="truncate text-[11px] text-lol-gold-light/35">
                          ◷ {new Date(game.playedAt).toLocaleString('ko-KR')}
                        </span>
                        {game.eogCapture && <StatusPill tone="green" className="px-2 py-0.5 text-[10px]">📊 EOG</StatusPill>}
                      </div>
                      <ActionGroup>
                        {game.winningTeam && (
                          <StatusPill tone={game.winningTeam === 1 ? 'blue' : 'red'}>🏆 Team {game.winningTeam}</StatusPill>
                        )}
                        {isMaster && (
                          <>
                            {game.eogCapture && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void handleRemapGameEogStats(game)}
                              >
                                통계 재매핑
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant={isEditing ? 'primary' : 'ghost'}
                              onClick={() => isEditing ? void saveEditingGame(game.id!) : startEditingGame(game)}
                            >
                              {isEditing ? '픽 수정 완료' : '픽 수정'}
                            </Button>
                            {isEditing && (
                              <Button size="sm" variant="ghost" onClick={() => cancelEditingGame(game.id!)}>
                                취소
                              </Button>
                            )}
                          </>
                        )}
                      </ActionGroup>
                    </div>
                    <div className="space-y-3 p-3">
                      <HistoryPickGrid
                        gameId={game.id!}
                        team1={displayTeam1}
                        team2={displayTeam2}
                        winningTeam={game.winningTeam}
                        isEditing={isEditing}
                        sortedPlayers={sortedPlayers}
                        sortedChampions={sortedChampions}
                        getPlayer={getPlayer}
                        getChampion={getChampion}
                        onUpdatePick={updateDraftPick}
                      />
                    {game.eogCapture && game.participantStats.length > 0 && (
                      <div className="rounded-xl border border-lol-border/60 bg-lol-dark/30 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-lol-gold-light/70">
                            📊 {new Date(game.eogCapture.capturedAt).toLocaleTimeString('ko-KR')}
                          </div>
                          <div className="text-[10px] text-lol-gold-light/45">
                            매핑 {game.eogCapture.mappedParticipants}/{game.eogCapture.participantCount}
                          </div>
                        </div>
                        <HistoryEogSummary
                          participantStats={game.participantStats}
                          getPlayer={getPlayer}
                          getChampion={getChampion}
                          winnerTeam={game.eogCapture.winnerTeam}
                        />
                      </div>
                    )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
          );
        })
      )}
    </div>
  );
}

function formatHistoryNumber(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}만`;
  return Math.round(value).toLocaleString('ko-KR');
}

function HistoryPickGrid({
  gameId,
  team1,
  team2,
  winningTeam,
  isEditing,
  sortedPlayers,
  sortedChampions,
  getPlayer,
  getChampion,
  onUpdatePick,
}: {
  gameId: number;
  team1: GamePick[];
  team2: GamePick[];
  winningTeam: number | null;
  isEditing: boolean;
  sortedPlayers: Player[];
  sortedChampions: Champion[];
  getPlayer: (id: number) => Player | undefined;
  getChampion: (id: string) => Champion | undefined;
  onUpdatePick: (
    gameId: number,
    pickId: number,
    changes: Partial<Pick<GamePick, 'playerId' | 'championId'>>,
  ) => void;
}) {
  const renderTeam = (team: GamePick[], teamNum: 1 | 2) => (
    <div className={`min-w-0 rounded-xl border p-2.5 ${
      teamNum === 1 ? 'border-blue-700/25 bg-blue-950/12' : 'border-red-700/25 bg-red-950/12'
    } ${winningTeam === teamNum ? 'ring-1 ring-prof-high/35' : ''}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className={`text-xs font-bold ${teamNum === 1 ? 'text-blue-300' : 'text-red-300'}`}>● T{teamNum}</span>
        {winningTeam === teamNum && <span className="text-[10px] text-prof-high">WIN</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {team.map((pick) => {
          const champion = getChampion(pick.championId);
          const player = getPlayer(pick.playerId);
          if (isEditing) {
            return (
              <div key={pick.id} className="flex w-full min-w-0 items-center gap-1 rounded-lg border border-lol-border/55 bg-lol-dark/45 p-1.5">
                {champion && <ChampionIcon champion={champion} size="sm" />}
                <select
                  value={pick.playerId}
                  onChange={(event) => onUpdatePick(gameId, pick.id!, { playerId: Number(event.target.value) })}
                  className="min-w-0 flex-1 cursor-pointer rounded border border-lol-border bg-lol-dark px-1 py-0.5 text-[11px] text-lol-gold-light"
                >
                  {sortedPlayers.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                  ))}
                </select>
                <select
                  value={pick.championId}
                  onChange={(event) => onUpdatePick(gameId, pick.id!, { championId: event.target.value })}
                  className="min-w-0 flex-1 cursor-pointer rounded border border-lol-border bg-lol-dark px-1 py-0.5 text-[11px] text-lol-gold-light"
                >
                  {sortedChampions.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.nameKo}</option>
                  ))}
                </select>
              </div>
            );
          }
          return (
            <div
              key={pick.id}
              title={`${player?.name ?? '?'} · ${champion?.nameKo ?? pick.championId}`}
              className="flex items-center gap-1.5 rounded-lg border border-lol-border/45 bg-lol-dark/35 px-1.5 py-1"
            >
              {champion
                ? <img src={champion.imageUrl} className="h-7 w-7 rounded object-cover" />
                : <div className="h-7 w-7 rounded border border-dashed border-lol-border/60" />}
              <span className="max-w-24 truncate text-[11px] text-lol-gold-light/75">
                {player?.name ?? '?'}
              </span>
            </div>
          );
        })}
        {team.length === 0 && <div className="text-xs text-lol-gold-light/35">픽 없음</div>}
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

function HistoryEogSummary({
  participantStats,
  getPlayer,
  getChampion,
  winnerTeam,
}: {
  participantStats: GameParticipantStat[];
  getPlayer: (id: number) => Player | undefined;
  getChampion: (id: string) => Champion | undefined;
  winnerTeam?: number | null;
}) {
  const teamDamage = [1, 2].map((team) =>
    participantStats
      .filter((row) => row.team === team)
      .reduce((sum, row) => sum + row.totalDamageDealtToChampions, 0),
  );
  const maxTeamDamage = Math.max(...teamDamage, 1);
  const maxPlayerDamage = Math.max(...participantStats.map((row) => row.totalDamageDealtToChampions), 1);
  const rowsByTeam = [1, 2].map((team) =>
    participantStats
      .filter((row) => row.team === team)
      .sort((a, b) => b.totalDamageDealtToChampions - a.totalDamageDealtToChampions),
  );

  const renderPlayerDamageRows = (team: 1 | 2) => {
    const rows = rowsByTeam[team - 1];
    return (
      <div className={`rounded-lg border p-2.5 ${
        team === 1 ? 'border-blue-700/25 bg-blue-950/12' : 'border-red-700/25 bg-red-950/12'
      }`}>
        <div className={`mb-2 flex items-center justify-between text-xs font-bold ${team === 1 ? 'text-blue-300' : 'text-red-300'}`}>
          <span>T{team} 플레이어 딜량</span>
          {winnerTeam === team && <span className="text-[10px] text-prof-high">WIN</span>}
        </div>
        <div className="space-y-1.5">
          {rows.map((row, index) => {
            const champion = row.championId ? getChampion(row.championId) : undefined;
            const player = row.playerId ? getPlayer(row.playerId) : undefined;
            return (
              <div key={row.id ?? `${row.summonerName}-${team}-${index}`} className="rounded-lg border border-lol-border/40 bg-lol-dark/40 p-1.5">
                <div className="mb-1 flex items-center gap-2">
                  {champion
                    ? <img src={champion.imageUrl} className="h-7 w-7 rounded object-cover" />
                    : <div className="h-7 w-7 rounded border border-dashed border-lol-border/60" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] text-lol-gold-light/80">
                      {player?.name ?? row.alias ?? row.summonerName}
                    </div>
                    <div className="truncate text-[10px] text-lol-gold-light/38">
                      {champion?.nameKo ?? row.championId ?? '챔피언 미상'} · {row.kills}/{row.deaths}/{row.assists}
                    </div>
                  </div>
                  <div className="shrink-0 text-[10px] font-bold text-lol-gold">
                    {formatHistoryNumber(row.totalDamageDealtToChampions)}
                  </div>
                </div>
                <div className={`flex h-1.5 overflow-hidden rounded-full bg-lol-blue ${team === 1 ? 'justify-end' : ''}`}>
                  <div
                    className={`h-full rounded-full ${team === 1 ? 'bg-blue-500/85' : 'bg-red-500/85'}`}
                    style={{ width: `${(row.totalDamageDealtToChampions / maxPlayerDamage) * 100}%` }}
                  />
                </div>
              </div>
            );
          })}
          {rows.length === 0 && <div className="text-xs text-lol-gold-light/35">수집된 딜량 없음</div>}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-lol-border/55 bg-lol-dark/35 p-2.5">
        <div className="mb-2 flex items-center justify-between text-xs text-lol-gold-light/50">
          <span>⚔ 팀 딜량 비교</span>
          <span>{formatHistoryNumber(teamDamage[0] + teamDamage[1])} total</span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div>
            <div className="mb-1 flex justify-between text-[11px]">
              <span className="text-blue-300">T1{winnerTeam === 1 ? ' WIN' : ''}</span>
              <span className="text-lol-gold-light/60">{formatHistoryNumber(teamDamage[0])}</span>
            </div>
            <div className="flex h-3 justify-end overflow-hidden rounded-l-full bg-lol-blue">
              <div
                className="h-full rounded-l-full bg-blue-500/85"
                style={{ width: `${(teamDamage[0] / maxTeamDamage) * 100}%` }}
              />
            </div>
          </div>
          <div className="mt-5 text-[10px] font-black text-lol-gold-light/35">VS</div>
          <div>
            <div className="mb-1 flex justify-between text-[11px]">
              <span className="text-lol-gold-light/60">{formatHistoryNumber(teamDamage[1])}</span>
              <span className="text-red-300">T2{winnerTeam === 2 ? ' WIN' : ''}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-r-full bg-lol-blue">
              <div
                className="h-full rounded-r-full bg-red-500/85"
                style={{ width: `${(teamDamage[1] / maxTeamDamage) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {renderPlayerDamageRows(1)}
        {renderPlayerDamageRows(2)}
      </div>
    </div>
  );
}
