import type { Champion, Player, ProficiencyLevel } from '@/lib/db';
import type { SynergyCounterData } from './data-loader';

export interface RecommendationInput {
  teamPlayers: Player[];
  opponentPicks?: string[];
  bannedChampions: string[];
  format: '3v3' | '3v4';
  allChampions: Champion[];
  proficiencies: Record<number, Map<string, ProficiencyLevel>>;
  matchData?: SynergyCounterData | null;
  lockedPicks?: Record<number, string>;  // playerId → championId (already picked)
  // Same presence weighting as BanRecommendationInput — bumps frequently
  // picked/banned champions up in pick recommendations when otherwise tied.
  champFrequency?: Record<string, { pickRate: number; banRate: number }>;
}

export interface ChampionAssignment {
  playerId: number;
  playerName: string;
  championId: string;
  championName: string;
  proficiency: ProficiencyLevel;
}

export interface RecommendedComp {
  archetypeId: string;
  archetypeName: string;
  assignments: ChampionAssignment[];
  score: number;
  scoreBreakdown: ScoreBreakdown;
  damageProfile: { ap: number; ad: number; hybrid: number };
  strengths: string[];
  weaknesses: string[];
  estimatedWinrate?: number;
}

export interface ScoreBreakdown {
  proficiency: number;
  aramTier: number;
  damageBalance: number;
  roleCoverage: number;
  synergy: number;
  counter: number;
}

export interface BanRecommendationInput {
  opponentPlayerIds: number[];
  opponentPlayerNames: Record<number, string>;
  proficiencies: Record<number, Map<string, ProficiencyLevel>>;
  allChampions: Champion[];
  alreadyBanned: string[];
  ourTeamProficiencies?: Record<number, Map<string, ProficiencyLevel>>;
  // Internal pick/ban frequency for presence-weighted ranking. Pass
  // `wrStats.champOverallStats` from useSession/stats — when present, champions
  // with high pick+ban rates are pushed up in ban recommendations.
  champFrequency?: Record<string, { pickRate: number; banRate: number }>;
}

export interface BanRecommendation {
  championId: string;
  championName: string;
  score: number;
  reason: string;
}
