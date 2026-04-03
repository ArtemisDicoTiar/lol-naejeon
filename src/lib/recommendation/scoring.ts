import type { Champion, ProficiencyLevel } from '@/lib/db';
import type { ChampionAssignment, ScoreBreakdown } from './types';
import { counterMatrix } from '@/data/comp-archetypes';
import type { AramTier } from '@/data/aram-champion-meta';
import { synergyRules, synergyOverrides } from '@/data/synergy-rules';
import { counterRules } from '@/data/counter-rules';
import type { ChampionTraits } from '@/data/champion-tags';
import type { SynergyCounterData } from './data-loader';

const PROF_SCORES: Record<ProficiencyLevel, number> = {
  'S': 1.0,
  '상': 0.9,
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
  return 0.2 + ratio * 1.6;
}

export function calcRoleCoverage(
  assignments: ChampionAssignment[],
  champMap: Map<string, Champion>
): number {
  const categories = { frontline: false, damage: false, utility: false };

  for (const a of assignments) {
    const champ = champMap.get(a.championId);
    if (!champ) continue;
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

// Tag-based synergy: rules engine + specific overrides
function calcTagSynergyScore(
  assignments: ChampionAssignment[],
  traitsMap: Map<string, ChampionTraits>
): number {
  let totalBonus = 0;
  const firedRules = new Set<string>();

  for (const rule of synergyRules) {
    for (let i = 0; i < assignments.length; i++) {
      if (!rule.stackable && firedRules.has(rule.id)) break;
      const srcTraits = traitsMap.get(assignments[i].championId);
      if (!srcTraits || !rule.source.every((t) => srcTraits.mechanics.includes(t))) continue;

      for (let j = 0; j < assignments.length; j++) {
        if (i === j) continue;
        const tgtTraits = traitsMap.get(assignments[j].championId);
        if (!tgtTraits || !rule.target.every((t) => tgtTraits.mechanics.includes(t))) continue;

        totalBonus += rule.bonus;
        firedRules.add(rule.id);
        if (!rule.stackable) break;
      }
    }
  }

  const champIds = assignments.map((a) => a.championId);
  for (const [c1, c2, score] of synergyOverrides) {
    if (champIds.includes(c1) && champIds.includes(c2)) {
      totalBonus += score;
    }
  }

  return Math.min(totalBonus, 1.0);
}

// Data-based synergy from Kaggle match statistics
function calcDataSynergyScore(
  assignments: ChampionAssignment[],
  data: SynergyCounterData
): { score: number; weight: number } {
  const champIds = assignments.map((a) => a.championId);
  let totalWr = 0;
  let totalGames = 0;
  let pairsFound = 0;

  for (let i = 0; i < champIds.length; i++) {
    for (let j = i + 1; j < champIds.length; j++) {
      const a = champIds[i], b = champIds[j];
      const key = a < b ? `${a}+${b}` : `${b}+${a}`;
      const entry = data.synergies[key];
      if (entry) {
        totalWr += entry.winrate * entry.total;
        totalGames += entry.total;
        pairsFound++;
      }
    }
  }

  if (pairsFound === 0) return { score: 0.5, weight: 0 };

  const avgWr = totalWr / totalGames;
  // Normalize: 40% winrate → 0, 50% → 0.5, 60% → 1.0
  const score = Math.max(0, Math.min(1, (avgWr - 40) / 20));
  // Weight based on data confidence (more pairs found = higher weight, max 0.7)
  const maxPairs = (champIds.length * (champIds.length - 1)) / 2;
  const weight = Math.min((pairsFound / maxPairs) * 0.7, 0.7);

  return { score, weight };
}

// Combined synergy: blend tag-based and data-based
export function calcSynergyScore(
  assignments: ChampionAssignment[],
  traitsMap: Map<string, ChampionTraits>,
  matchData?: SynergyCounterData | null
): number {
  const tagScore = calcTagSynergyScore(assignments, traitsMap);

  if (!matchData) return tagScore;

  const { score: dataScore, weight: dataWeight } = calcDataSynergyScore(assignments, matchData);
  if (dataWeight === 0) return tagScore;

  return tagScore * (1 - dataWeight) + dataScore * dataWeight;
}

// Data-based counter score from Kaggle match statistics
function calcDataCounterScore(
  assignments: ChampionAssignment[],
  opponentPicks: string[],
  data: SynergyCounterData
): { score: number; weight: number } {
  let totalAdvantage = 0;
  let matchupsFound = 0;

  for (const a of assignments) {
    const counterData = data.counters[a.championId];
    if (!counterData) continue;

    for (const oppId of opponentPicks) {
      const strong = counterData.strongAgainst.find((c) => c.id === oppId);
      if (strong) {
        totalAdvantage += (strong.winrate - 50) / 100;
        matchupsFound++;
      }
      const weak = counterData.weakAgainst.find((c) => c.id === oppId);
      if (weak) {
        totalAdvantage += (weak.winrate - 50) / 100;
        matchupsFound++;
      }
    }
  }

  if (matchupsFound === 0) return { score: 0.5, weight: 0 };

  const avgAdv = totalAdvantage / matchupsFound;
  const score = 0.5 + Math.max(-0.5, Math.min(0.5, avgAdv * 3));
  const weight = Math.min(matchupsFound / (assignments.length * opponentPicks.length) * 0.6, 0.6);

  return { score, weight };
}

// Champion-level counter with archetype fallback + data blending
export function calcCounterScore(
  archetypeId: string,
  assignments: ChampionAssignment[],
  opponentPicks: string[] | undefined,
  champMap: Map<string, Champion>,
  traitsMap: Map<string, ChampionTraits>,
  matchData?: SynergyCounterData | null
): number {
  if (!opponentPicks || opponentPicks.length === 0) return 0.5;

  // Champion-level counter calculation
  let advantage = 0;
  for (const rule of counterRules) {
    // Our team counters their champions
    for (const oppId of opponentPicks) {
      const oppTraits = traitsMap.get(oppId);
      if (!oppTraits || !rule.victimTags.every((t) => oppTraits.mechanics.includes(t))) continue;
      for (const a of assignments) {
        const ourTraits = traitsMap.get(a.championId);
        if (!ourTraits || !rule.counterTags.every((t) => ourTraits.mechanics.includes(t))) continue;
        advantage += rule.advantage;
      }
    }
    // Their champions counter ours
    for (const a of assignments) {
      const ourTraits = traitsMap.get(a.championId);
      if (!ourTraits || !rule.victimTags.every((t) => ourTraits.mechanics.includes(t))) continue;
      for (const oppId of opponentPicks) {
        const oppTraits = traitsMap.get(oppId);
        if (!oppTraits || !rule.counterTags.every((t) => oppTraits.mechanics.includes(t))) continue;
        advantage -= rule.advantage;
      }
    }
  }

  const champLevelScore = 0.5 + Math.max(-0.5, Math.min(0.5, advantage));

  // Archetype-level fallback
  const roleCount: Record<string, number> = {};
  for (const cid of opponentPicks) {
    const champ = champMap.get(cid);
    if (champ) roleCount[champ.aramRole] = (roleCount[champ.aramRole] ?? 0) + 1;
  }
  let opponentArchetype = 'balanced';
  const maxRole = Object.entries(roleCount).sort((a, b) => b[1] - a[1])[0];
  if (maxRole) {
    if (maxRole[0] === 'poke') opponentArchetype = 'poke';
    else if (['engage', 'tank'].includes(maxRole[0])) opponentArchetype = 'engage';
    else if (['sustain', 'utility'].includes(maxRole[0])) opponentArchetype = 'sustain';
  }
  const archetypeScore = 0.5 + (counterMatrix[archetypeId]?.[opponentArchetype] ?? 0);

  // Blend tag-based: more opponent picks known → more weight on champion-level
  const champWeight = Math.min(opponentPicks.length / 3, 1.0);
  const tagCounterScore = champLevelScore * champWeight + archetypeScore * (1 - champWeight);

  // Blend with data-based counter if available
  if (!matchData) return tagCounterScore;

  const { score: dataScore, weight: dataWeight } = calcDataCounterScore(assignments, opponentPicks, matchData);
  if (dataWeight === 0) return tagCounterScore;

  return tagCounterScore * (1 - dataWeight) + dataScore * dataWeight;
}

export function scoreComposition(
  assignments: ChampionAssignment[],
  champMap: Map<string, Champion>,
  traitsMap: Map<string, ChampionTraits>,
  archetypeId: string,
  opponentPicks?: string[],
  matchData?: SynergyCounterData | null
): { score: number; breakdown: ScoreBreakdown } {
  const proficiency = calcProficiencyScore(assignments);
  const aramTier = calcTierScore(assignments, champMap);
  const damageBalance = calcDamageBalance(assignments, champMap);
  const roleCoverage = calcRoleCoverage(assignments, champMap);
  const synergy = calcSynergyScore(assignments, traitsMap, matchData);
  const counter = calcCounterScore(archetypeId, assignments, opponentPicks, champMap, traitsMap, matchData);

  const breakdown: ScoreBreakdown = {
    proficiency,
    aramTier,
    damageBalance,
    roleCoverage,
    synergy,
    counter,
  };

  const score =
    proficiency * 0.28 +
    aramTier * 0.20 +
    damageBalance * 0.14 +
    roleCoverage * 0.13 +
    synergy * 0.13 +
    counter * 0.12;

  return { score, breakdown };
}
