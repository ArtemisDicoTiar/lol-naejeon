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

export type ProficiencyLevel = 'S' | '상' | '중' | '하' | '없음';

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

export type GameMode = 'aram' | 'augmented';

export const GAME_MODE_LABELS: Record<GameMode, string> = {
  aram: '칼바람',
  augmented: '증바람',
};

export interface Game {
  id?: number;
  sessionId: number;
  gameNumber: number;
  format: '3v3' | '3v4';
  mode: GameMode;
  playedAt: Date;
  winningTeam: number | null;
  notes: string;
  sourceMatchId?: number | null;
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

export interface GameEogCapture {
  id?: number;
  gameId?: number | null;
  sessionId?: number | null;
  source: 'lcu_eog' | 'lcu_history';
  status: 'captured' | 'failed' | 'unlinked';
  capturedAt: Date;
  fingerprint: string;
  rawJson: string;
  trigger?: string;
  error?: string | null;
  winnerTeam?: number | null;
  participantCount: number;
  mappedParticipants: number;
}

export interface GameParticipantStat {
  id?: number;
  captureId: number;
  gameId?: number | null;
  playerId?: number | null;
  team: 1 | 2 | 0;
  summonerName: string;
  alias?: string | null;
  riotId?: string | null;
  championId?: string | null;
  kills: number;
  deaths: number;
  assists: number;
  goldEarned: number;
  totalDamageDealtToChampions: number;
  physicalDamageDealtToChampions: number;
  magicDamageDealtToChampions: number;
  trueDamageDealtToChampions: number;
  totalDamageTaken: number;
  physicalDamageTaken: number;
  magicDamageTaken: number;
  trueDamageTaken: number;
  damageSelfMitigated: number;
  totalDamageShieldedOnTeammates: number;
  totalHeal: number;
  totalHealsOnTeammates: number;
  totalTimeSpentDead: number;
  timeCCingOthers: number;
}

type LegacySessionRow = {
  id?: number;
  name?: string;
  date?: string;
  createdAt?: string | Date;
  endedAt?: string | Date | null;
};

type LegacyGameRow = {
  id?: number;
  sessionId?: number;
  gameNumber?: number;
  format?: '3v3' | '3v4';
  mode?: string;
  winningTeam?: number | null;
  notes?: string;
  playedAt?: string | Date;
  sourceMatchId?: number | null;
};

interface ImportBlobData {
  players?: ReadonlyArray<Omit<Player, 'createdAt'> & { createdAt: string | Date }>;
  proficiencies?: ReadonlyArray<Proficiency>;
  sessions?: ReadonlyArray<LegacySessionRow>;
  games?: ReadonlyArray<LegacyGameRow>;
  gamePicks?: ReadonlyArray<GamePick>;
  gameBans?: ReadonlyArray<GameBan>;
  gameEogCaptures?: ReadonlyArray<Omit<GameEogCapture, 'capturedAt'> & { capturedAt: string | Date }>;
  gameParticipantStats?: ReadonlyArray<GameParticipantStat>;
}

function toDate(value: string | Date | undefined, fallback = new Date()): Date {
  return value ? new Date(value) : fallback;
}

class LolDB extends Dexie {
  players!: Table<Player>;
  champions!: Table<Champion>;
  proficiencies!: Table<Proficiency>;
  sessions!: Table<Session>;
  games!: Table<Game>;
  gamePicks!: Table<GamePick>;
  gameBans!: Table<GameBan>;
  gameEogCaptures!: Table<GameEogCapture>;
  gameParticipantStats!: Table<GameParticipantStat>;

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
      return tx.table('sessions').toCollection().modify((session: LegacySessionRow) => {
        session.name = session.date || toDate(session.createdAt).toLocaleDateString('ko-KR');
        session.endedAt = new Date();
        delete session.date;
      });
    });
    // v4: add `mode` to games. Backfill existing rows to 'aram' (regular 칼바람).
    this.version(4).stores({
      players: '++id, name',
      champions: 'id, aramRole, aramTier',
      proficiencies: '++id, [playerId+championId], playerId, championId',
      sessions: '++id',
      games: '++id, sessionId, mode',
      gamePicks: '++id, gameId, [gameId+playerId], championId',
      gameBans: '++id, gameId, championId',
    }).upgrade((tx) => {
      return tx.table('games').toCollection().modify((game: LegacyGameRow) => {
        if (!game.mode) game.mode = 'aram';
      });
    });
    this.version(5).stores({
      players: '++id, name',
      champions: 'id, aramRole, aramTier',
      proficiencies: '++id, [playerId+championId], playerId, championId',
      sessions: '++id',
      games: '++id, sessionId, mode',
      gamePicks: '++id, gameId, [gameId+playerId], championId',
      gameBans: '++id, gameId, championId',
      gameEogCaptures: '++id, gameId, sessionId, fingerprint, capturedAt, status',
      gameParticipantStats: '++id, captureId, gameId, playerId, [gameId+playerId], championId',
    });
    this.version(6).stores({
      players: '++id, name',
      champions: 'id, aramRole, aramTier',
      proficiencies: '++id, [playerId+championId], playerId, championId',
      sessions: '++id',
      games: '++id, sessionId, mode, sourceMatchId',
      gamePicks: '++id, gameId, [gameId+playerId], championId',
      gameBans: '++id, gameId, championId',
      gameEogCaptures: '++id, gameId, sessionId, fingerprint, capturedAt, status, source',
      gameParticipantStats: '++id, captureId, gameId, playerId, [gameId+playerId], championId',
    });
  }
}

export const db = new LolDB();

async function importDataIntoDb(data: ImportBlobData) {
  await db.transaction('rw', [db.players, db.proficiencies, db.sessions, db.games, db.gamePicks, db.gameBans, db.gameEogCaptures, db.gameParticipantStats], async () => {
    await db.gameParticipantStats.clear();
    await db.gameEogCaptures.clear();
    await db.gameBans.clear();
    await db.gamePicks.clear();
    await db.games.clear();
    await db.sessions.clear();
    await db.proficiencies.clear();
    await db.players.clear();

    await db.players.bulkAdd((data.players ?? []).map((p) => ({
      ...p,
      createdAt: toDate(p.createdAt),
    })));
    await db.proficiencies.bulkAdd([...(data.proficiencies ?? [])]);
    if (data.sessions?.length) {
      await db.sessions.bulkAdd(data.sessions.map((s) => ({
        ...s,
        createdAt: toDate(s.createdAt),
        endedAt: s.endedAt ? new Date(s.endedAt) : null,
      })) as Session[]);
    }
    if (data.games?.length) {
      await db.games.bulkAdd(data.games.map((g) => ({
        ...g,
        mode: (g.mode === 'augmented' ? 'augmented' : 'aram') as GameMode,
        playedAt: toDate(g.playedAt),
      })) as Game[]);
    }
    if (data.gamePicks?.length) {
      await db.gamePicks.bulkAdd([...data.gamePicks]);
    }
    if (data.gameBans?.length) {
      await db.gameBans.bulkAdd([...data.gameBans]);
    }
    if (data.gameEogCaptures?.length) {
      await db.gameEogCaptures.bulkAdd(data.gameEogCaptures.map((c) => ({
        ...c,
        capturedAt: toDate(c.capturedAt),
      })) as GameEogCapture[]);
    }
    if (data.gameParticipantStats?.length) {
      await db.gameParticipantStats.bulkAdd([...data.gameParticipantStats]);
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
  const captures = await db.gameEogCaptures.where('gameId').equals(gameId).toArray();
  const captureIds = captures.map((c) => c.id!).filter(Boolean);
  if (captureIds.length > 0) {
    await db.gameParticipantStats.where('captureId').anyOf(captureIds).delete();
  }
  await db.gameEogCaptures.where('gameId').equals(gameId).delete();
  await db.gamePicks.where('gameId').equals(gameId).delete();
  await db.gameBans.where('gameId').equals(gameId).delete();
  await db.games.delete(gameId);
}

export async function deleteSession(sessionId: number): Promise<void> {
  const games = await db.games.where('sessionId').equals(sessionId).toArray();
  for (const game of games) {
    await deleteGame(game.id!);
  }
  const orphanCaptures = await db.gameEogCaptures
    .where('sessionId')
    .equals(sessionId)
    .filter((capture) => !capture.gameId)
    .toArray();
  const orphanIds = orphanCaptures.map((capture) => capture.id!).filter(Boolean);
  if (orphanIds.length > 0) {
    await db.gameParticipantStats.where('captureId').anyOf(orphanIds).delete();
  }
  await db.gameEogCaptures
    .where('sessionId')
    .equals(sessionId)
    .filter((capture) => !capture.gameId)
    .delete();
  await db.sessions.delete(sessionId);
}

export async function updateSessionName(sessionId: number, name: string): Promise<void> {
  await db.sessions.update(sessionId, { name });
}

export async function updateGameMode(gameId: number, mode: GameMode): Promise<void> {
  await db.games.update(gameId, { mode });
}

export async function updateGamePicks(
  gameId: number,
  picks: Array<{ playerId: number; championId: string; team: 1 | 2 }>,
): Promise<void> {
  await db.gamePicks.where('gameId').equals(gameId).delete();
  await db.gamePicks.bulkAdd(picks.map((p) => ({ ...p, gameId })));
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
