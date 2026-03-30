import type { Champion, ProficiencyLevel } from '@/lib/db';
import type { RecommendationInput, RecommendedComp, ChampionAssignment, BanRecommendationInput, BanRecommendation } from './types';
import { scoreComposition } from './scoring';
import { compArchetypes } from '@/data/comp-archetypes';
import type { AramTier } from '@/data/aram-champion-meta';

const CANDIDATES_PER_SLOT = 5;
const MAX_RESULTS = 10;

export function generateRecommendations(input: RecommendationInput): RecommendedComp[] {
  const { teamPlayers, bannedChampions, allChampions, proficiencies, opponentPicks } = input;
  const bannedSet = new Set(bannedChampions);
  const champMap = new Map(allChampions.map((c) => [c.id, c]));

  // Build available champion pools per player
  const playerPools: Map<number, Champion[]> = new Map();
  for (const player of teamPlayers) {
    const playerProfs = proficiencies[player.id!] ?? new Map();
    const available = allChampions.filter((c) => {
      if (bannedSet.has(c.id)) return false;
      const level = playerProfs.get(c.id);
      if (level === '없음') return false;
      return true;
    });
    playerPools.set(player.id!, available);
  }

  const allResults: RecommendedComp[] = [];
  const teamSize = teamPlayers.length;

  for (const archetype of compArchetypes) {
    const slots = teamSize <= 3 ? archetype.slots3 : archetype.slots4;
    if (slots.length !== teamSize) continue;

    // For each slot, find top candidates from each player
    const slotCandidates: { playerId: number; champions: Champion[] }[][] = [];

    for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
      const slot = slots[slotIdx];
      const candidates: { playerId: number; champions: Champion[] }[] = [];

      for (const player of teamPlayers) {
        const pool = playerPools.get(player.id!) ?? [];
        const playerProfs = proficiencies[player.id!] ?? new Map();

        // Filter and rank champions that fit this slot
        const fitting = pool
          .filter((c) => slot.roles.includes(c.aramRole))
          .map((c) => ({
            champion: c,
            score: getChampionSlotScore(c, slot.preferredRoles, playerProfs.get(c.id)),
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, CANDIDATES_PER_SLOT)
          .map((x) => x.champion);

        if (fitting.length > 0) {
          candidates.push({ playerId: player.id!, champions: fitting });
        }
      }
      slotCandidates.push(candidates);
    }

    // Generate compositions by assigning players to slots
    const compositions = generateAssignments(
      teamPlayers,
      slotCandidates,
      proficiencies,
      champMap
    );

    for (const assignments of compositions) {
      const { score, breakdown } = scoreComposition(
        assignments,
        champMap,
        archetype.id,
        opponentPicks
      );

      const damageProfile = { ap: 0, ad: 0, hybrid: 0 };
      for (const a of assignments) {
        const champ = champMap.get(a.championId);
        if (champ) {
          switch (champ.damageType) {
            case 'AP': damageProfile.ap++; break;
            case 'AD': damageProfile.ad++; break;
            case 'HYBRID': damageProfile.hybrid++; break;
          }
        }
      }

      allResults.push({
        archetypeId: archetype.id,
        archetypeName: archetype.nameKo,
        assignments,
        score,
        scoreBreakdown: breakdown,
        damageProfile,
        strengths: archetype.strengths,
        weaknesses: archetype.weaknesses,
      });
    }
  }

  // Sort by score and deduplicate similar compositions
  allResults.sort((a, b) => b.score - a.score);
  return deduplicateComps(allResults).slice(0, MAX_RESULTS);
}

function getChampionSlotScore(
  champ: Champion,
  preferredRoles: string[],
  proficiency?: ProficiencyLevel
): number {
  let score = 0;

  // Proficiency weight
  const profScores: Record<string, number> = { '상': 3, '중': 2, '하': 1 };
  score += profScores[proficiency ?? ''] ?? 0;

  // Tier weight
  const tierScores: Record<string, number> = { S: 2.5, A: 2, B: 1.5, C: 1, D: 0.5 };
  score += tierScores[champ.aramTier] ?? 1;

  // Preferred role bonus
  if (preferredRoles.includes(champ.aramRole)) {
    score += 1;
  }

  return score;
}

function generateAssignments(
  players: { id?: number; name: string }[],
  slotCandidates: { playerId: number; champions: Champion[] }[][],
  proficiencies: Record<number, Map<string, ProficiencyLevel>>,
  champMap: Map<string, Champion>
): ChampionAssignment[][] {
  const results: ChampionAssignment[][] = [];
  const usedPlayers = new Set<number>();
  const usedChampions = new Set<string>();

  function backtrack(slotIdx: number, current: ChampionAssignment[]) {
    if (results.length >= 20) return; // Limit search
    if (slotIdx >= slotCandidates.length) {
      if (current.length === players.length) {
        results.push([...current]);
      }
      return;
    }

    const candidates = slotCandidates[slotIdx];
    for (const candidate of candidates) {
      if (usedPlayers.has(candidate.playerId)) continue;

      for (const champ of candidate.champions) {
        if (usedChampions.has(champ.id)) continue;

        const playerProfs = proficiencies[candidate.playerId] ?? new Map();
        const prof = playerProfs.get(champ.id) ?? '없음';
        if (prof === '없음') continue;

        const player = players.find((p) => p.id === candidate.playerId);
        if (!player) continue;

        usedPlayers.add(candidate.playerId);
        usedChampions.add(champ.id);
        current.push({
          playerId: candidate.playerId,
          playerName: player.name,
          championId: champ.id,
          championName: champMap.get(champ.id)?.nameKo ?? champ.id,
          proficiency: prof,
        });

        backtrack(slotIdx + 1, current);

        current.pop();
        usedPlayers.delete(candidate.playerId);
        usedChampions.delete(champ.id);
      }
    }
  }

  backtrack(0, []);
  return results;
}

function deduplicateComps(comps: RecommendedComp[]): RecommendedComp[] {
  const seen = new Set<string>();
  return comps.filter((comp) => {
    const key = comp.assignments
      .map((a) => `${a.playerId}:${a.championId}`)
      .sort()
      .join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// --- Ban Recommendation ---

const PROF_THREAT: Record<string, number> = { '상': 3, '중': 1.5, '하': 0.5 };
const TIER_WEIGHT: Record<AramTier, number> = { S: 2.5, A: 2, B: 1.5, C: 1, D: 0.5 };

export function generatePerPlayerBanRecs(
  input: BanRecommendationInput
): Record<number, BanRecommendation[]> {
  const { opponentPlayerIds, proficiencies, allChampions, alreadyBanned } = input;
  const bannedSet = new Set(alreadyBanned);
  const result: Record<number, BanRecommendation[]> = {};

  for (const pid of opponentPlayerIds) {
    const profMap = proficiencies[pid] ?? new Map();
    const recs: BanRecommendation[] = [];

    for (const champ of allChampions) {
      if (bannedSet.has(champ.id)) continue;
      const level = profMap.get(champ.id);
      const profScore = PROF_THREAT[level ?? ''] ?? 0;
      if (profScore === 0) continue;

      const tierW = TIER_WEIGHT[champ.aramTier] ?? 1;
      const wrBonus = Math.max(-0.5, Math.min(0.5, (champ.aramWinrate - 50) * 0.1));
      const score = profScore * tierW + wrBonus;

      recs.push({ championId: champ.id, championName: champ.nameKo, score, reason: '' });
    }

    recs.sort((a, b) => b.score - a.score);
    result[pid] = recs.slice(0, 7);
  }

  return result;
}

// --- Per-player top champion recommendations ---
export function getPlayerTopChampions(
  _playerId: number,
  profMap: Map<string, ProficiencyLevel>,
  availableChampions: Champion[],
  count = 7
): Champion[] {
  return availableChampions
    .filter((c) => {
      const level = profMap.get(c.id);
      return level && level !== '없음';
    })
    .map((c) => ({
      champ: c,
      score: (PROF_THREAT[profMap.get(c.id)!] ?? 0) * (TIER_WEIGHT[c.aramTier] ?? 1),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((x) => x.champ);
}
