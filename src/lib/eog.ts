import { db, getActiveSession, type Champion, type Game, type GameEogCapture, type GameParticipantStat, type GamePick, type Player } from './db';

type RawObject = Record<string, unknown>;

const STAT_KEY_MAP = {
  kills: ['kills'],
  deaths: ['deaths', 'numdeaths'],
  assists: ['assists'],
  goldEarned: ['goldearned', 'gold'],
  totalDamageDealtToChampions: ['totaldamagedealttochampions', 'damagedealttochampions', 'championdamagedealt'],
  physicalDamageDealtToChampions: ['physicaldamagedealttochampions'],
  magicDamageDealtToChampions: ['magicdamagedealttochampions', 'spelldamagedealttochampions'],
  trueDamageDealtToChampions: ['truedamagedealttochampions'],
  totalDamageTaken: ['totaldamagetaken', 'damagetaken'],
  physicalDamageTaken: ['physicaldamagetaken'],
  magicDamageTaken: ['magicdamagetaken'],
  trueDamageTaken: ['truedamagetaken'],
  damageSelfMitigated: ['damageselfmitigated', 'selfmitigateddamage'],
  totalDamageShieldedOnTeammates: ['totaldamageshieldedonteammates', 'damageshieldedonteammates'],
  totalHeal: ['totalheal', 'healtotal'],
  totalHealsOnTeammates: ['totalhealsonteammates', 'healsonteammates'],
  totalTimeSpentDead: ['totaltimespentdead', 'timespentdead'],
  timeCCingOthers: ['timeccingothers', 'totaltimespentccingothers'],
} satisfies Record<keyof Pick<GameParticipantStat,
  'kills'
  | 'deaths'
  | 'assists'
  | 'goldEarned'
  | 'totalDamageDealtToChampions'
  | 'physicalDamageDealtToChampions'
  | 'magicDamageDealtToChampions'
  | 'trueDamageDealtToChampions'
  | 'totalDamageTaken'
  | 'physicalDamageTaken'
  | 'magicDamageTaken'
  | 'trueDamageTaken'
  | 'damageSelfMitigated'
  | 'totalDamageShieldedOnTeammates'
  | 'totalHeal'
  | 'totalHealsOnTeammates'
  | 'totalTimeSpentDead'
  | 'timeCCingOthers'
>, string[]>;

const PLAYER_ARRAY_KEYS = ['players', 'participants', 'playerstats', 'playerStats', 'members', 'statistics'];

export interface ParsedEogParticipant {
  team: 1 | 2 | 0;
  win: boolean | null;
  summonerName: string;
  riotId: string | null;
  championRaw: string | number | null;
  championName: string | null;
  stats: Pick<GameParticipantStat,
    'kills'
    | 'deaths'
    | 'assists'
    | 'goldEarned'
    | 'totalDamageDealtToChampions'
    | 'physicalDamageDealtToChampions'
    | 'magicDamageDealtToChampions'
    | 'trueDamageDealtToChampions'
    | 'totalDamageTaken'
    | 'physicalDamageTaken'
    | 'magicDamageTaken'
    | 'trueDamageTaken'
    | 'damageSelfMitigated'
    | 'totalDamageShieldedOnTeammates'
    | 'totalHeal'
    | 'totalHealsOnTeammates'
    | 'totalTimeSpentDead'
    | 'timeCCingOthers'
  >;
}

export interface ParsedEogCapture {
  fingerprint: string;
  participants: ParsedEogParticipant[];
  winnerTeam: 1 | 2 | null;
}

export interface PersistedEogResult {
  capture: GameEogCapture;
  participantStats: GameParticipantStat[];
  linkedGame: Game | null;
}

function normalizeText(value: string): string {
  // NFC, not NFKD — NFKD decomposes Hangul into jamo which the [가-힣] class
  // then strips, collapsing every Korean name to '' (player merge bug).
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, '');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as RawObject).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(',')}}`;
}

function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return `eog_${(hash >>> 0).toString(16)}`;
}

function buildFingerprint(raw: unknown): string {
  return hashString(stableStringify(raw));
}

function isObject(value: unknown): value is RawObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function flattenObject(value: unknown, prefix = '', out = new Map<string, unknown[]>()) {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenObject(item, prefix ? `${prefix}.${index}` : String(index), out));
    return out;
  }
  if (!isObject(value)) {
    const normalized = normalizeText(prefix);
    if (normalized) out.set(normalized, [...(out.get(normalized) ?? []), value]);
    const lastKey = normalizeText(prefix.split('.').at(-1) ?? '');
    if (lastKey) out.set(lastKey, [...(out.get(lastKey) ?? []), value]);
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    flattenObject(child, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

function getFirstString(flat: Map<string, unknown[]>, candidates: string[]): string | null {
  for (const candidate of candidates) {
    const values = flat.get(normalizeText(candidate));
    const found = values?.find((value) => typeof value === 'string' && value.trim().length > 0);
    if (typeof found === 'string') return found.trim();
  }
  return null;
}

function getFirstNumber(flat: Map<string, unknown[]>, candidates: string[]): number {
  for (const candidate of candidates) {
    const values = flat.get(normalizeText(candidate));
    const found = values?.find((value) => typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))));
    if (typeof found === 'number') return found;
    if (typeof found === 'string') return Number(found);
  }
  return 0;
}

function getFirstBoolean(flat: Map<string, unknown[]>, candidates: string[]): boolean | null {
  for (const candidate of candidates) {
    const values = flat.get(normalizeText(candidate));
    const found = values?.find((value) => typeof value === 'boolean' || value === 'Win' || value === 'Loss');
    if (typeof found === 'boolean') return found;
    if (found === 'Win') return true;
    if (found === 'Loss') return false;
  }
  return null;
}

function normalizeTeam(value: unknown): 1 | 2 | 0 {
  if (value === 100 || value === 1 || value === '100' || value === '1') return 1;
  if (value === 200 || value === 2 || value === '200' || value === '2') return 2;
  if (typeof value === 'string') {
    const normalized = normalizeText(value);
    if (['order', 'blue', 'team1', 'ally'].includes(normalized)) return 1;
    if (['chaos', 'red', 'team2', 'enemy'].includes(normalized)) return 2;
  }
  return 0;
}

function scoreParticipantObject(raw: RawObject): number {
  const flat = flattenObject(raw);
  let score = 0;
  if (getFirstString(flat, ['summonerName', 'gameName', 'riotIdGameName', 'riotId', 'playerName', 'name'])) score += 2;
  if (getFirstNumber(flat, ['kills'])) score += 1;
  if (getFirstNumber(flat, ['deaths'])) score += 1;
  if (getFirstNumber(flat, ['assists'])) score += 1;
  if (getFirstNumber(flat, ['championId', 'championName'])) score += 1;
  if (normalizeTeam(getFirstString(flat, ['team']) ?? getFirstNumber(flat, ['teamId', 'team']))) score += 1;
  return score;
}

function extractTeamArrays(node: unknown, inheritedTeam: 1 | 2 | 0 = 0, collector: Array<Array<{ raw: RawObject; team: 1 | 2 | 0 }>> = []) {
  if (Array.isArray(node)) {
    const objectItems = node.filter(isObject);
    if (objectItems.length === node.length && objectItems.length > 0) {
      const directScore = objectItems.reduce((sum, item) => sum + scoreParticipantObject(item), 0);
      if (directScore >= objectItems.length * 2) {
        collector.push(objectItems.map((item) => ({ raw: item, team: inferTeam(item, inheritedTeam) })));
      }

      const flattened: Array<{ raw: RawObject; team: 1 | 2 | 0 }> = [];
      objectItems.forEach((item, index) => {
        const team = inferTeam(item, normalizeTeam((index === 0 ? 1 : 2)) || inheritedTeam);
        for (const key of PLAYER_ARRAY_KEYS) {
          const nested = item[key];
          if (Array.isArray(nested) && nested.every(isObject)) {
            nested.forEach((entry) => flattened.push({ raw: entry, team: inferTeam(entry, team) || team }));
          }
        }
      });
      if (flattened.length >= 2) collector.push(flattened);
    }
    node.forEach((item) => extractTeamArrays(item, inheritedTeam, collector));
    return collector;
  }

  if (!isObject(node)) return collector;

  const nextInherited = inferTeam(node, inheritedTeam) || inheritedTeam;
  for (const value of Object.values(node)) {
    extractTeamArrays(value, nextInherited, collector);
  }
  return collector;
}

function inferTeam(raw: RawObject, fallback: 1 | 2 | 0 = 0): 1 | 2 | 0 {
  const flat = flattenObject(raw);
  const textTeam = getFirstString(flat, ['team', 'teamColor', 'teamSide']);
  const numericTeam = getFirstNumber(flat, ['teamId', 'team', 'teamNumber']);
  return normalizeTeam(textTeam ?? numericTeam) || fallback;
}

function extractParticipants(raw: unknown): ParsedEogParticipant[] {
  const candidates = extractTeamArrays(raw);
  if (candidates.length === 0) return [];

  const best = candidates.sort((a, b) => {
    const aScore = a.reduce((sum, entry) => sum + scoreParticipantObject(entry.raw), 0);
    const bScore = b.reduce((sum, entry) => sum + scoreParticipantObject(entry.raw), 0);
    return bScore - aScore || b.length - a.length;
  })[0];

  return best.map(({ raw: participant, team }) => {
    const flat = flattenObject(participant);
    const championIdValue = getFirstString(flat, ['championName', 'champion']) ?? getFirstNumber(flat, ['championId']);
    const championName = getFirstString(flat, ['championName', 'championDisplayName', 'character']) ?? null;
    const win = getFirstBoolean(flat, ['win', 'won', 'isWinner', 'victory']) ?? null;

    const stats = Object.fromEntries(
      Object.entries(STAT_KEY_MAP).map(([statName, candidates]) => [statName, getFirstNumber(flat, candidates)])
    ) as ParsedEogParticipant['stats'];

    return {
      team,
      win,
      summonerName: getFirstString(flat, ['summonerName', 'gameName', 'riotIdGameName', 'playerName', 'name']) ?? '',
      riotId: getFirstString(flat, ['riotId', 'riotIdTagline', 'fullRiotId']),
      championRaw: championIdValue ?? null,
      championName,
      stats,
    };
  }).filter((participant) => participant.summonerName || participant.riotId || participant.championRaw !== null);
}

function extractWinnerTeam(raw: unknown, participants: ParsedEogParticipant[]): 1 | 2 | null {
  const flat = flattenObject(raw);
  const topLevelWinner = normalizeTeam(
    getFirstString(flat, ['winningTeam', 'winnerTeam', 'winner', 'winnerTeamId']) ??
    getFirstNumber(flat, ['winningTeam', 'winnerTeam', 'winnerTeamId'])
  );
  if (topLevelWinner) return topLevelWinner;

  const teamWins = new Map<number, number>();
  participants.forEach((participant) => {
    if (participant.team && participant.win !== null) {
      const current = teamWins.get(participant.team) ?? 0;
      teamWins.set(participant.team, current + (participant.win ? 1 : -1));
    }
  });

  if ((teamWins.get(1) ?? 0) > 0) return 1;
  if ((teamWins.get(2) ?? 0) > 0) return 2;
  return null;
}

export function parseEogPayload(raw: unknown): ParsedEogCapture {
  const participants = extractParticipants(raw);
  return {
    fingerprint: buildFingerprint(raw),
    participants,
    winnerTeam: extractWinnerTeam(raw, participants),
  };
}

function resolveChampionId(rawChampion: string | number | null, championName: string | null, champions: Champion[]): string | null {
  if (!rawChampion && !championName) return null;
  const map = new Map<string, Champion>();
  for (const champion of champions) {
    map.set(normalizeText(champion.id), champion);
    map.set(normalizeText(champion.nameKo), champion);
  }

  const candidates = [rawChampion, championName]
    .filter((value): value is string | number => value !== null && value !== undefined)
    .map((value) => normalizeText(String(value)));

  for (const key of candidates) {
    const champion = map.get(key);
    if (champion) return champion.id;
  }
  return null;
}

function buildPlayerLookup(players: Player[]) {
  const byNormalizedName = new Map<string, Player>();
  players.forEach((player) => {
    byNormalizedName.set(normalizeText(player.name), player);
  });
  return byNormalizedName;
}

function buildPickLookup(picks: GamePick[]) {
  const byPlayerId = new Map<number, GamePick>();
  const byTeam = new Map<1 | 2, GamePick[]>();
  picks.forEach((pick) => {
    byPlayerId.set(pick.playerId, pick);
    const list = byTeam.get(pick.team) ?? [];
    list.push(pick);
    byTeam.set(pick.team, list);
  });
  return { byPlayerId, byTeam };
}

function matchParticipantsToGame(
  participants: ParsedEogParticipant[],
  players: Player[],
  champions: Champion[],
  picks: GamePick[],
) {
  const playerLookup = buildPlayerLookup(players);
  const pickLookup = buildPickLookup(picks);
  const unmatchedPickIds = new Set(picks.map((pick) => pick.playerId));

  const matched = participants.map((participant) => {
    const normalizedNameCandidates = [participant.summonerName, participant.riotId ?? '']
      .map((value) => normalizeText(value))
      .filter(Boolean);

    let matchedPlayer: Player | undefined;
    for (const candidate of normalizedNameCandidates) {
      const direct = playerLookup.get(candidate);
      if (direct) {
        matchedPlayer = direct;
        break;
      }
    }

    const matchedPick = matchedPlayer ? pickLookup.byPlayerId.get(matchedPlayer.id!) : undefined;
    if (matchedPick) unmatchedPickIds.delete(matchedPick.playerId);

    return {
      participant,
      matchedPlayer,
      matchedPick,
      championId: matchedPick?.championId ?? resolveChampionId(participant.championRaw, participant.championName, champions),
    };
  });

  for (const team of [1, 2] as const) {
    const unmatchedParticipants = matched.filter((entry) => !entry.matchedPick && entry.participant.team === team);
    const unmatchedPicks = (pickLookup.byTeam.get(team) ?? []).filter((pick) => unmatchedPickIds.has(pick.playerId));
    unmatchedParticipants.forEach((entry, index) => {
      const fallbackPick = unmatchedPicks[index];
      if (!fallbackPick) return;
      entry.matchedPick = fallbackPick;
      entry.matchedPlayer = players.find((player) => player.id === fallbackPick.playerId);
      entry.championId = entry.championId ?? fallbackPick.championId;
      unmatchedPickIds.delete(fallbackPick.playerId);
    });
  }

  return matched;
}

export async function persistEogCapture(raw: unknown, options?: { capturedAt?: string | Date; fingerprint?: string; trigger?: string }): Promise<PersistedEogResult> {
  const parsed = parseEogPayload(raw);
  const fingerprint = options?.fingerprint ?? parsed.fingerprint;
  const capturedAt = options?.capturedAt ? new Date(options.capturedAt) : new Date();

  const existing = await db.gameEogCaptures.where('fingerprint').equals(fingerprint).first();
  if (existing) {
    const participantStats = existing.id
      ? await db.gameParticipantStats.where('captureId').equals(existing.id).toArray()
      : [];
    const linkedGame = existing.gameId ? await db.games.get(existing.gameId) ?? null : null;
    return { capture: existing, participantStats, linkedGame };
  }

  const [session, players, champions] = await Promise.all([
    getActiveSession(),
    db.players.toArray(),
    db.champions.toArray(),
  ]);

  let linkedGame: Game | null = null;
  let picks: GamePick[] = [];
  if (session) {
    const sessionGames = await db.games.where('sessionId').equals(session.id!).toArray();
    sessionGames.sort((a, b) => b.gameNumber - a.gameNumber);
    linkedGame = sessionGames.find((game) => game.winningTeam === null) ?? sessionGames[0] ?? null;
    if (linkedGame) {
      picks = await db.gamePicks.where('gameId').equals(linkedGame.id!).toArray();
    }
  }

  const matched = matchParticipantsToGame(parsed.participants, players, champions, picks);
  const captureStatus: GameEogCapture['status'] = linkedGame
    ? 'captured'
    : parsed.participants.length > 0 ? 'unlinked' : 'failed';

  const transactionResult = await db.transaction('rw', [db.games, db.gameEogCaptures, db.gameParticipantStats], async () => {
    if (linkedGame?.id) {
      const previousCaptures = await db.gameEogCaptures.where('gameId').equals(linkedGame.id).toArray();
      const previousIds = previousCaptures.map((capture) => capture.id!).filter(Boolean);
      if (previousIds.length > 0) {
        await db.gameParticipantStats.where('captureId').anyOf(previousIds).delete();
        await db.gameEogCaptures.where('gameId').equals(linkedGame.id).delete();
      }
    }

    const captureId = await db.gameEogCaptures.add({
      gameId: linkedGame?.id ?? null,
      sessionId: session?.id ?? null,
      source: 'lcu_eog',
      status: captureStatus,
      capturedAt,
      fingerprint,
      rawJson: JSON.stringify(raw),
      trigger: options?.trigger,
      error: parsed.participants.length > 0 ? null : 'No participants parsed from EOG payload',
      winnerTeam: parsed.winnerTeam,
      participantCount: parsed.participants.length,
      mappedParticipants: matched.filter((entry) => !!entry.matchedPlayer).length,
    });

    const participantRows: GameParticipantStat[] = matched.map(({ participant, matchedPlayer, championId, matchedPick }) => ({
      captureId: captureId as number,
      gameId: linkedGame?.id ?? null,
      playerId: matchedPlayer?.id ?? null,
      team: participant.team || matchedPick?.team || 0,
      summonerName: participant.summonerName || matchedPlayer?.name || '',
      alias: matchedPlayer?.name ?? null,
      riotId: participant.riotId,
      championId,
      ...participant.stats,
    }));

    if (participantRows.length > 0) {
      await db.gameParticipantStats.bulkAdd(participantRows);
    }

    if (linkedGame?.id && parsed.winnerTeam && linkedGame.winningTeam !== parsed.winnerTeam) {
      await db.games.update(linkedGame.id, { winningTeam: parsed.winnerTeam });
      linkedGame = { ...linkedGame, winningTeam: parsed.winnerTeam };
    }

    return {
      capture: await db.gameEogCaptures.get(captureId as number),
      participantStats: captureId ? await db.gameParticipantStats.where('captureId').equals(captureId as number).toArray() : [],
    };
  });

  return {
    capture: transactionResult.capture!,
    participantStats: transactionResult.participantStats,
    linkedGame,
  };
}
