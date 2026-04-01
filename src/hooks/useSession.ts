import { useState, useEffect, useCallback } from 'react';
import { db, getActiveSession, getFierlessBans, deleteGame as dbDeleteGame, deleteSession as dbDeleteSession, updateSessionName as dbUpdateSessionName, type Session, type Game, type GamePick, type GameBan } from '@/lib/db';
import { syncToGithub, getGithubToken } from '@/lib/auto-sync';

export interface LastGameTeams {
  format: '3v3' | '3v4';
  team1: number[];
  team2: number[];
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [fierlessBans, setFierlessBans] = useState<string[]>([]);
  const [lastGameTeams, setLastGameTeams] = useState<LastGameTeams | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

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

  const endSession = async (): Promise<string | null> => {
    if (!session) return null;
    await db.sessions.update(session.id!, { endedAt: new Date() });
    await refresh();

    // Auto-sync to GitHub if token is configured
    if (getGithubToken()) {
      const result = await syncToGithub();
      return result.message;
    }
    return null;
  };

  const addGame = async (
    format: '3v3' | '3v4',
    picks: Omit<GamePick, 'id' | 'gameId'>[],
    bans?: Omit<GameBan, 'id' | 'gameId'>[]
  ) => {
    if (!session) return;
    const gameNumber = games.length + 1;
    const gameId = await db.games.add({
      sessionId: session.id!,
      gameNumber,
      format,
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

  return { session, games, fierlessBans, lastGameTeams, loading, refresh, createSession, endSession, addGame, setGameResult, removeGame, removeSession, renameSession };
}
