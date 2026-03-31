import { db } from './db';

interface ImportTeam {
  players: string[];
  champions: string[];
  bans?: string[];
}

interface ImportGame {
  format: '3v3' | '3v4';
  winningTeam: number | null;
  team1: ImportTeam;
  team2: ImportTeam;
  notes?: string;
}

interface ImportSession {
  name: string;
  games: ImportGame[];
}

export interface ImportData {
  sessions: ImportSession[];
}

export const IMPORT_EXAMPLE: ImportData = {
  sessions: [
    {
      name: '3/15 내전',
      games: [
        {
          format: '3v3',
          winningTeam: 1,
          team1: {
            players: ['12시', '곰', '귤아저씨'],
            champions: ['Lucian', 'Teemo', 'Udyr'],
            bans: ['Ziggs', 'Brand', 'Xerath'],
          },
          team2: {
            players: ['11시', '엔디', '그리'],
            champions: ['Heimerdinger', 'Pantheon', 'Nami'],
            bans: ['Poppy', 'Sejuani', 'Malphite'],
          },
        },
      ],
    },
  ],
};

export async function importRecords(data: ImportData): Promise<{ sessions: number; games: number; errors: string[] }> {
  const errors: string[] = [];
  let sessionCount = 0;
  let gameCount = 0;

  const allPlayers = await db.players.toArray();
  const playerNameMap = new Map(allPlayers.map((p) => [p.name, p.id!]));

  for (const sessionData of data.sessions) {
    const sessionId = await db.sessions.add({
      name: sessionData.name,
      createdAt: new Date(),
      endedAt: new Date(),
    });
    sessionCount++;

    for (let gi = 0; gi < sessionData.games.length; gi++) {
      const game = sessionData.games[gi];

      // Validate players exist
      const allGamePlayers = [...game.team1.players, ...game.team2.players];
      const missingPlayers = allGamePlayers.filter((name) => !playerNameMap.has(name));
      if (missingPlayers.length > 0) {
        // Auto-create missing players
        for (const name of missingPlayers) {
          const id = await db.players.add({ name, createdAt: new Date() });
          playerNameMap.set(name, id as number);
        }
      }

      if (game.team1.players.length !== game.team1.champions.length) {
        errors.push(`${sessionData.name} Game ${gi + 1}: team1 players/champions 수 불일치`);
        continue;
      }
      if (game.team2.players.length !== game.team2.champions.length) {
        errors.push(`${sessionData.name} Game ${gi + 1}: team2 players/champions 수 불일치`);
        continue;
      }

      const gameId = await db.games.add({
        sessionId: sessionId as number,
        gameNumber: gi + 1,
        format: game.format,
        playedAt: new Date(),
        winningTeam: game.winningTeam,
        notes: game.notes ?? '',
      });

      // Add picks
      const picks = [
        ...game.team1.players.map((name, i) => ({
          gameId: gameId as number,
          playerId: playerNameMap.get(name)!,
          championId: game.team1.champions[i],
          team: 1 as const,
        })),
        ...game.team2.players.map((name, i) => ({
          gameId: gameId as number,
          playerId: playerNameMap.get(name)!,
          championId: game.team2.champions[i],
          team: 2 as const,
        })),
      ];
      await db.gamePicks.bulkAdd(picks);

      // Add bans
      const bans = [
        ...(game.team1.bans ?? []).map((cid) => ({
          gameId: gameId as number,
          championId: cid,
          team: 1 as const,
        })),
        ...(game.team2.bans ?? []).map((cid) => ({
          gameId: gameId as number,
          championId: cid,
          team: 2 as const,
        })),
      ];
      if (bans.length > 0) await db.gameBans.bulkAdd(bans);

      gameCount++;
    }
  }

  return { sessions: sessionCount, games: gameCount, errors };
}
