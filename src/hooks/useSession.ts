import { useState, useEffect, useCallback, useRef } from 'react';
import { db, getActiveSession, getFierlessBans, deleteGame as dbDeleteGame, deleteSession as dbDeleteSession, updateSessionName as dbUpdateSessionName, updateGameMode as dbUpdateGameMode, updateGamePicks as dbUpdateGamePicks, type Session, type Game, type GamePick, type GameBan, type GameMode } from '@/lib/db';
import { syncToVercel } from '@/lib/auto-sync';

export interface LastGameTeams {
  format: '3v3' | '3v4';
  mode: GameMode;
  team1: number[];
  team2: number[];
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [fierlessBans, setFierlessBans] = useState<string[]>([]);
  const [lastGameTeams, setLastGameTeams] = useState<LastGameTeams | null>(null);
  const [loading, setLoading] = useState(true);
  const hasLoadedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!hasLoadedRef.current) setLoading(true);
    const loadingGuard = window.setTimeout(() => {
      hasLoadedRef.current = true;
      setLoading(false);
    }, 5000);
    try {
      const s = await getActiveSession();
      setSession(s);
      if (s) {
        const g = await db.games.where('sessionId').equals(s.id!).toArray();
        g.sort((a, b) => a.gameNumber - b.gameNumber);
        setGames(g);
        const bans = await getFierlessBans(s.id!);
        setFierlessBans(bans);

        // Get last game teams
        if (g.length > 0) {
          const lastGame = g[g.length - 1];
          const picks = await db.gamePicks.where('gameId').equals(lastGame.id!).toArray();
          setLastGameTeams({
            format: lastGame.format,
            mode: lastGame.mode ?? 'aram',
            team1: picks.filter((p) => p.team === 1).map((p) => p.playerId),
            team2: picks.filter((p) => p.team === 2).map((p) => p.playerId),
          });
        } else {
          setLastGameTeams(null);
        }
      } else {
        setGames([]);
        setFierlessBans([]);
        setLastGameTeams(null);
      }
    } catch (error) {
      console.error('Failed to load session:', error);
      if (!hasLoadedRef.current) {
        setSession(null);
        setGames([]);
        setFierlessBans([]);
        setLastGameTeams(null);
      }
    } finally {
      window.clearTimeout(loadingGuard);
      hasLoadedRef.current = true;
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const handleDataChanged = () => { void refresh(); };
    window.addEventListener('lol-data-changed', handleDataChanged);
    return () => window.removeEventListener('lol-data-changed', handleDataChanged);
  }, [refresh]);

  const createSession = async (name?: string) => {
    const existing = await getActiveSession();
    if (existing) throw new Error('이미 활성 세션이 있습니다.');
    const defaultName = new Date().toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) + ' 내전';
    const id = await db.sessions.add({
      name: name || defaultName,
      createdAt: new Date(),
      endedAt: null,
    });
    await refresh();
    return (await db.sessions.get(id))!;
  };

  const endSession = async (sync = false): Promise<string | null> => {
    if (!session) return null;
    await db.sessions.update(session.id!, { endedAt: new Date() });
    await refresh();

    if (sync) {
      const result = await syncToVercel();
      return result.message;
    }
    return null;
  };

  // Dedup window: same pick signature within 30s is treated as a duplicate
  // call (LCU bridge / StrictMode can fire addGame twice for one draft).
  const recentAddRef = useRef<{ sig: string; at: number; id: number } | null>(null);

  const addGame = async (
    format: '3v3' | '3v4',
    picks: Omit<GamePick, 'id' | 'gameId'>[],
    bans?: Omit<GameBan, 'id' | 'gameId'>[],
    mode: GameMode = 'aram',
  ) => {
    if (!session) return;
    const sig = [
      session.id,
      format,
      mode,
      ...picks
        .map((p) => `${p.team}:${p.playerId}:${p.championId}`)
        .sort(),
    ].join('|');
    const now = Date.now();
    const recent = recentAddRef.current;
    if (recent && recent.sig === sig && now - recent.at < 30_000) {
      return recent.id;
    }
    const gameNumber = games.length + 1;
    const gameId = await db.games.add({
      sessionId: session.id!,
      gameNumber,
      format,
      mode,
      playedAt: new Date(),
      winningTeam: null,
      notes: '',
    });
    await db.gamePicks.bulkAdd(
      picks.map((p) => ({ ...p, gameId: gameId as number }))
    );
    if (bans && bans.length > 0) {
      await db.gameBans.bulkAdd(
        bans.map((b) => ({ ...b, gameId: gameId as number }))
      );
    }
    recentAddRef.current = { sig, at: now, id: gameId as number };
    await refresh();
    return gameId;
  };

  const setGameResult = async (gameId: number, winningTeam: number, notes?: string) => {
    await db.games.update(gameId, { winningTeam, ...(notes !== undefined ? { notes } : {}) });
    await refresh();
  };

  const removeGame = async (gameId: number) => {
    await dbDeleteGame(gameId);
    await refresh();
  };

  const removeSession = async (sessionId: number) => {
    await dbDeleteSession(sessionId);
    await refresh();
  };

  const renameSession = async (sessionId: number, name: string) => {
    await dbUpdateSessionName(sessionId, name);
    await refresh();
  };

  const setGameMode = async (gameId: number, mode: GameMode) => {
    await dbUpdateGameMode(gameId, mode);
    await refresh();
  };

  const correctGamePicks = async (
    gameId: number,
    picks: Array<{ playerId: number; championId: string; team: 1 | 2 }>,
  ) => {
    await dbUpdateGamePicks(gameId, picks);
    await refresh();
  };

  return { session, games, fierlessBans, lastGameTeams, loading, refresh, createSession, endSession, addGame, setGameResult, removeGame, removeSession, renameSession, setGameMode, correctGamePicks };
}
