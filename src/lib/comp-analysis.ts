import { championTraits, type MechanicTag } from '@/data/champion-tags';
import { getTagLabel } from '@/data/tag-display';
import { db, GAME_MODE_LABELS, type Champion, type Game, type GameMode, type GamePick, type Player } from './db';

type Role = Champion['aramRole'];
export type CompositionModeFilter = 'all' | GameMode;

export interface CompositionAggregate {
  id: string;
  label: string;
  games: number;
  wins: number;
  losses: number;
  winrate: number;
  smoothedWinrate: number;
  share: number;
  examples: string[][];
}

export interface ChampionComboAggregate extends CompositionAggregate {
  championIds: string[];
}

export interface CompositionMatchupAggregate {
  id: string;
  label: string;
  ourArchetype: string;
  enemyArchetype: string;
  games: number;
  wins: number;
  losses: number;
  winrate: number;
  smoothedWinrate: number;
}

export interface TeamCompositionSample {
  id: string;
  gameId: number;
  gameNumber: number;
  sessionName: string;
  playedAt: Date;
  format: Game['format'];
  mode: GameMode;
  team: 1 | 2;
  won: boolean;
  champions: Pick<Champion, 'id' | 'nameKo' | 'imageUrl' | 'aramRole' | 'damageType'>[];
  playerNames: string[];
  archetypeId: string;
  archetypeLabel: string;
  roleSignature: string;
  damageProfileId: string;
  damageProfileLabel: string;
  apShare: number;
  traitSignature: string;
  keyTraits: string[];
}

export interface CompositionInsight {
  title: string;
  body: string;
  tone: 'gold' | 'green' | 'blue' | 'red' | 'purple';
}

export interface CompositionAnalysis {
  modeFilter: CompositionModeFilter;
  completedGames: number;
  teamSamples: number;
  analyzedAt: Date;
  championMeta: Pick<Champion, 'id' | 'nameKo' | 'imageUrl'>[];
  archetypes: CompositionAggregate[];
  damageProfiles: CompositionAggregate[];
  traitProfiles: CompositionAggregate[];
  roleProfiles: CompositionAggregate[];
  championPairs: ChampionComboAggregate[];
  championTrios: ChampionComboAggregate[];
  matchups: CompositionMatchupAggregate[];
  recentGames: Array<{
    gameId: number;
    gameNumber: number;
    sessionName: string;
    playedAt: Date;
    format: Game['format'];
    mode: GameMode;
    winnerTeam: 1 | 2;
    team1: TeamCompositionSample;
    team2: TeamCompositionSample;
  }>;
  insights: CompositionInsight[];
}

type MutableAggregate = CompositionAggregate & { exampleSet: Set<string> };
type MutableComboAggregate = ChampionComboAggregate & { exampleSet: Set<string> };
type MutableMatchupAggregate = CompositionMatchupAggregate;

const ROLE_LABELS: Record<Role, string> = {
  poke: '포크',
  engage: '이니시',
  sustain: '유지',
  dps: 'DPS',
  tank: '탱커',
  utility: '유틸',
};

const ROLE_ORDER: Role[] = ['engage', 'tank', 'poke', 'dps', 'sustain', 'utility'];

const TRAIT_GROUPS: Array<{ id: string; label: string; tags: MechanicTag[] }> = [
  { id: 'cc', label: 'CC', tags: ['aoe_cc', 'knockup', 'pull', 'single_target_cc'] },
  { id: 'poke', label: '견제', tags: ['poke_long', 'poke_mid'] },
  { id: 'protect', label: '보호', tags: ['heal', 'shield', 'speed_buff'] },
  { id: 'antiheal', label: '치감', tags: ['anti_heal'] },
  { id: 'shred', label: '탱파', tags: ['tank_shred'] },
  { id: 'burst', label: '폭딜', tags: ['burst', 'execute'] },
  { id: 'dps', label: '지속딜', tags: ['dps_sustained', 'attack_steroid'] },
  { id: 'dive', label: '진입', tags: ['diving', 'dash_reset', 'stealth'] },
  { id: 'zone', label: '장악', tags: ['zone_control', 'terrain_create'] },
];

function pct(wins: number, games: number) {
  return games > 0 ? (wins / games) * 100 : 0;
}

function smoothWinrate(wins: number, games: number, priorGames = 4) {
  return ((wins + 0.5 * priorGames) / (games + priorGames)) * 100;
}

function addAggregate(
  map: Map<string, MutableAggregate>,
  id: string,
  label: string,
  won: boolean,
  example: string[],
) {
  const row = map.get(id) ?? {
    id,
    label,
    games: 0,
    wins: 0,
    losses: 0,
    winrate: 0,
    smoothedWinrate: 0,
    share: 0,
    examples: [],
    exampleSet: new Set<string>(),
  };
  row.games++;
  if (won) row.wins++;
  else row.losses++;
  const exampleKey = example.join('|');
  if (row.examples.length < 3 && !row.exampleSet.has(exampleKey)) {
    row.examples.push(example);
    row.exampleSet.add(exampleKey);
  }
  map.set(id, row);
}

function finalizeAggregates(map: Map<string, MutableAggregate>, totalSamples: number, minGames = 1): CompositionAggregate[] {
  return [...map.values()]
    .filter((row) => row.games >= minGames)
    .map((row) => ({
      id: row.id,
      label: row.label,
      games: row.games,
      wins: row.wins,
      losses: row.losses,
      examples: row.examples,
      winrate: pct(row.wins, row.games),
      smoothedWinrate: smoothWinrate(row.wins, row.games),
      share: totalSamples > 0 ? (row.games / totalSamples) * 100 : 0,
    }))
    .sort((a, b) => b.smoothedWinrate - a.smoothedWinrate || b.games - a.games);
}

function addComboAggregate(
  map: Map<string, MutableComboAggregate>,
  championIds: string[],
  championNames: string[],
  won: boolean,
) {
  const sorted = championIds
    .map((id, index) => ({ id, name: championNames[index] }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const key = sorted.map((item) => item.id).join('+');
  const row = map.get(key) ?? {
    id: key,
    label: sorted.map((item) => item.name).join(' + '),
    championIds: sorted.map((item) => item.id),
    games: 0,
    wins: 0,
    losses: 0,
    winrate: 0,
    smoothedWinrate: 0,
    share: 0,
    examples: [],
    exampleSet: new Set<string>(),
  };
  row.games++;
  if (won) row.wins++;
  else row.losses++;
  if (row.examples.length < 1 && !row.exampleSet.has(key)) {
    row.examples.push(sorted.map((item) => item.name));
    row.exampleSet.add(key);
  }
  map.set(key, row);
}

function finalizeComboAggregates(map: Map<string, MutableComboAggregate>, totalSamples: number, minGames: number): ChampionComboAggregate[] {
  return [...map.values()]
    .filter((row) => row.games >= minGames)
    .map((row) => ({
      id: row.id,
      label: row.label,
      championIds: row.championIds,
      games: row.games,
      wins: row.wins,
      losses: row.losses,
      examples: row.examples,
      winrate: pct(row.wins, row.games),
      smoothedWinrate: smoothWinrate(row.wins, row.games, 3),
      share: totalSamples > 0 ? (row.games / totalSamples) * 100 : 0,
    }))
    .sort((a, b) => b.smoothedWinrate - a.smoothedWinrate || b.games - a.games);
}

function addMatchupAggregate(
  map: Map<string, MutableMatchupAggregate>,
  sample: TeamCompositionSample,
  opponent: TeamCompositionSample,
) {
  const key = `${sample.archetypeId}>${opponent.archetypeId}`;
  const row = map.get(key) ?? {
    id: key,
    label: `${sample.archetypeLabel} vs ${opponent.archetypeLabel}`,
    ourArchetype: sample.archetypeLabel,
    enemyArchetype: opponent.archetypeLabel,
    games: 0,
    wins: 0,
    losses: 0,
    winrate: 0,
    smoothedWinrate: 0,
  };
  row.games++;
  if (sample.won) row.wins++;
  else row.losses++;
  map.set(key, row);
}

function finalizeMatchups(map: Map<string, MutableMatchupAggregate>): CompositionMatchupAggregate[] {
  return [...map.values()]
    .filter((row) => row.games >= 2)
    .map((row) => ({
      ...row,
      winrate: pct(row.wins, row.games),
      smoothedWinrate: smoothWinrate(row.wins, row.games, 3),
    }))
    .sort((a, b) => b.smoothedWinrate - a.smoothedWinrate || b.games - a.games);
}

function chooseCombinations<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  const walk = (start: number, acc: T[]) => {
    if (acc.length === size) {
      out.push([...acc]);
      return;
    }
    for (let index = start; index < items.length; index++) {
      acc.push(items[index]);
      walk(index + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

function roleSignature(champions: Champion[]) {
  const counts = new Map<Role, number>();
  for (const champion of champions) {
    counts.set(champion.aramRole, (counts.get(champion.aramRole) ?? 0) + 1);
  }
  return ROLE_ORDER
    .filter((role) => counts.has(role))
    .map((role) => `${ROLE_LABELS[role]}${counts.get(role)! > 1 ? counts.get(role) : ''}`)
    .join(' · ');
}

function countTraitGroups(champions: Champion[]) {
  const rawCounts = new Map<MechanicTag, number>();
  for (const champion of champions) {
    const traits = championTraits[champion.id];
    if (!traits) continue;
    for (const tag of traits.mechanics) {
      rawCounts.set(tag, (rawCounts.get(tag) ?? 0) + 1);
    }
  }

  return TRAIT_GROUPS.map((group) => {
    const count = group.tags.reduce((sum, tag) => sum + (rawCounts.get(tag) ?? 0), 0);
    const topTags = group.tags
      .filter((tag) => rawCounts.has(tag))
      .sort((a, b) => (rawCounts.get(b) ?? 0) - (rawCounts.get(a) ?? 0));
    return { ...group, count, topTags };
  }).filter((group) => group.count > 0);
}

function traitSignature(champions: Champion[]) {
  const groups = countTraitGroups(champions)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ko'))
    .slice(0, 3);
  if (groups.length === 0) return { id: 'no-trait', label: '특징 부족', keyTraits: [] };
  return {
    id: groups.map((group) => group.id).sort().join('+'),
    label: groups.map((group) => `${group.label}${group.count > 1 ? group.count : ''}`).join(' · '),
    keyTraits: groups.flatMap((group) => group.topTags.slice(0, 1).map(getTagLabel)),
  };
}

function damageProfile(champions: Champion[]) {
  let ap = 0;
  let ad = 0;
  for (const champion of champions) {
    if (champion.damageType === 'AP') ap++;
    else if (champion.damageType === 'AD') ad++;
    else {
      ap += 0.5;
      ad += 0.5;
    }
  }
  const total = Math.max(ap + ad, 1);
  const apShare = (ap / total) * 100;
  if (apShare >= 72) return { id: 'ap-heavy', label: 'AP 과다', apShare };
  if (apShare <= 28) return { id: 'ad-heavy', label: 'AD 과다', apShare };
  if (apShare >= 42 && apShare <= 58) return { id: 'balanced-damage', label: '딜 밸런스', apShare };
  return { id: apShare > 58 ? 'ap-lean' : 'ad-lean', label: apShare > 58 ? 'AP 기울음' : 'AD 기울음', apShare };
}

function classifyArchetype(champions: Champion[]) {
  const roleCounts = new Map<Role, number>();
  for (const champion of champions) {
    roleCounts.set(champion.aramRole, (roleCounts.get(champion.aramRole) ?? 0) + 1);
  }
  const role = (key: Role) => roleCounts.get(key) ?? 0;
  const traits = countTraitGroups(champions);
  const traitCount = (id: string) => traits.find((trait) => trait.id === id)?.count ?? 0;
  const frontline = role('engage') + role('tank');
  const backline = role('poke') + role('dps');
  const protect = role('sustain') + role('utility') + traitCount('protect');
  const cc = traitCount('cc');

  if (role('poke') >= 2 && frontline <= 1) return { id: 'siege-poke', label: '포킹 압박' };
  if (frontline >= 2 && cc >= 2) return { id: 'hard-engage', label: '강제 이니시' };
  if (role('dps') >= 2 && protect >= 1) return { id: 'carry-protect', label: '캐리 보호' };
  if (protect >= 3) return { id: 'sustain-wall', label: '유지력 벽' };
  if (traitCount('burst') >= 2) return { id: 'burst-pick', label: '폭딜 픽' };
  if (frontline >= 1 && backline >= 2 && protect >= 1) return { id: 'front-back', label: '앞라인+딜러' };
  if (traitCount('dive') >= 2) return { id: 'dive-reset', label: '돌진 리셋' };
  if (traitCount('zone') >= 2) return { id: 'zone-control', label: '구역 장악' };
  return { id: 'balanced', label: '밸런스' };
}

function buildTeamSample(
  game: Game,
  team: 1 | 2,
  sessionName: string,
  picks: GamePick[],
  championsById: Map<string, Champion>,
  playersById: Map<number, Player>,
): TeamCompositionSample | null {
  if (!game.id || (game.winningTeam !== 1 && game.winningTeam !== 2)) return null;
  const teamPicks = picks.filter((pick) => pick.team === team);
  const teamChampions = teamPicks
    .map((pick) => championsById.get(pick.championId))
    .filter((champion): champion is Champion => Boolean(champion));
  if (teamChampions.length < 2) return null;
  const archetype = classifyArchetype(teamChampions);
  const damage = damageProfile(teamChampions);
  const traits = traitSignature(teamChampions);
  return {
    id: `${game.id}:${team}`,
    gameId: game.id,
    gameNumber: game.gameNumber,
    sessionName,
    playedAt: new Date(game.playedAt),
    format: game.format,
    mode: game.mode ?? 'aram',
    team,
    won: game.winningTeam === team,
    champions: teamChampions.map((champion) => ({
      id: champion.id,
      nameKo: champion.nameKo,
      imageUrl: champion.imageUrl,
      aramRole: champion.aramRole,
      damageType: champion.damageType,
    })),
    playerNames: teamPicks.map((pick) => playersById.get(pick.playerId)?.name ?? '알 수 없음'),
    archetypeId: archetype.id,
    archetypeLabel: archetype.label,
    roleSignature: roleSignature(teamChampions),
    damageProfileId: damage.id,
    damageProfileLabel: damage.label,
    apShare: damage.apShare,
    traitSignature: traits.label,
    keyTraits: traits.keyTraits,
  };
}

function makeInsights(analysis: Omit<CompositionAnalysis, 'insights'>): CompositionInsight[] {
  const minGames = Math.max(2, Math.min(4, Math.floor(analysis.teamSamples / 16)));
  const bestArchetype = analysis.archetypes.find((row) => row.games >= minGames);
  const riskyArchetype = [...analysis.archetypes]
    .filter((row) => row.games >= minGames)
    .sort((a, b) => a.smoothedWinrate - b.smoothedWinrate || b.games - a.games)[0];
  const bestPair = analysis.championPairs.find((row) => row.games >= 2);
  const bestMatchup = analysis.matchups.find((row) => row.games >= 2 && row.winrate >= 60);
  const damage = analysis.damageProfiles.find((row) => row.games >= minGames);
  const modeLabel = analysis.modeFilter === 'all' ? '전체 모드' : GAME_MODE_LABELS[analysis.modeFilter];

  const insights: CompositionInsight[] = [];
  if (bestArchetype) {
    insights.push({
      title: `${modeLabel} 핵심 승리 패턴`,
      body: `${bestArchetype.label} 조합이 ${bestArchetype.games}표본에서 ${bestArchetype.winrate.toFixed(1)}% 승률입니다. 최근 밴픽에서는 이 아키타입을 기준점으로 두는 편이 좋습니다.`,
      tone: 'green',
    });
  }
  if (riskyArchetype && riskyArchetype.id !== bestArchetype?.id) {
    insights.push({
      title: '주의할 조합',
      body: `${riskyArchetype.label} 조합은 ${riskyArchetype.games}표본에서 ${riskyArchetype.winrate.toFixed(1)}%입니다. 같은 방향을 택할 때는 데미지 밸런스나 CC 보강이 필요합니다.`,
      tone: 'red',
    });
  }
  if (bestPair) {
    insights.push({
      title: '우선 검토할 챔피언 페어',
      body: `${bestPair.label} 페어가 ${bestPair.games}표본에서 ${bestPair.winrate.toFixed(1)}%입니다. 숙련도 높은 사람이 둘 다 가능하면 우선 조합 후보로 볼 만합니다.`,
      tone: 'gold',
    });
  }
  if (bestMatchup) {
    insights.push({
      title: '상대 조합 대응',
      body: `${bestMatchup.enemyArchetype} 상대로 ${bestMatchup.ourArchetype}가 ${bestMatchup.games}표본 ${bestMatchup.winrate.toFixed(1)}%입니다.`,
      tone: 'purple',
    });
  }
  if (damage) {
    insights.push({
      title: '데미지 분배',
      body: `${damage.label} 프로필이 가장 안정적입니다. 표본 ${damage.games}팀, 승률 ${damage.winrate.toFixed(1)}% 기준입니다.`,
      tone: 'blue',
    });
  }
  return insights;
}

export async function computeCompositionAnalysis(modeFilter: CompositionModeFilter = 'all'): Promise<CompositionAnalysis> {
  const [gamesRaw, picks, champions, players, sessions] = await Promise.all([
    db.games.toArray(),
    db.gamePicks.toArray(),
    db.champions.toArray(),
    db.players.toArray(),
    db.sessions.toArray(),
  ]);
  const games = gamesRaw
    .filter((game) => game.winningTeam === 1 || game.winningTeam === 2)
    .filter((game) => modeFilter === 'all' || (game.mode ?? 'aram') === modeFilter)
    .sort((a, b) => new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime());
  const championsById = new Map(champions.map((champion) => [champion.id, champion]));
  const playersById = new Map(players.map((player) => [player.id!, player]));
  const sessionById = new Map(sessions.map((session) => [session.id!, session]));
  const picksByGameId = new Map<number, GamePick[]>();
  for (const pick of picks) {
    const list = picksByGameId.get(pick.gameId) ?? [];
    list.push(pick);
    picksByGameId.set(pick.gameId, list);
  }

  const samples: TeamCompositionSample[] = [];
  const recentGames: CompositionAnalysis['recentGames'] = [];
  const archetypeMap = new Map<string, MutableAggregate>();
  const damageMap = new Map<string, MutableAggregate>();
  const traitMap = new Map<string, MutableAggregate>();
  const roleMap = new Map<string, MutableAggregate>();
  const pairMap = new Map<string, MutableComboAggregate>();
  const trioMap = new Map<string, MutableComboAggregate>();
  const matchupMap = new Map<string, MutableMatchupAggregate>();

  for (const game of games) {
    if (!game.id || (game.winningTeam !== 1 && game.winningTeam !== 2)) continue;
    const winnerTeam = game.winningTeam as 1 | 2;
    const sessionName = sessionById.get(game.sessionId)?.name ?? `세션 #${game.sessionId}`;
    const gamePicks = picksByGameId.get(game.id) ?? [];
    const team1 = buildTeamSample(game, 1, sessionName, gamePicks, championsById, playersById);
    const team2 = buildTeamSample(game, 2, sessionName, gamePicks, championsById, playersById);
    if (!team1 || !team2) continue;

    for (const sample of [team1, team2]) {
      const names = sample.champions.map((champion) => champion.nameKo);
      samples.push(sample);
      addAggregate(archetypeMap, sample.archetypeId, sample.archetypeLabel, sample.won, names);
      addAggregate(damageMap, sample.damageProfileId, sample.damageProfileLabel, sample.won, names);
      addAggregate(traitMap, sample.traitSignature, sample.traitSignature, sample.won, names);
      addAggregate(roleMap, sample.roleSignature, sample.roleSignature, sample.won, names);

      const championItems = sample.champions.map((champion) => ({ id: champion.id, name: champion.nameKo }));
      for (const combo of chooseCombinations(championItems, 2)) {
        addComboAggregate(pairMap, combo.map((item) => item.id), combo.map((item) => item.name), sample.won);
      }
      for (const combo of chooseCombinations(championItems, 3)) {
        addComboAggregate(trioMap, combo.map((item) => item.id), combo.map((item) => item.name), sample.won);
      }
    }
    addMatchupAggregate(matchupMap, team1, team2);
    addMatchupAggregate(matchupMap, team2, team1);

    if (recentGames.length < 10) {
      recentGames.push({
        gameId: game.id,
        gameNumber: game.gameNumber,
        sessionName,
        playedAt: new Date(game.playedAt),
        format: game.format,
        mode: game.mode ?? 'aram',
        winnerTeam,
        team1,
        team2,
      });
    }
  }

  const totalSamples = samples.length;
  const analysisWithoutInsights = {
    modeFilter,
    completedGames: games.length,
    teamSamples: totalSamples,
    analyzedAt: new Date(),
    championMeta: champions.map((champion) => ({
      id: champion.id,
      nameKo: champion.nameKo,
      imageUrl: champion.imageUrl,
    })),
    archetypes: finalizeAggregates(archetypeMap, totalSamples, 1),
    damageProfiles: finalizeAggregates(damageMap, totalSamples, 1),
    traitProfiles: finalizeAggregates(traitMap, totalSamples, 1),
    roleProfiles: finalizeAggregates(roleMap, totalSamples, 1),
    championPairs: finalizeComboAggregates(pairMap, totalSamples, 2),
    championTrios: finalizeComboAggregates(trioMap, totalSamples, 2),
    matchups: finalizeMatchups(matchupMap),
    recentGames,
  };

  return {
    ...analysisWithoutInsights,
    insights: makeInsights(analysisWithoutInsights),
  };
}
