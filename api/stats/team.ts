import { list } from '@vercel/blob';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { computeStatsFromData, estimateCompWinrate } from '../../src/lib/recommendation/winrate-pure';
import { championTraits } from '../../src/data/champion-tags';

const BLOB_NAME = 'lol-naejeon-data.json';

interface BackupData {
  players: { id: number; name: string }[];
  games: { id: number; winningTeam: number | null }[];
  gamePicks: { gameId: number; playerId: number; championId: string; team: number }[];
  gameBans?: { championId: string }[];
}

interface TeamRequest {
  team1Players?: string[];
  team1Champions: string[];
  team2Players?: string[];
  team2Champions: string[];
}

async function loadBackup(): Promise<BackupData | null> {
  const { blobs } = await list({ prefix: BLOB_NAME });
  if (blobs.length === 0) return null;
  const r = await fetch(blobs[0].url);
  return await r.json();
}

function resolvePlayerIds(names: string[] | undefined, players: { id: number; name: string }[]): number[] {
  if (!names) return [];
  return names.map((n) => {
    const p = players.find((pl) => pl.name === n);
    return p?.id ?? -1;
  });
}

function teamSummary(
  playerIds: number[],
  championIds: string[],
  stats: ReturnType<typeof computeStatsFromData>,
) {
  const assignments = championIds.map((cid, i) => ({
    playerId: playerIds[i] ?? -1,
    playerName: '',
    championId: cid,
    championName: cid,
    proficiency: '중' as const,
  }));
  const estimatedWinrate = estimateCompWinrate(assignments, stats, 0.5);

  const championStats = assignments.map((a) => {
    const cs = stats.champOverallStats[a.championId];
    const pcs = stats.playerChampStats.find(
      (s) => s.playerId === a.playerId && s.championId === a.championId,
    );
    return {
      playerId: a.playerId,
      championId: a.championId,
      championOverall: cs ?? null,
      playerChampion: pcs ?? null,
    };
  });

  const tagCounts: Record<string, number> = {};
  for (const cid of championIds) {
    const t = championTraits[cid];
    if (!t) continue;
    for (const m of t.mechanics) tagCounts[m] = (tagCounts[m] ?? 0) + 1;
  }

  return { estimatedWinrate, championStats, tagCounts };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const body: TeamRequest = req.method === 'POST'
      ? (typeof req.body === 'string' ? JSON.parse(req.body) : req.body)
      : {
          team1Players: ([] as string[]).concat(req.query.team1Players as any ?? []),
          team1Champions: ([] as string[]).concat(req.query.team1Champions as any ?? []),
          team2Players: ([] as string[]).concat(req.query.team2Players as any ?? []),
          team2Champions: ([] as string[]).concat(req.query.team2Champions as any ?? []),
        };

    if (!body.team1Champions?.length || !body.team2Champions?.length) {
      return res.status(400).json({ error: 'team1Champions and team2Champions required' });
    }

    const backup = await loadBackup();
    if (!backup) return res.status(404).json({ error: 'No data found' });

    const stats = computeStatsFromData(
      backup.games,
      backup.gamePicks,
      backup.gameBans ?? [],
    );

    const team1Ids = resolvePlayerIds(body.team1Players, backup.players);
    const team2Ids = resolvePlayerIds(body.team2Players, backup.players);

    const team1 = teamSummary(team1Ids, body.team1Champions, stats);
    const team2 = teamSummary(team2Ids, body.team2Champions, stats);

    const recommendation = team1.estimatedWinrate > team2.estimatedWinrate ? 'Team 1 favored' : 'Team 2 favored';

    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).json({
      team1,
      team2,
      recommendation,
      totalGamesAnalyzed: stats.totalGames,
    });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
}
