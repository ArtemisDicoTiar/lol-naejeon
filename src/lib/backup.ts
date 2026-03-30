import { db, type Player, type Proficiency, type Session, type Game, type GamePick, type GameBan } from './db';

interface BackupData {
  version: 1;
  exportedAt: string;
  players: Player[];
  proficiencies: Proficiency[];
  sessions: Session[];
  games: Game[];
  gamePicks: GamePick[];
  gameBans?: GameBan[];
}

export async function exportData(): Promise<string> {
  const data: BackupData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    players: await db.players.toArray(),
    proficiencies: await db.proficiencies.toArray(),
    sessions: await db.sessions.toArray(),
    games: await db.games.toArray(),
    gamePicks: await db.gamePicks.toArray(),
    gameBans: await db.gameBans.toArray(),
  };
  return JSON.stringify(data, null, 2);
}

export async function importData(json: string): Promise<void> {
  const data: BackupData = JSON.parse(json);
  if (data.version !== 1) throw new Error('지원하지 않는 백업 버전입니다.');

  await db.transaction('rw', [db.players, db.proficiencies, db.sessions, db.games, db.gamePicks, db.gameBans], async () => {
    await db.gameBans.clear();
    await db.gamePicks.clear();
    await db.games.clear();
    await db.sessions.clear();
    await db.proficiencies.clear();
    await db.players.clear();

    await db.players.bulkAdd(data.players);
    await db.proficiencies.bulkAdd(data.proficiencies);
    await db.sessions.bulkAdd(data.sessions);
    await db.games.bulkAdd(data.games);
    await db.gamePicks.bulkAdd(data.gamePicks);
    if (data.gameBans) {
      await db.gameBans.bulkAdd(data.gameBans);
    }
  });
}

export function downloadJson(json: string, filename: string) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
