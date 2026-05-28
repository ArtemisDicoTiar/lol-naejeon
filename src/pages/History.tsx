import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ChampionIcon } from '@/components/champions/ChampionIcon';
import { EogStatsPanel } from '@/components/session/EogStatsPanel';
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
      if (gamesWithDetails.length > 0) {
        sessionsWithGames.push({ ...session, games: gamesWithDetails });
      }
    }

    setSessions(sessionsWithGames);
    setLoading(false);
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
      setRetroStatus(`가져오기 완료: ${result.imported}개 추가, ${result.skipped}개 건너뜀`);
    } catch (error) {
      setRetroStatus(`가져오기 실패: ${(error as Error).message}`);
    } finally {
      setRetroLoading(false);
    }
  };

  if (loading) return <div className="text-center py-8 text-lol-gold">로딩 중...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-lol-gold">게임 기록</h1>
        {isMaster && (
          <Button variant="secondary" onClick={handleImportRecentCustomGames} disabled={retroLoading}>
            {retroLoading ? '가져오는 중...' : '최근 커스텀 가져오기'}
          </Button>
        )}
      </div>

      {retroStatus && (
        <div className="rounded border border-lol-border bg-lol-gray px-4 py-3 text-sm text-lol-gold-light/85">
          {retroStatus}
        </div>
      )}

      {sessions.length === 0 ? (
        <Card>
          <p className="text-center py-8 text-lol-gold-light/50">
            아직 기록된 게임이 없습니다.
          </p>
        </Card>
      ) : (
        sessions.map((session) => (
          <Card key={session.id} title={`${session.name} (${session.games.length}게임)`}>
            <div className="flex gap-2 mb-3">
              <Button size="sm" variant="ghost" onClick={() => handleRenameSession(session.id!, session.name)}>이름 수정</Button>
              <Button size="sm" variant="danger" onClick={() => handleDeleteSession(session.id!, session.name)}>세션 삭제</Button>
            </div>
            <div className="space-y-4">
              {session.games.map((game) => {
                const isEditing = editingGameId === game.id;
                const displayPicks = isEditing
                  ? (draftPicksByGameId[game.id!] ?? game.picks)
                  : game.picks;
                const displayTeam1 = displayPicks.filter((pick) => pick.team === 1);
                const displayTeam2 = displayPicks.filter((pick) => pick.team === 2);
                return (
                  <div key={game.id} className="p-3 bg-lol-blue rounded border border-lol-border">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lol-gold font-medium text-sm">
                          #{game.gameNumber} {game.format}
                        </span>
                        <button
                          disabled={!isMaster}
                          onClick={() => isMaster ? void handleToggleGameMode(game) : undefined}
                          title={isMaster ? '클릭해서 모드 전환' : undefined}
                          className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                            (game.mode ?? 'aram') === 'augmented'
                              ? 'border-purple-700/50 bg-purple-900/40 text-purple-300'
                              : 'border-lol-border bg-lol-blue/40 text-lol-gold-light/70'
                          } ${isMaster ? 'cursor-pointer hover:border-lol-gold/50' : ''}`}
                        >
                          {GAME_MODE_LABELS[game.mode ?? 'aram']}
                        </button>
                        <span className="text-[10px] text-lol-gold-light/35">
                          {new Date(game.playedAt).toLocaleString('ko-KR')}
                        </span>
                        {game.eogCapture && (
                          <span className="text-[10px] px-2 py-0.5 rounded border border-prof-high/30 text-prof-high">
                            EOG
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {game.winningTeam && (
                          <span className="text-prof-high text-xs">Team {game.winningTeam} 승</span>
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
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      {[displayTeam1, displayTeam2].map((team, idx) => (
                        <div key={idx} className="space-y-1">
                          <div className="text-xs text-lol-gold/70">Team {idx + 1}</div>
                          {team.map((pick) => {
                            const champion = getChampion(pick.championId);
                            if (isEditing) {
                              return (
                                <div key={pick.id} className="flex items-center gap-1">
                                  {champion && <ChampionIcon champion={champion} size="sm" />}
                                  <select
                                    value={pick.playerId}
                                    onChange={(e) => updateDraftPick(game.id!, pick.id!, { playerId: Number(e.target.value) })}
                                    className="bg-lol-dark border border-lol-border rounded px-1 py-0.5 text-[11px] text-lol-gold-light max-w-[90px] cursor-pointer"
                                  >
                                    {sortedPlayers.map((p) => (
                                      <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                  </select>
                                  <select
                                    value={pick.championId}
                                    onChange={(e) => updateDraftPick(game.id!, pick.id!, { championId: e.target.value })}
                                    className="bg-lol-dark border border-lol-border rounded px-1 py-0.5 text-[11px] text-lol-gold-light max-w-[100px] cursor-pointer"
                                  >
                                    {sortedChampions.map((c) => (
                                      <option key={c.id} value={c.id}>{c.nameKo}</option>
                                    ))}
                                  </select>
                                </div>
                              );
                            }
                            return (
                              <div key={pick.id} className="flex items-center gap-1.5">
                                {champion && <ChampionIcon champion={champion} size="sm" />}
                                <span className="text-xs text-lol-gold-light/80">
                                  {getPlayer(pick.playerId)?.name} - {champion?.nameKo}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                    {game.eogCapture && game.participantStats.length > 0 && (
                      <div className="pt-3 border-t border-lol-border/50">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs text-lol-gold-light/60">
                            종료 후 통계 · {new Date(game.eogCapture.capturedAt).toLocaleString('ko-KR')}
                          </div>
                          <div className="text-[10px] text-lol-gold-light/45">
                            {game.eogCapture.mappedParticipants}/{game.eogCapture.participantCount}명 매핑
                          </div>
                        </div>
                        <EogStatsPanel
                          participantStats={game.participantStats}
                          players={players}
                          champions={champions}
                          winnerTeam={game.eogCapture.winnerTeam}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
