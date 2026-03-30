import type { Champion, ProficiencyLevel } from '@/lib/db';
import type { ChampionAssignment, ScoreBreakdown } from './types';
import { synergyPairs, counterMatrix } from '@/data/comp-archetypes';
import type { AramTier } from '@/data/aram-champion-meta';

const PROF_SCORES: Record<ProficiencyLevel, number> = {
  '상': 1.0,
  '중': 0.6,
  '하': 0.3,
  '없음': 0,
};

const TIER_SCORES: Record<AramTier, number> = {
  S: 1.0,
  A: 0.8,
  B: 0.6,
  C: 0.4,
  D: 0.2,
};

export function calcProficiencyScore(assignments: ChampionAssignment[]): number {
  if (assignments.length === 0) return 0;
  const sum = assignments.reduce((acc, a) => acc + PROF_SCORES[a.proficiency], 0);
  return sum / assignments.length;
}

export function calcTierScore(
  assignments: ChampionAssignment[],
  champMap: Map<string, Champion>
): number {
  if (assignments.length === 0) return 0;
  const sum = assignments.reduce((acc, a) => {
    const champ = champMap.get(a.championId);
    return acc + (champ ? TIER_SCORES[champ.aramTier] : 0.5);
  }, 0);
  return sum / assignments.length;
}

export function calcDamageBalance(
  assignments: ChampionAssignment[],
  champMap: Map<string, Champion>
): number {
  let ap = 0, ad = 0;
  for (const a of assignments) {
    const champ = champMap.get(a.championId);
    if (!champ) continue;
    switch (champ.damageType) {
      case 'AP': ap++; break;
      case 'AD': ad++; break;
      case 'HYBRID': ap += 0.5; ad += 0.5; break;
    }
  }
  const total = ap + ad;
  if (total === 0) return 0.5;
  const ratio = Math.min(ap, ad) / total;
  // Perfect balance (50/50) = 1.0, all one type = 0.2
  return 0.2 + ratio * 1.6;
}

export function calcRoleCoverage(
  assignments: ChampionAssignment[],
  champMap: Map<string, Champion>
): number {
  const roles = new Set<string>();
  const categories = { frontline: false, damage: false, utility: false };

  for (const a of assignments) {
    const champ = champMap.get(a.championId);
    if (!champ) continue;
    roles.add(champ.aramRole);
    if (['tank', 'engage'].includes(champ.aramRole)) categories.frontline = true;
    if (['dps', 'poke'].includes(champ.aramRole)) categories.damage = true;
    if (['utility', 'sustain'].includes(champ.aramRole)) categories.utility = true;
  }

  let score = 0;
  if (categories.frontline) score += 0.35;
  if (categories.damage) score += 0.35;
  if (categories.utility) score += 0.3;
  return score;
}

export function calcSynergyScore(assignments: ChampionAssignment[]): number {
  let bonus = 0;
  const champIds = assignments.map((a) => a.championId);
  for (const [c1, c2, score] of synergyPairs) {
    if (champIds.includes(c1) && champIds.includes(c2)) {
      bonus += score;
    }
  }
  return Math.min(bonus, 1.0);
}

export function calcCounterScore(
  archetypeId: string,
  opponentPicks: string[] | undefined,
  champMap: Map<string, Champion>
): number {
  if (!opponentPicks || opponentPicks.length === 0) return 0.5;

  // Determine opponent archetype from their picks
  const roleCount: Record<string, number> = {};
  for (const cid of opponentPicks) {
    const champ = champMap.get(cid);
    if (champ) {
      roleCount[champ.aramRole] = (roleCount[champ.aramRole] ?? 0) + 1;
    }
  }

  let opponentArchetype = 'balanced';
  const maxRole = Object.entries(roleCount).sort((a, b) => b[1] - a[1])[0];
  if (maxRole) {
    if (maxRole[0] === 'poke') opponentArchetype = 'poke';
    else if (['engage', 'tank'].includes(maxRole[0])) opponentArchetype = 'engage';
    else if (['sustain', 'utility'].includes(maxRole[0])) opponentArchetype = 'sustain';
  }

  const advantage = counterMatrix[archetypeId]?.[opponentArchetype] ?? 0;
  return 0.5 + advantage;
}

export function scoreComposition(
  assignments: ChampionAssignment[],
  champMap: Map<string, Champion>,
  archetypeId: string,
  opponentPicks?: string[]
): { score: number; breakdown: ScoreBreakdown } {
  const proficiency = calcProficiencyScore(assignments);
  const aramTier = calcTierScore(assignments, champMap);
  const damageBalance = calcDamageBalance(assignments, champMap);
  const roleCoverage = calcRoleCoverage(assignments, champMap);
  const synergy = calcSynergyScore(assignments);
  const counter = calcCounterScore(archetypeId, opponentPicks, champMap);

  const breakdown: ScoreBreakdown = {
    proficiency,
    aramTier,
    damageBalance,
    roleCoverage,
    synergy,
    counter,
  };

  const score =
    proficiency * 0.3 +
    aramTier * 0.2 +
    damageBalance * 0.15 +
    roleCoverage * 0.15 +
    synergy * 0.1 +
    counter * 0.1;

  return { score, breakdown };
}
