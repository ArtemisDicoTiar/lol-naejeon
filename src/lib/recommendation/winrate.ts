import { db } from '@/lib/db';
import type { ChampionAssignment } from './types';

export interface PlayerChampionStats {
  playerId: number;
  championId: string;
  wins: number;
  losses: number;
  winrate: number;
}

export interface PlayerOverallStats {
  playerId: number;
  wins: number;
  losses: number;
  winrate: number;
  totalPicks: number;
  topChampions: { championId: string; wins: number; losses: number; picks: number }[];
}

export interface WinrateStats {
  playerChampStats: PlayerChampionStats[];
  champOverallStats: Record<string, { wins: number; losses: number; winrate: number }>;
  playerOverallStats: Record<number, PlayerOverallStats>;
  totalGames: number;
}

export async function computeWinrateStats(): Promise<WinrateStats> {
  const games = await db.games.toArray();
  const allPicks = await db.gamePicks.toArray();

  const playerChampMap = new Map<string, { wins: number; losses: number }>();
  const champMap = new Map<string, { wins: number; losses: number }>();

  for (const game of games) {
    if (game.winningTeam === null) continue;

    const picks = allPicks.filter((p) => p.gameId === game.id!);
    for (const pick of picks) {
      const won = pick.team === game.winningTeam;
      const key = `${pick.playerId}:${pick.championId}`;

      const pc = playerChampMap.get(key) ?? { wins: 0, losses: 0 };
      if (won) pc.wins++; else pc.losses++;
      playerChampMap.set(key, pc);

      const cc = champMap.get(pick.championId) ?? { wins: 0, losses: 0 };
      if (won) cc.wins++; else cc.losses++;
      champMap.set(pick.championId, cc);
    }
  }

  const playerChampStats: PlayerChampionStats[] = [];
  for (const [key, stats] of playerChampMap) {
    const [playerId, championId] = key.split(':');
    const total = stats.wins + stats.losses;
    playerChampStats.push({
      playerId: parseInt(playerId),
      championId,
      wins: stats.wins,
      losses: stats.losses,
      winrate: total > 0 ? (stats.wins / total) * 100 : 50,
    });
  }

  const champOverallStats: Record<string, { wins: number; losses: number; winrate: number }> = {};
  for (const [cid, stats] of champMap) {
    const total = stats.wins + stats.losses;
    champOverallStats[cid] = { ...stats, winrate: total > 0 ? (stats.wins / total) * 100 : 50 };
  }

  // Player overall stats
  const playerOverallMap = new Map<number, { wins: number; losses: number; picks: number; champStats: Map<string, { wins: number; losses: number; picks: number }> }>();
  for (const game of games) {
    const gamePicks = allPicks.filter((p) => p.gameId === game.id!);
    for (const pick of gamePicks) {
      const po = playerOverallMap.get(pick.playerId) ?? { wins: 0, losses: 0, picks: 0, champStats: new Map() };
      po.picks++;
      if (game.winningTeam !== null) {
        if (pick.team === game.winningTeam) po.wins++; else po.losses++;
      }
      const cs = po.champStats.get(pick.championId) ?? { wins: 0, losses: 0, picks: 0 };
      cs.picks++;
      if (game.winningTeam !== null) {
        if (pick.team === game.winningTeam) cs.wins++; else cs.losses++;
      }
      po.champStats.set(pick.championId, cs);
      playerOverallMap.set(pick.playerId, po);
    }
  }

  const playerOverallStats: Record<number, PlayerOverallStats> = {};
  for (const [pid, stats] of playerOverallMap) {
    const total = stats.wins + stats.losses;
    const topChamps = [...stats.champStats.entries()]
      .map(([cid, cs]) => ({ championId: cid, ...cs }))
      .sort((a, b) => b.picks - a.picks)
      .slice(0, 5);
    playerOverallStats[pid] = {
      playerId: pid,
      wins: stats.wins,
      losses: stats.losses,
      winrate: total > 0 ? (stats.wins / total) * 100 : 0,
      totalPicks: stats.picks,
      topChampions: topChamps,
    };
  }

  const gamesWithResult = games.filter((g) => g.winningTeam !== null).length;

  return { playerChampStats, champOverallStats, playerOverallStats, totalGames: gamesWithResult };
}

export function estimateCompWinrate(
  assignments: ChampionAssignment[],
  stats: WinrateStats,
  baseScore: number,
): number {
  if (stats.totalGames < 2) {
    // Not enough data, rely on base score
    return baseScore * 100;
  }

  let personalTotal = 0;
  let personalCount = 0;
  let champTotal = 0;
  let champCount = 0;

  for (const a of assignments) {
    // Player-champion specific stats
    const pcs = stats.playerChampStats.find(
      (s) => s.playerId === a.playerId && s.championId === a.championId
    );
    if (pcs && pcs.wins + pcs.losses >= 1) {
      personalTotal += pcs.winrate;
      personalCount++;
    }

    // Champion overall stats
    const cs = stats.champOverallStats[a.championId];
    if (cs && cs.wins + cs.losses >= 1) {
      champTotal += cs.winrate;
      champCount++;
    }
  }

  const personalAvg = personalCount > 0 ? personalTotal / personalCount : 50;
  const champAvg = champCount > 0 ? champTotal / champCount : 50;
  const basePercent = baseScore * 100;

  // Weight shifts based on data volume
  const dataVolume = Math.min(stats.totalGames / 10, 1); // 0~1, maxes at 10 games
  const personalWeight = 0.4 * dataVolume;
  const champWeight = 0.3 * dataVolume;
  const baseWeight = 1 - personalWeight - champWeight;

  return personalAvg * personalWeight + champAvg * champWeight + basePercent * baseWeight;
}
