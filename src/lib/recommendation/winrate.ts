import { db } from '@/lib/db';
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

export async function computeWinrateStats(): Promise<WinrateStats> {
  const [games, picks, bans] = await Promise.all([
    db.games.toArray(),
    db.gamePicks.toArray(),
    db.gameBans.toArray(),
  ]);
  return computeStatsFromData(games, picks, bans);
}

