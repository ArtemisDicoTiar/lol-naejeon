import { championTraits, type ChampionTraits, type MechanicTag } from '@/data/champion-tags';
import { compArchetypes } from '@/data/comp-archetypes';
import { counterRules } from '@/data/counter-rules';
import { getTagLabel } from '@/data/tag-display';
import { db, type Champion, type Game, type GameBan, type GameMode, type GamePick, type Player, type ProficiencyLevel } from './db';
import { loadSynergyCounterData, type SynergyCounterData } from './recommendation/data-loader';
import { scoreComposition } from './recommendation/scoring';
import type { ChampionAssignment, ScoreBreakdown } from './recommendation/types';

export type BanPickLabModeFilter = 'all' | GameMode;

export interface LabChampionMeta {
  id: string;
  nameKo: string;
  imageUrl: string;
  aramTier: Champion['aramTier'];
  aramRole: Champion['aramRole'];
  damageType: Champion['damageType'];
}

export interface LabPick {
  playerId: number;
  playerName: string;
  championId: string;
  championName: string;
  imageUrl: string;
  proficiency: ProficiencyLevel;
  tier: Champion['aramTier'];
  role: Champion['aramRole'];
  damageType: Champion['damageType'];
  score: number;
  contestedScore: number;
  reasons: string[];
}

export interface LabBan {
  championId: string;
  championName: string;
  imageUrl: string;
  score: number;
  reason: string;
  targetPlayers: string[];
}

export interface LabPickGroup {
  picks: LabPick[];
  score: number;
  scoreBreakdown: ScoreBreakdown;
  archetypeName: string;
  tags: string[];
  summary: string;
}

export interface LabScenario {
  id: string;
  title: string;
  aFirst: LabPick;
  bResponse: LabPickGroup;
  aCompletion: LabPickGroup;
  bFinal: LabPickGroup;
  aFinalScore: number;
  bFinalScore: number;
  scoreDelta: number;
  verdict: 'A 우세' | '균형' | 'B 카운터';
  risk: '낮음' | '중간' | '높음';
  notes: string[];
  assumedBans: {
    teamA: LabBan[];
    teamB: LabBan[];
  };
}

export interface BanPickLabAnalysis {
  modeFilter: BanPickLabModeFilter;
  teamA: Pick<Player, 'id' | 'name'>[];
  teamB: Pick<Player, 'id' | 'name'>[];
  championMeta: LabChampionMeta[];
  banPlanA: LabBan[];
  banPlanB: LabBan[];
  firstPickPlans: LabPick[];
  scenarios: LabScenario[];
  generatedAt: Date;
  dataNotes: string[];
}

const PROF_VALUE: Record<ProficiencyLevel, number> = {
  S: 1,
  '상': 0.86,
  '중': 0.62,
  '하': 0.34,
  '없음': 0,
};

const TIER_VALUE: Record<Champion['aramTier'], number> = {
  S: 1,
  A: 0.83,
  B: 0.63,
  C: 0.42,
  D: 0.24,
};

const ROLE_LABELS: Record<Champion['aramRole'], string> = {
  poke: '포크',
  engage: '이니시',
  sustain: '유지',
  dps: 'DPS',
  tank: '탱커',
  utility: '유틸',
};

const POWER_TIER = new Set<Champion['aramTier']>(['S', 'A']);

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [[]];
  if (size > items.length) return [];
  const out: T[][] = [];
  const walk = (start: number, acc: T[]) => {
    if (acc.length === size) {
      out.push([...acc]);
      return;
    }
    for (let index = start; index <= items.length - (size - acc.length); index++) {
      acc.push(items[index]);
      walk(index + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

function buildTraitsMap(): Map<string, ChampionTraits> {
  return new Map(Object.entries(championTraits));
}

function effectiveProficiency(profMap: Map<string, ProficiencyLevel> | undefined, championId: string): ProficiencyLevel {
  if (!profMap || profMap.size === 0) return '중';
  return profMap.get(championId) ?? '없음';
}

function winrateValue(champion: Champion) {
  return clamp((champion.aramWinrate - 45) / 12);
}

function buildPresence(
  games: Game[],
  picks: GamePick[],
  bans: GameBan[],
  modeFilter: BanPickLabModeFilter,
) {
  const targetGames = games.filter((game) => modeFilter === 'all' || (game.mode ?? 'aram') === modeFilter);
  const gameIds = new Set(targetGames.map((game) => game.id).filter((id): id is number => typeof id === 'number'));
  const pickCounts = new Map<string, number>();
  const banCounts = new Map<string, number>();

  for (const pick of picks) {
    if (!gameIds.has(pick.gameId)) continue;
    pickCounts.set(pick.championId, (pickCounts.get(pick.championId) ?? 0) + 1);
  }
  for (const ban of bans) {
    if (!gameIds.has(ban.gameId)) continue;
    banCounts.set(ban.championId, (banCounts.get(ban.championId) ?? 0) + 1);
  }

  const denominator = Math.max(targetGames.length, 1);
  return new Map<string, { pickRate: number; banRate: number; value: number }>(
    [...new Set([...pickCounts.keys(), ...banCounts.keys()])].map((championId) => {
      const pickRate = ((pickCounts.get(championId) ?? 0) / denominator) * 100;
      const banRate = ((banCounts.get(championId) ?? 0) / denominator) * 100;
      return [championId, { pickRate, banRate, value: clamp((pickRate + banRate * 1.5) / 50) }];
    }),
  );
}

function makePickFactory(
  playersById: Map<number, Player>,
  proficiencies: Record<number, Map<string, ProficiencyLevel>>,
  presence: Map<string, { value: number }>,
  teamAIds: number[],
  teamBIds: number[],
) {
  const teamASet = new Set(teamAIds);
  const teamBSet = new Set(teamBIds);

  const bestForTeam = (playerIds: number[], champion: Champion) => {
    return Math.max(...playerIds.map((playerId) => {
      const level = effectiveProficiency(proficiencies[playerId], champion.id);
      if (level === '없음') return 0;
      return getPickBaseScore(champion, level, presence.get(champion.id)?.value ?? 0);
    }), 0);
  };

  return (playerId: number, champion: Champion): LabPick => {
    const level = effectiveProficiency(proficiencies[playerId], champion.id);
    const score = getPickBaseScore(champion, level, presence.get(champion.id)?.value ?? 0);
    const opponentIds = teamASet.has(playerId) ? teamBIds : teamBSet.has(playerId) ? teamAIds : [];
    const contestedScore = bestForTeam(opponentIds, champion);
    const reasons = [
      `${champion.aramTier}티어`,
      `${ROLE_LABELS[champion.aramRole]} 역할`,
      level === 'S' || level === '상' ? `${level} 숙련` : undefined,
      contestedScore >= 0.72 ? '상대도 탐낼 카드' : undefined,
      (presence.get(champion.id)?.value ?? 0) >= 0.45 ? '내전 존재감' : undefined,
    ].filter((reason): reason is string => Boolean(reason));

    return {
      playerId,
      playerName: playersById.get(playerId)?.name ?? `Player ${playerId}`,
      championId: champion.id,
      championName: champion.nameKo,
      imageUrl: champion.imageUrl,
      proficiency: level,
      tier: champion.aramTier,
      role: champion.aramRole,
      damageType: champion.damageType,
      score,
      contestedScore,
      reasons,
    };
  };
}

function getPickBaseScore(champion: Champion, proficiency: ProficiencyLevel, presence: number) {
  return clamp(
    PROF_VALUE[proficiency] * 0.43 +
    TIER_VALUE[champion.aramTier] * 0.24 +
    winrateValue(champion) * 0.18 +
    presence * 0.15,
  );
}

function toAssignment(pick: LabPick): ChampionAssignment {
  return {
    playerId: pick.playerId,
    playerName: pick.playerName,
    championId: pick.championId,
    championName: pick.championName,
    proficiency: pick.proficiency,
  };
}

function inferArchetype(picks: LabPick[]) {
  const counts = new Map<Champion['aramRole'], number>();
  for (const pick of picks) {
    counts.set(pick.role, (counts.get(pick.role) ?? 0) + 1);
  }
  if ((counts.get('poke') ?? 0) >= 2) return 'poke';
  if ((counts.get('engage') ?? 0) + (counts.get('tank') ?? 0) >= 2) return 'engage';
  if ((counts.get('sustain') ?? 0) + (counts.get('utility') ?? 0) >= 2) return 'sustain';
  return 'balanced';
}

function scorePickGroup(
  picks: LabPick[],
  champMap: Map<string, Champion>,
  traitsMap: Map<string, ChampionTraits>,
  opponentPicks: string[],
  matchData: SynergyCounterData | null,
): LabPickGroup {
  const archetypeId = inferArchetype(picks);
  const scored = scoreComposition(
    picks.map(toAssignment),
    champMap,
    traitsMap,
    archetypeId,
    opponentPicks,
    matchData,
  );
  const archetypeName = compArchetypes.find((archetype) => archetype.id === archetypeId)?.nameKo ?? '밸런스';
  const powerCount = picks.filter((pick) => POWER_TIER.has(pick.tier)).length;
  const traits = summarizeTraits(picks, traitsMap);
  const tags = [
    `${powerCount}/${picks.length} A급+`,
    archetypeName,
    traits[0],
  ].filter((tag): tag is string => Boolean(tag));

  return {
    picks,
    score: scored.score,
    scoreBreakdown: scored.breakdown,
    archetypeName,
    tags,
    summary: `${archetypeName} · ${picks.map((pick) => pick.championName).join(' + ')}`,
  };
}

function summarizeTraits(picks: LabPick[], traitsMap: Map<string, ChampionTraits>) {
  const counts = new Map<MechanicTag, number>();
  for (const pick of picks) {
    const traits = traitsMap.get(pick.championId);
    if (!traits) continue;
    for (const tag of traits.mechanics) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tag, count]) => `${getTagLabel(tag)}${count > 1 ? count : ''}`);
}

function counterReasons(picks: LabPick[], opponentIds: string[], traitsMap: Map<string, ChampionTraits>) {
  const reasons: string[] = [];
  for (const rule of counterRules) {
    for (const oppId of opponentIds) {
      const oppTraits = traitsMap.get(oppId);
      if (!oppTraits || !rule.victimTags.every((tag) => oppTraits.mechanics.includes(tag))) continue;
      for (const pick of picks) {
        const ourTraits = traitsMap.get(pick.championId);
        if (!ourTraits || !rule.counterTags.every((tag) => ourTraits.mechanics.includes(tag))) continue;
        reasons.push(rule.nameKo);
      }
    }
  }
  return [...new Set(reasons)].slice(0, 2);
}

function buildCandidatePool(
  playerId: number,
  champions: Champion[],
  makePick: (playerId: number, champion: Champion) => LabPick,
  banned: Set<string>,
  used: Set<string>,
  limit: number,
) {
  return champions
    .filter((champion) => !banned.has(champion.id) && !used.has(champion.id))
    .map((champion) => makePick(playerId, champion))
    .filter((pick) => pick.proficiency !== '없음')
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function buildBanPlan(
  banningTeamIds: number[],
  targetTeamIds: number[],
  champions: Champion[],
  makePick: (playerId: number, champion: Champion) => LabPick,
  traitsMap: Map<string, ChampionTraits>,
  presence: Map<string, { value: number }>,
  alreadyBlocked = new Set<string>(),
  limit = 3,
): LabBan[] {
  const rows = champions
    .filter((champion) => !alreadyBlocked.has(champion.id))
    .map((champion) => {
      const targetPicks = targetTeamIds
        .map((playerId) => makePick(playerId, champion))
        .filter((pick) => pick.proficiency !== '없음')
        .sort((a, b) => b.score - a.score);
      if (targetPicks.length === 0) return null;

      const ourBest = Math.max(...banningTeamIds.map((playerId) => {
        const pick = makePick(playerId, champion);
        return pick.proficiency === '없음' ? 0 : pick.score;
      }), 0);
      const targetBest = targetPicks[0];
      const traits = traitsMap.get(champion.id);
      const synergyPotential = traits
        ? Math.min(1, traits.mechanics.length / 5 + (traits.teamfight.length / 6))
        : 0.2;
      const presenceValue = presence.get(champion.id)?.value ?? 0;
      const score = clamp(
        targetBest.score * 0.52 +
        synergyPotential * 0.16 +
        TIER_VALUE[champion.aramTier] * 0.15 +
        presenceValue * 0.12 -
        ourBest * 0.10,
      );
      const reason = targetBest.proficiency === 'S' || targetBest.proficiency === '상'
        ? `${targetBest.playerName} ${targetBest.proficiency} 숙련 차단`
        : presenceValue >= 0.45
          ? '내전 존재감 차단'
          : `${champion.aramTier}티어 메타 차단`;

      return {
        championId: champion.id,
        championName: champion.nameKo,
        imageUrl: champion.imageUrl,
        score,
        reason,
        targetPlayers: targetPicks.slice(0, 2).map((pick) => pick.playerName),
      };
    })
    .filter((row): row is LabBan => Boolean(row))
    .sort((a, b) => b.score - a.score);

  return rows.slice(0, limit);
}

function buildFirstPickPlans(
  teamAIds: number[],
  teamBIds: number[],
  champions: Champion[],
  makePick: (playerId: number, champion: Champion) => LabPick,
  aBans: LabBan[],
) {
  const blocked = new Set(aBans.map((ban) => ban.championId));
  const rows: LabPick[] = [];
  for (const playerId of teamAIds) {
    rows.push(...buildCandidatePool(playerId, champions, makePick, blocked, new Set(), 18));
  }

  return rows
    .map((pick) => {
      const sameChampionBThreat = Math.max(...teamBIds.map((playerId) => makePick(playerId, champions.find((champion) => champion.id === pick.championId)!).score), 0);
      return {
        pick: {
          ...pick,
          contestedScore: sameChampionBThreat,
          reasons: [
            ...pick.reasons,
            sameChampionBThreat >= 0.7 ? '열리면 B도 가져갈 수 있음' : '선픽 안정권',
          ],
        },
        orderScore: pick.score * 0.68 + sameChampionBThreat * 0.18 + (pick.tier === 'S' ? 0.12 : pick.tier === 'A' ? 0.07 : 0),
      };
    })
    .sort((a, b) => b.orderScore - a.orderScore)
    .map((row) => row.pick)
    .slice(0, 10);
}

function buildPairGroups(
  playerIds: number[],
  champions: Champion[],
  makePick: (playerId: number, champion: Champion) => LabPick,
  champMap: Map<string, Champion>,
  traitsMap: Map<string, ChampionTraits>,
  matchData: SynergyCounterData | null,
  banned: Set<string>,
  used: Set<string>,
  opponentPicks: string[],
  limit = 6,
) {
  const groups: LabPickGroup[] = [];
  for (const [leftId, rightId] of combinations(playerIds, 2)) {
    const leftPool = buildCandidatePool(leftId, champions, makePick, banned, used, 14);
    const rightPool = buildCandidatePool(rightId, champions, makePick, banned, used, 14);
    for (const left of leftPool) {
      for (const right of rightPool) {
        if (left.championId === right.championId) continue;
        const picks = [left, right];
        const group = scorePickGroup(picks, champMap, traitsMap, opponentPicks, matchData);
        const fit = (left.score + right.score) / 2;
        const counterTags = counterReasons(picks, opponentPicks, traitsMap);
        groups.push({
          ...group,
          score: group.score * 0.72 + fit * 0.28,
          tags: [...group.tags, ...counterTags],
        });
      }
    }
  }

  return dedupeGroups(groups)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function buildSingleGroups(
  playerIds: number[],
  champions: Champion[],
  makePick: (playerId: number, champion: Champion) => LabPick,
  champMap: Map<string, Champion>,
  traitsMap: Map<string, ChampionTraits>,
  matchData: SynergyCounterData | null,
  banned: Set<string>,
  used: Set<string>,
  lockedPicks: LabPick[],
  opponentPicks: string[],
  limit = 5,
) {
  const groups: LabPickGroup[] = [];
  for (const playerId of playerIds) {
    const pool = buildCandidatePool(playerId, champions, makePick, banned, used, 32);
    for (const pick of pool) {
      const fullPicks = [...lockedPicks, pick];
      const group = scorePickGroup(fullPicks, champMap, traitsMap, opponentPicks, matchData);
      const counterTags = counterReasons([pick], opponentPicks, traitsMap);
      groups.push({
        ...group,
        picks: [pick],
        score: group.score * 0.78 + pick.score * 0.22,
        tags: [...group.tags, ...counterTags],
      });
    }
  }

  return dedupeGroups(groups)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function dedupeGroups(groups: LabPickGroup[]) {
  const seen = new Set<string>();
  return groups.filter((group) => {
    const key = group.picks
      .map((pick) => `${pick.playerId}:${pick.championId}`)
      .sort()
      .join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildScenarios(
  teamAIds: number[],
  teamBIds: number[],
  champions: Champion[],
  makePick: (playerId: number, champion: Champion) => LabPick,
  champMap: Map<string, Champion>,
  traitsMap: Map<string, ChampionTraits>,
  matchData: SynergyCounterData | null,
  banPlanA: LabBan[],
  baseBanPlanB: LabBan[],
  presence: Map<string, { value: number }>,
) {
  const firstPlans = buildFirstPickPlans(teamAIds, teamBIds, champions, makePick, banPlanA);
  const scenarios: LabScenario[] = [];

  for (const first of firstPlans.slice(0, 7)) {
    const blockedForB = new Set([...banPlanA.map((ban) => ban.championId), first.championId]);
    const bBans = buildBanPlan(teamBIds, teamAIds, champions, makePick, traitsMap, presence, blockedForB, 3);
    const banned = new Set([...banPlanA, ...bBans].map((ban) => ban.championId));
    const usedAfterFirst = new Set([first.championId]);
    const bResponses = buildPairGroups(
      teamBIds,
      champions,
      makePick,
      champMap,
      traitsMap,
      matchData,
      banned,
      usedAfterFirst,
      [first.championId],
      3,
    );

    for (const response of bResponses.slice(0, 2)) {
      const usedAfterB = new Set([first.championId, ...response.picks.map((pick) => pick.championId)]);
      const remainingA = teamAIds.filter((playerId) => playerId !== first.playerId);
      const aCompletions = buildPairGroups(
        remainingA,
        champions,
        makePick,
        champMap,
        traitsMap,
        matchData,
        banned,
        usedAfterB,
        response.picks.map((pick) => pick.championId),
        2,
      );
      const aCompletion = aCompletions[0];
      if (!aCompletion) continue;

      const aFullPicks = [first, ...aCompletion.picks];
      const usedAfterA = new Set([...usedAfterB, ...aCompletion.picks.map((pick) => pick.championId)]);
      const remainingB = teamBIds.filter((playerId) => !response.picks.some((pick) => pick.playerId === playerId));
      const bFinals = buildSingleGroups(
        remainingB,
        champions,
        makePick,
        champMap,
        traitsMap,
        matchData,
        banned,
        usedAfterA,
        response.picks,
        aFullPicks.map((pick) => pick.championId),
        3,
      );
      const bFinal = bFinals[0];
      if (!bFinal) continue;

      const bFullPicks = [...response.picks, ...bFinal.picks];
      const aFinal = scorePickGroup(aFullPicks, champMap, traitsMap, bFullPicks.map((pick) => pick.championId), matchData);
      const bFinalFull = scorePickGroup(bFullPicks, champMap, traitsMap, aFullPicks.map((pick) => pick.championId), matchData);
      const delta = (aFinal.score - bFinalFull.score) * 100;
      const verdict = delta >= 4 ? 'A 우세' : delta <= -4 ? 'B 카운터' : '균형';
      const risk = first.contestedScore >= 0.76 || baseBanPlanB.some((ban) => ban.championId === first.championId)
        ? '높음'
        : Math.abs(delta) <= 4
          ? '중간'
          : '낮음';

      scenarios.push({
        id: `${first.playerId}-${first.championId}-${response.picks.map((pick) => pick.championId).join('-')}`,
        title: `${first.championName} 선픽 플랜`,
        aFirst: first,
        bResponse: response,
        aCompletion,
        bFinal,
        aFinalScore: aFinal.score,
        bFinalScore: bFinalFull.score,
        scoreDelta: delta,
        verdict,
        risk,
        notes: [
          first.contestedScore >= 0.72
            ? 'A가 먹으려면 B가 이 카드를 밴하지 않는 전제가 필요합니다.'
            : 'B가 밴을 쓰지 않을 가능성이 있는 선픽 후보입니다.',
          response.tags.some((tag) => tag.includes('A급+'))
            ? 'B는 2픽 구간에서 고티어 조합을 즉시 묶을 수 있습니다.'
            : `${response.summary}로 B가 응수합니다.`,
          bFinal.tags.length > 0
            ? `B 막픽 카운터 포인트: ${bFinal.tags.slice(-2).join(' · ')}`
            : 'B 막픽은 최종 조합 점수 기준으로 선택됩니다.',
        ],
        assumedBans: {
          teamA: banPlanA,
          teamB: bBans,
        },
      });
    }
  }

  return {
    firstPlans,
    scenarios: scenarios
      .sort((a, b) => b.scoreDelta - a.scoreDelta || b.aFirst.score - a.aFirst.score)
      .slice(0, 8),
  };
}

export async function computeBanPickLabAnalysis(
  teamAIds: number[],
  teamBIds: number[],
  modeFilter: BanPickLabModeFilter = 'all',
): Promise<BanPickLabAnalysis> {
  const [players, champions, proficiencyRows, games, picks, bans, matchData] = await Promise.all([
    db.players.toArray(),
    db.champions.toArray(),
    db.proficiencies.toArray(),
    db.games.toArray(),
    db.gamePicks.toArray(),
    db.gameBans.toArray(),
    loadSynergyCounterData(),
  ]);

  const playersById = new Map(players.map((player) => [player.id!, player]));
  const teamA = teamAIds.map((id) => playersById.get(id)).filter((player): player is Player => Boolean(player));
  const teamB = teamBIds.map((id) => playersById.get(id)).filter((player): player is Player => Boolean(player));
  const sortedChampions = [...champions].sort((a, b) => {
    const tierDiff = TIER_VALUE[b.aramTier] - TIER_VALUE[a.aramTier];
    if (tierDiff !== 0) return tierDiff;
    return b.aramWinrate - a.aramWinrate;
  });
  const proficiencies: Record<number, Map<string, ProficiencyLevel>> = {};
  for (const row of proficiencyRows) {
    const map = proficiencies[row.playerId] ?? new Map<string, ProficiencyLevel>();
    map.set(row.championId, row.level);
    proficiencies[row.playerId] = map;
  }

  const presence = buildPresence(games, picks, bans, modeFilter);
  const traitsMap = buildTraitsMap();
  const champMap = new Map(champions.map((champion) => [champion.id, champion]));
  const makePick = makePickFactory(playersById, proficiencies, presence, teamAIds, teamBIds);
  const banPlanA = buildBanPlan(teamAIds, teamBIds, sortedChampions, makePick, traitsMap, presence, new Set(), 3);
  const banPlanB = buildBanPlan(teamBIds, teamAIds, sortedChampions, makePick, traitsMap, presence, new Set(banPlanA.map((ban) => ban.championId)), 3);
  const { firstPlans, scenarios } = buildScenarios(
    teamAIds,
    teamBIds,
    sortedChampions,
    makePick,
    champMap,
    traitsMap,
    matchData,
    banPlanA,
    banPlanB,
    presence,
  );

  return {
    modeFilter,
    teamA: teamA.map((player) => ({ id: player.id, name: player.name })),
    teamB: teamB.map((player) => ({ id: player.id, name: player.name })),
    championMeta: champions.map((champion) => ({
      id: champion.id,
      nameKo: champion.nameKo,
      imageUrl: champion.imageUrl,
      aramTier: champion.aramTier,
      aramRole: champion.aramRole,
      damageType: champion.damageType,
    })),
    banPlanA,
    banPlanB,
    firstPickPlans: firstPlans,
    scenarios,
    generatedAt: new Date(),
    dataNotes: [
      matchData ? '외부 시너지/카운터 매치업 데이터 반영' : '외부 매치업 데이터 없음: 태그 규칙 중심',
      '숙련도 미등록 선수는 중간 숙련으로 임시 계산',
      'A 선픽 시나리오는 B가 해당 챔피언을 밴하지 않았다는 전제',
    ],
  };
}
