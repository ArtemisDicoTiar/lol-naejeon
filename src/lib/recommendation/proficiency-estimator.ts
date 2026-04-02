import type { ProficiencyLevel } from '@/lib/db';
import type { WinrateStats } from './winrate';

export interface EstimatedProficiency {
  level: ProficiencyLevel;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

/**
 * Estimate a player's proficiency on a champion based on game history.
 * Returns null if there's no data to estimate from.
 *
 * Factors:
 * - Personal winrate on the champion
 * - Number of games played (confidence)
 * - Champion's ARAM base winrate (difficulty adjustment: winning on a weak champ = more skill)
 */
export function estimateProficiency(
  playerId: number,
  championId: string,
  aramWinrate: number,
  stats: WinrateStats
): EstimatedProficiency | null {
  const pcs = stats.playerChampStats.find(
    (s) => s.playerId === playerId && s.championId === championId
  );
  if (!pcs) return null;

  const games = pcs.wins + pcs.losses;
  if (games === 0) return null;

  const personalWr = pcs.winrate;

  // Adjust winrate for champion difficulty:
  // Winning on a low-winrate champ is harder → boost the adjusted score
  // aramWinrate=56 (easy champ) → penalty, aramWinrate=44 (hard champ) → boost
  const difficultyAdj = (50 - aramWinrate) * 0.3;
  const adjustedWr = personalWr + difficultyAdj;

  let level: ProficiencyLevel;
  let confidence: 'high' | 'medium' | 'low';
  let reason: string;

  if (games >= 5) {
    confidence = 'high';
    if (adjustedWr >= 58) {
      level = '상';
      reason = `${games}게임 ${Math.round(personalWr)}% 승률`;
    } else if (adjustedWr >= 45) {
      level = '중';
      reason = `${games}게임 ${Math.round(personalWr)}% 승률`;
    } else {
      level = '하';
      reason = `${games}게임 ${Math.round(personalWr)}% 승률`;
    }
  } else if (games >= 2) {
    confidence = 'medium';
    if (adjustedWr >= 60) {
      level = '상';
      reason = `${pcs.wins}승${pcs.losses}패`;
    } else if (adjustedWr >= 45) {
      level = '중';
      reason = `${pcs.wins}승${pcs.losses}패`;
    } else {
      level = '하';
      reason = `${pcs.wins}승${pcs.losses}패`;
    }
  } else {
    // 1 game only
    confidence = 'low';
    level = pcs.wins > 0 ? '중' : '하';
    reason = pcs.wins > 0 ? '1승' : '1패';
  }

  return { level, confidence, reason };
}

/**
 * Build a map of estimated proficiencies for a player.
 * Only returns estimates for champions where manual proficiency is '없음' or unset.
 */
export function estimatePlayerProficiencies(
  playerId: number,
  manualProfs: Map<string, ProficiencyLevel>,
  championIds: string[],
  aramWinrates: Map<string, number>,
  stats: WinrateStats
): Map<string, EstimatedProficiency> {
  const estimates = new Map<string, EstimatedProficiency>();

  for (const champId of championIds) {
    const manual = manualProfs.get(champId);
    if (manual && manual !== '없음') continue; // Manual set, skip

    const aramWr = aramWinrates.get(champId) ?? 50;
    const est = estimateProficiency(playerId, champId, aramWr, stats);
    if (est) estimates.set(champId, est);
  }

  return estimates;
}
