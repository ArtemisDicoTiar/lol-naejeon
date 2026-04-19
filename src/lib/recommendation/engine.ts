import type { Champion, ProficiencyLevel } from '@/lib/db';
import type { RecommendationInput, RecommendedComp, ChampionAssignment, BanRecommendationInput, BanRecommendation } from './types';
import { scoreComposition } from './scoring';
import { compArchetypes } from '@/data/comp-archetypes';
import type { AramTier } from '@/data/aram-champion-meta';
import { championTraits, type ChampionTraits } from '@/data/champion-tags';
import { synergyRules, synergyOverrides } from '@/data/synergy-rules';
import { counterRules } from '@/data/counter-rules';

function buildTraitsMap(): Map<string, ChampionTraits> {
  return new Map(Object.entries(championTraits));
}

const CANDIDATES_PER_SLOT = 5;
const MAX_RESULTS = 10;

export function generateRecommendations(input: RecommendationInput): RecommendedComp[] {
  const { teamPlayers, bannedChampions, allChampions, proficiencies, opponentPicks, matchData, lockedPicks } = input;
  const bannedSet = new Set(bannedChampions);
  const champMap = new Map(allChampions.map((c) => [c.id, c]));
  const traitsMap = buildTraitsMap();

  // Separate locked players (already picked) from unlocked players
  const locked = lockedPicks ?? {};
  const lockedPlayerIds = new Set(Object.keys(locked).map(Number));
  const lockedChampIds = new Set(Object.values(locked));
  const unlockedPlayers = teamPlayers.filter((p) => !lockedPlayerIds.has(p.id!));

  // Build locked assignments
  const lockedAssignments: ChampionAssignment[] = [];
  for (const [pidStr, champId] of Object.entries(locked)) {
    const pid = Number(pidStr);
    const player = teamPlayers.find((p) => p.id === pid);
    const champ = champMap.get(champId);
    if (!player || !champ) continue;
    const profMap = proficiencies[pid] ?? new Map();
    lockedAssignments.push({
      playerId: pid,
      playerName: player.name,
      championId: champId,
      championName: champ.nameKo,
      proficiency: profMap.get(champId) ?? '중',
    });
  }

  // If all players are locked, just score that single composition
  if (unlockedPlayers.length === 0 && lockedAssignments.length > 0) {
    const { score, breakdown } = scoreComposition(lockedAssignments, champMap, traitsMap, 'balanced', opponentPicks, matchData);
    const damageProfile = { ap: 0, ad: 0, hybrid: 0 };
    for (const a of lockedAssignments) {
      const c = champMap.get(a.championId);
      if (c) { if (c.damageType === 'AP') damageProfile.ap++; else if (c.damageType === 'AD') damageProfile.ad++; else damageProfile.hybrid++; }
    }
    return [{ archetypeId: 'balanced', archetypeName: '현재 조합', assignments: lockedAssignments, score, scoreBreakdown: breakdown, damageProfile, strengths: [], weaknesses: [] }];
  }

  // Build available champion pools per unlocked player
  const playerPools: Map<number, Champion[]> = new Map();
  for (const player of unlockedPlayers) {
    const playerProfs = proficiencies[player.id!] ?? new Map();
    const available = allChampions.filter((c) => {
      if (bannedSet.has(c.id)) return false;
      if (lockedChampIds.has(c.id)) return false;
      const level = playerProfs.get(c.id);
      if (level === '없음') return false;
      return true;
    });
    playerPools.set(player.id!, available);
  }

  const allResults: RecommendedComp[] = [];
  const unlockedSize = unlockedPlayers.length;
  if (unlockedSize === 0) return [];

  for (const archetype of compArchetypes) {
    // Use slot count matching unlocked players
    const slots = unlockedSize <= 3 ? archetype.slots3 : archetype.slots4;
    if (slots.length < unlockedSize) continue;
    const usedSlots = slots.slice(0, unlockedSize);

    // For each slot, find top candidates from each unlocked player
    const slotCandidates: { playerId: number; champions: Champion[] }[][] = [];

    for (let slotIdx = 0; slotIdx < usedSlots.length; slotIdx++) {
      const slot = usedSlots[slotIdx];
      const candidates: { playerId: number; champions: Champion[] }[] = [];

      for (const player of unlockedPlayers) {
        const pool = playerPools.get(player.id!) ?? [];
        const playerProfs = proficiencies[player.id!] ?? new Map();

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

    // Generate compositions for unlocked players
    const compositions = generateAssignments(
      unlockedPlayers,
      slotCandidates,
      proficiencies,
      champMap
    );

    for (const unlockedAssignments of compositions) {
      // Combine locked + unlocked for full team scoring
      const fullAssignments = [...lockedAssignments, ...unlockedAssignments];

      const { score, breakdown } = scoreComposition(
        fullAssignments,
        champMap,
        traitsMap,
        archetype.id,
        opponentPicks,
        matchData
      );

      const damageProfile = { ap: 0, ad: 0, hybrid: 0 };
      for (const a of fullAssignments) {
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
        assignments: fullAssignments,
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
  const profScores: Record<string, number> = { 'S': 5, '상': 3, '중': 2, '하': 1 };
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

const PROF_THREAT: Record<string, number> = { 'S': 5, '상': 3, '중': 1.5, '하': 0.5 };
const TIER_WEIGHT: Record<AramTier, number> = { S: 2.5, A: 2, B: 1.5, C: 1, D: 0.5 };

// Compute how much banning a champion reduces opponent synergy potential
function calcSynergyDenial(
  banChampId: string,
  opponentPools: Map<number, string[]>,
  traitsMap: Map<string, ChampionTraits>
): number {
  const banTraits = traitsMap.get(banChampId);
  if (!banTraits) return 0;

  let denial = 0;
  for (const rule of synergyRules) {
    const isSource = rule.source.every((t) => banTraits.mechanics.includes(t));
    const isTarget = rule.target.every((t) => banTraits.mechanics.includes(t));
    if (!isSource && !isTarget) continue;

    const checkTags = isSource ? rule.target : rule.source;
    let partnerCount = 0;
    for (const [, pool] of opponentPools) {
      for (const cid of pool) {
        if (cid === banChampId) continue;
        const traits = traitsMap.get(cid);
        if (traits && checkTags.every((t) => traits.mechanics.includes(t))) {
          partnerCount++;
        }
      }
    }
    denial += rule.bonus * Math.min(partnerCount, 3);
  }

  // Check override pairs
  for (const [c1, c2, score] of synergyOverrides) {
    if (banChampId !== c1 && banChampId !== c2) continue;
    const partnerId = banChampId === c1 ? c2 : c1;
    for (const [, pool] of opponentPools) {
      if (pool.includes(partnerId)) {
        denial += score;
        break;
      }
    }
  }

  return Math.min(denial / 2.0, 1.0);
}

// Compute how much banning a champion protects our team from being countered
function calcCounterBanValue(
  banChampId: string,
  ourTeamLikelyPicks: string[],
  traitsMap: Map<string, ChampionTraits>
): number {
  const banTraits = traitsMap.get(banChampId);
  if (!banTraits) return 0;

  let counterValue = 0;
  for (const rule of counterRules) {
    if (!rule.counterTags.every((t) => banTraits.mechanics.includes(t))) continue;
    for (const ourId of ourTeamLikelyPicks) {
      const ourTraits = traitsMap.get(ourId);
      if (ourTraits && rule.victimTags.every((t) => ourTraits.mechanics.includes(t))) {
        counterValue += rule.advantage;
      }
    }
  }
  return Math.min(counterValue, 1.0);
}

export function generatePerPlayerBanRecs(
  input: BanRecommendationInput
): Record<number, BanRecommendation[]> {
  const { opponentPlayerIds, proficiencies, allChampions, alreadyBanned } = input;
  const bannedSet = new Set(alreadyBanned);
  const traitsMap = buildTraitsMap();
  const result: Record<number, BanRecommendation[]> = {};

  // Build opponent champion pools for synergy denial calc
  const opponentPools = new Map<number, string[]>();
  for (const pid of opponentPlayerIds) {
    const profMap = proficiencies[pid] ?? new Map();
    const pool: string[] = [];
    for (const champ of allChampions) {
      if (bannedSet.has(champ.id)) continue;
      const level = profMap.get(champ.id);
      if (level && level !== '없음') pool.push(champ.id);
    }
    opponentPools.set(pid, pool);
  }

  // Build our team's likely picks for counter-ban calc
  const ourTeamPicks: string[] = [];
  if (input.ourTeamProficiencies) {
    for (const [, profMap] of Object.entries(input.ourTeamProficiencies)) {
      for (const [champId, level] of profMap.entries()) {
        if (level === '상' && !bannedSet.has(champId)) ourTeamPicks.push(champId);
      }
    }
  }

  for (const pid of opponentPlayerIds) {
    const profMap = proficiencies[pid] ?? new Map();
    const recs: BanRecommendation[] = [];
    const fallbackRecs: BanRecommendation[] = []; // meta-based for when no proficiency data

    for (const champ of allChampions) {
      if (bannedSet.has(champ.id)) continue;
      const level = profMap.get(champ.id);
      const profScore = PROF_THREAT[level ?? ''] ?? 0;

      const tierW = TIER_WEIGHT[champ.aramTier] ?? 1;
      const wrBonus = Math.max(-0.5, Math.min(0.5, (champ.aramWinrate - 50) * 0.1));

      // Always compute meta-based fallback score (used if no proficiency data)
      const metaScore = (tierW + wrBonus) / 3.0;
      fallbackRecs.push({ championId: champ.id, championName: champ.nameKo, score: metaScore, reason: 'ARAM 메타 위협' });

      if (profScore === 0) continue;

      // Factor 1: Proficiency threat (normalized to ~0-1)
      const profThreat = (profScore * tierW + wrBonus) / 8.0; // max ~7.5+0.5=8

      // Factor 2: Synergy denial
      const synergyDenial = calcSynergyDenial(champ.id, opponentPools, traitsMap);

      // Factor 3: Counter-ban value
      const counterBan = ourTeamPicks.length > 0
        ? calcCounterBanValue(champ.id, ourTeamPicks, traitsMap)
        : 0;

      const score = profThreat * 0.4 + synergyDenial * 0.3 + counterBan * 0.3;

      // Determine primary reason
      let reason = '';
      if (synergyDenial > profThreat && synergyDenial > counterBan) {
        reason = '시너지 차단';
      } else if (counterBan > profThreat && counterBan > 0) {
        reason = '카운터 밴';
      } else {
        reason = '고숙련 위협';
      }

      recs.push({ championId: champ.id, championName: champ.nameKo, score, reason });
    }

    // If no proficiency-based recs, fall back to meta-based
    if (recs.length === 0) {
      fallbackRecs.sort((a, b) => b.score - a.score);
      result[pid] = fallbackRecs.slice(0, 7);
    } else {
      recs.sort((a, b) => b.score - a.score);
      result[pid] = recs.slice(0, 7);
    }
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
