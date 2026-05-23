import { db, type GameMode } from '@/lib/db';
import { computeStatsFromData } from './winrate-pure';
export { estimateCompWinrate } from './winrate-pure';

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

export interface ChampionFullStats {
  picks: number;
  wins: number;
  losses: number;
  winrate: number;
  pickRate: number;   // picks / totalGames * 100
  bans: number;
  banRate: number;    // bans / totalGames * 100
}

export interface WinrateStats {
  playerChampStats: PlayerChampionStats[];
  champOverallStats: Record<string, ChampionFullStats>;
  playerOverallStats: Record<number, PlayerOverallStats>;
  totalGames: number;
}

export async function computeWinrateStats(modeFilter?: GameMode): Promise<WinrateStats> {
  const [allGames, allPicks, allBans] = await Promise.all([
    db.games.toArray(),
    db.gamePicks.toArray(),
    db.gameBans.toArray(),
  ]);
  if (!modeFilter) {
    return computeStatsFromData(allGames, allPicks, allBans);
  }
  const games = allGames.filter((g) => (g.mode ?? 'aram') === modeFilter);
  const gameIdSet = new Set(games.map((g) => g.id));
  const picks = allPicks.filter((p) => gameIdSet.has(p.gameId));
  const bans = allBans.filter((b) => gameIdSet.has(b.gameId));
  return computeStatsFromData(games, picks, bans);
}

