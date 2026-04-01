import Dexie, { type Table } from 'dexie';

export interface Player {
  id?: number;
  name: string;
  createdAt: Date;
}

export interface Champion {
  id: string;
  nameKo: string;
  tags: string[];
  damageType: 'AP' | 'AD' | 'HYBRID';
  aramRole: 'poke' | 'engage' | 'sustain' | 'dps' | 'tank' | 'utility';
  aramTier: 'S' | 'A' | 'B' | 'C' | 'D';
  aramWinrate: number;
  imageUrl: string;
  patchVersion: string;
}

export type ProficiencyLevel = '상' | '중' | '하' | '없음';

export interface Proficiency {
  id?: number;
  playerId: number;
  championId: string;
  level: ProficiencyLevel;
}

export interface Session {
  id?: number;
  name: string;
  createdAt: Date;
  endedAt: Date | null;
}

export interface Game {
  id?: number;
  sessionId: number;
  gameNumber: number;
  format: '3v3' | '3v4';
  playedAt: Date;
  winningTeam: number | null;
  notes: string;
}

export interface GamePick {
  id?: number;
  gameId: number;
  playerId: number;
  championId: string;
  team: 1 | 2;
}

export interface GameBan {
  id?: number;
  gameId: number;
  championId: string;
  team: 1 | 2;
}

class LolDB extends Dexie {
  players!: Table<Player>;
  champions!: Table<Champion>;
  proficiencies!: Table<Proficiency>;
  sessions!: Table<Session>;
  games!: Table<Game>;
  gamePicks!: Table<GamePick>;
  gameBans!: Table<GameBan>;

  constructor() {
    super('lol-naejeon');
    this.version(1).stores({
      players: '++id, name',
      champions: 'id, aramRole, aramTier',
      proficiencies: '++id, [playerId+championId], playerId, championId',
      sessions: '++id, date',
      games: '++id, sessionId',
      gamePicks: '++id, gameId, [gameId+playerId], championId',
    });
    this.version(2).stores({
      players: '++id, name',
      champions: 'id, aramRole, aramTier',
      proficiencies: '++id, [playerId+championId], playerId, championId',
      sessions: '++id, date',
      games: '++id, sessionId',
      gamePicks: '++id, gameId, [gameId+playerId], championId',
      gameBans: '++id, gameId, championId',
    });
    this.version(3).stores({
      players: '++id, name',
      champions: 'id, aramRole, aramTier',
      proficiencies: '++id, [playerId+championId], playerId, championId',
      sessions: '++id',
      games: '++id, sessionId',
      gamePicks: '++id, gameId, [gameId+playerId], championId',
      gameBans: '++id, gameId, championId',
    }).upgrade((tx) => {
      return tx.table('sessions').toCollection().modify((session: any) => {
        session.name = session.date || new Date(session.createdAt).toLocaleDateString('ko-KR');
        session.endedAt = new Date();
        delete session.date;
      });
    });
  }
}

export const db = new LolDB();

async function importDataIntoDb(data: any) {
  await db.transaction('rw', [db.players, db.proficiencies, db.sessions, db.games, db.gamePicks, db.gameBans], async () => {
    await db.gameBans.clear();
    await db.gamePicks.clear();
    await db.games.clear();
    await db.sessions.clear();
    await db.proficiencies.clear();
    await db.players.clear();

    await db.players.bulkAdd((data.players ?? []).map((p: any) => ({
      ...p,
      createdAt: new Date(p.createdAt),
    })));
    await db.proficiencies.bulkAdd([...(data.proficiencies ?? [])] as any[]);
    if (data.sessions?.length) {
      await db.sessions.bulkAdd(data.sessions.map((s: any) => ({
        ...s,
        createdAt: new Date(s.createdAt),
        endedAt: s.endedAt ? new Date(s.endedAt) : null,
      })));
    }
    if (data.games?.length) {
      await db.games.bulkAdd(data.games.map((g: any) => ({
        ...g,
        playedAt: new Date(g.playedAt),
      })));
    }
    if (data.gamePicks?.length) {
      await db.gamePicks.bulkAdd([...data.gamePicks] as any[]);
    }
    if (data.gameBans?.length) {
      await db.gameBans.bulkAdd([...data.gameBans] as any[]);
    }
  });
}

export async function seedIfEmpty(): Promise<boolean> {
  const count = await db.players.count();
  if (count > 0) return false;

  // Try loading from Vercel Blob first (shared data)
  try {
    const { loadFromVercel } = await import('./auto-sync');
    const cloudData = await loadFromVercel();
    if (cloudData && cloudData.players?.length > 0) {
      await importDataIntoDb(cloudData);
      return true;
    }
  } catch {
    // Fall through to seed data
  }

  // Fallback: use bundled seed data
  const { seedData } = await import('@/data/seed-data');
  await importDataIntoDb(seedData);
  return true;
}

export async function deleteGame(gameId: number): Promise<void> {
  await db.gamePicks.where('gameId').equals(gameId).delete();
  await db.gameBans.where('gameId').equals(gameId).delete();
  await db.games.delete(gameId);
}

export async function deleteSession(sessionId: number): Promise<void> {
  const games = await db.games.where('sessionId').equals(sessionId).toArray();
  for (const game of games) {
    await deleteGame(game.id!);
  }
  await db.sessions.delete(sessionId);
}

export async function updateSessionName(sessionId: number, name: string): Promise<void> {
  await db.sessions.update(sessionId, { name });
}

export async function getActiveSession(): Promise<Session | null> {
  const all = await db.sessions.toArray();
  return all.find((s) => s.endedAt === null) ?? null;
}

export async function getFierlessBans(sessionId: number): Promise<string[]> {
  const games = await db.games.where('sessionId').equals(sessionId).toArray();
  const gameIds = games.map((g) => g.id!);
  if (gameIds.length === 0) return [];
  const picks = await db.gamePicks.where('gameId').anyOf(gameIds).toArray();
  return [...new Set(picks.map((p) => p.championId))];
}

export async function getPlayerProficiencies(
  playerId: number
): Promise<Map<string, ProficiencyLevel>> {
  const profs = await db.proficiencies
    .where('playerId')
    .equals(playerId)
    .toArray();
  return new Map(profs.map((p) => [p.championId, p.level]));
}

export async function setProficiency(
  playerId: number,
  championId: string,
  level: ProficiencyLevel
): Promise<void> {
  const existing = await db.proficiencies
    .where('[playerId+championId]')
    .equals([playerId, championId])
    .first();
  if (existing) {
    await db.proficiencies.update(existing.id!, { level });
  } else {
    await db.proficiencies.add({ playerId, championId, level });
  }
}
