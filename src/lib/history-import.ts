import { db, getActiveSession, type Champion, type Game, type GameMode, type GameParticipantStat, type GamePick, type Player, type Session } from './db';
import type { LcuRetroGame } from '@/hooks/useLcuBridge';

interface DataDragonChampion {
  id: string;
  key: string;
}

export interface RetroImportResult {
  imported: number;
  updated: number;
  skipped: number;
  sessionId: number | null;
}

type RetroSaveResult = 'created' | 'updated' | 'skipped';

function normalizeName(value: string): string {
  // NFC (not NFKD): NFKD decomposes precomposed Hangul (가-힣) into conjoining
  // jamo, which the [가-힣] class below then strips entirely — collapsing every
  // Korean name to '' and merging all players into one. NFC keeps them intact.
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, '');
}

function inferFormat(totalPlayers: number): '3v3' | '3v4' {
  return totalPlayers >= 7 ? '3v4' : '3v3';
}

function inferWinningTeam(winnerTeamId: number | null): 1 | 2 | null {
  if (winnerTeamId === 100) return 1;
  if (winnerTeamId === 200) return 2;
  return null;
}

function inferMode(game: LcuRetroGame): GameMode {
  const participants = game.participants.filter((participant) => participant.teamId === 100 || participant.teamId === 200);
  if (participants.length >= 7) return 'augmented';
  if (participants.length === 6) return 'aram';
  if (game.mode === 'augmented') return 'augmented';
  const raw = JSON.stringify({
    queueId: game.queueId,
    mapId: game.mapId,
    gameMode: game.gameMode,
    gameType: game.gameType,
    raw: game.raw,
  }).toUpperCase();
  if (
    raw.includes('AUGMENT') ||
    raw.includes('AUGMENTED') ||
    raw.includes('증강') ||
    raw.includes('증바람') ||
    raw.includes('CHERRY') ||
    raw.includes('STRAWBERRY') ||
    game.queueId === 1700 ||
    game.queueId === 1710
  ) {
    return 'augmented';
  }
  return 'aram';
}

async function getOrCreateImportSession(): Promise<Session> {
  const active = await getActiveSession();
  if (active) return active;

  const todayLabel = new Date().toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
  const sessionId = await db.sessions.add({
    name: `${todayLabel} 소급 수집`,
    createdAt: new Date(),
    endedAt: new Date(),
  });
  return (await db.sessions.get(sessionId))!;
}

async function buildChampionKeyMap(champions: Champion[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (champions.length === 0) return map;

  const version = champions[0].patchVersion;
  const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/ko_KR/champion.json`);
  const json = await res.json();
  const rows: Record<string, DataDragonChampion> = json.data ?? {};
  for (const champion of Object.values(rows)) {
    map.set(Number(champion.key), champion.id);
  }
  return map;
}

async function getOrCreatePlayerId(playerMap: Map<string, Player>, displayName: string): Promise<number> {
  const normalized = normalizeName(displayName);
  const existing = playerMap.get(normalized);
  if (existing?.id) return existing.id;

  const id = await db.players.add({ name: displayName, createdAt: new Date() });
  const nextPlayer: Player = { id: id as number, name: displayName, createdAt: new Date() };
  playerMap.set(normalized, nextPlayer);
  return id as number;
}

function getParticipantDisplayName(participant: LcuRetroGame['participants'][number]): string {
  return participant.alias || participant.summonerName || participant.riotId || `participant-${participant.participantId}`;
}

async function saveSingleRetroGame(
  game: LcuRetroGame,
  session: Session,
  nextGameNumber: number,
  players: Map<string, Player>,
  championMap: Map<number, string>,
  existingGame?: Game,
): Promise<RetroSaveResult> {
  const participants = game.participants.filter((participant) => participant.teamId === 100 || participant.teamId === 200);
  if (participants.length === 0) return 'skipped';

  const picks: Array<Omit<GamePick, 'id' | 'gameId'>> = [];
  const participantRows: GameParticipantStat[] = [];
  const gameId = existingGame?.id;
  let savedGameId = gameId;

  for (const participant of participants) {
    const displayName = getParticipantDisplayName(participant);
    const playerId = await getOrCreatePlayerId(players, displayName);
    const championId = championMap.get(Number(participant.championId)) ?? null;
    const team = participant.teamId === 100 ? 1 : 2;
    if (championId) {
      picks.push({ playerId, championId, team });
    }

    const stats = participant.stats || {};
    participantRows.push({
      captureId: 0,
      gameId: 0,
      playerId,
      team,
      summonerName: participant.summonerName || displayName,
      alias: participant.alias,
      riotId: participant.riotId,
      championId,
      kills: Number(stats.kills ?? 0),
      deaths: Number(stats.deaths ?? 0),
      assists: Number(stats.assists ?? 0),
      goldEarned: Number(stats.goldEarned ?? 0),
      totalDamageDealtToChampions: Number(stats.totalDamageDealtToChampions ?? 0),
      physicalDamageDealtToChampions: Number(stats.physicalDamageDealtToChampions ?? 0),
      magicDamageDealtToChampions: Number(stats.magicDamageDealtToChampions ?? 0),
      trueDamageDealtToChampions: Number(stats.trueDamageDealtToChampions ?? 0),
      totalDamageTaken: Number(stats.totalDamageTaken ?? 0),
      physicalDamageTaken: Number(stats.physicalDamageTaken ?? 0),
      magicDamageTaken: Number(stats.magicDamageTaken ?? 0),
      trueDamageTaken: Number(stats.trueDamageTaken ?? 0),
      damageSelfMitigated: Number(stats.damageSelfMitigated ?? 0),
      totalDamageShieldedOnTeammates: Number(stats.totalDamageShieldedOnTeammates ?? 0),
      totalHeal: Number(stats.totalHeal ?? 0),
      totalHealsOnTeammates: Number(stats.totalHealsOnTeammates ?? 0),
      totalTimeSpentDead: Number(stats.totalTimeSpentDead ?? 0),
      timeCCingOthers: Number(stats.timeCCingOthers ?? 0),
    });
  }

  const fingerprint = `history_${game.gameId}`;

  await db.transaction('rw', [db.games, db.gamePicks, db.gameEogCaptures, db.gameParticipantStats], async () => {
    const metadata = {
      sessionId: existingGame?.sessionId ?? session.id!,
      gameNumber: existingGame?.gameNumber ?? nextGameNumber,
      format: inferFormat(participants.length),
      mode: inferMode(game),
      playedAt: new Date(game.gameCreation),
      winningTeam: inferWinningTeam(game.winnerTeamId),
      sourceMatchId: game.gameId,
    };

    if (savedGameId) {
      await db.games.update(savedGameId, metadata);
      const previousCaptures = await db.gameEogCaptures.where('gameId').equals(savedGameId).toArray();
      const previousCaptureIds = previousCaptures.map((capture) => capture.id!).filter(Boolean);
      if (previousCaptureIds.length > 0) {
        await db.gameParticipantStats.where('captureId').anyOf(previousCaptureIds).delete();
      }
      await db.gameParticipantStats.where('gameId').equals(savedGameId).delete();
      await db.gameEogCaptures.where('gameId').equals(savedGameId).delete();
      await db.gamePicks.where('gameId').equals(savedGameId).delete();
    } else {
      savedGameId = (await db.games.add({
        ...metadata,
        notes: '',
      })) as number;
    }

    if (picks.length > 0) {
      await db.gamePicks.bulkAdd(picks.map((pick) => ({ ...pick, gameId: savedGameId as number })));
    }

    const captureId = await db.gameEogCaptures.add({
      gameId: savedGameId as number,
      sessionId: existingGame?.sessionId ?? session.id!,
      source: 'lcu_history',
      status: 'captured',
      capturedAt: new Date(),
      fingerprint,
      rawJson: JSON.stringify(game.raw),
      trigger: existingGame ? 'history-import-override' : 'history-import',
      error: null,
      winnerTeam: inferWinningTeam(game.winnerTeamId),
      participantCount: participants.length,
      mappedParticipants: participantRows.length,
    });

    if (participantRows.length > 0) {
      await db.gameParticipantStats.bulkAdd(
        participantRows.map((row) => ({
          ...row,
          gameId: savedGameId as number,
          captureId: captureId as number,
        })),
      );
    }
  });

  return existingGame ? 'updated' : 'created';
}

function findUnlinkedSessionGameForRetro(
  game: LcuRetroGame,
  sessionGames: Game[],
  picksByGameId: Map<number, GamePick[]>,
  playersById: Map<number, Player>,
  championMap: Map<number, string>,
  claimedGameIds: Set<number>,
): Game | undefined {
  const participants = game.participants.filter((participant) => participant.teamId === 100 || participant.teamId === 200);
  const retroPairs = new Set<string>();
  const retroChampions = new Set<string>();
  for (const participant of participants) {
    const championId = championMap.get(Number(participant.championId));
    if (!championId) continue;
    retroChampions.add(championId);
    retroPairs.add(`${normalizeName(getParticipantDisplayName(participant))}:${championId}`);
  }

  let best: { game: Game; score: number } | null = null;
  const retroTime = game.gameCreation || Date.now();
  const winner = inferWinningTeam(game.winnerTeamId);
  const mode = inferMode(game);

  for (const candidate of sessionGames) {
    if (!candidate.id || candidate.sourceMatchId || claimedGameIds.has(candidate.id)) continue;
    const candidatePicks = picksByGameId.get(candidate.id) ?? [];
    if (candidatePicks.length === 0) continue;

    let exactPairMatches = 0;
    let championMatches = 0;
    for (const pick of candidatePicks) {
      const playerName = playersById.get(pick.playerId)?.name;
      if (playerName && retroPairs.has(`${normalizeName(playerName)}:${pick.championId}`)) {
        exactPairMatches++;
      }
      if (retroChampions.has(pick.championId)) {
        championMatches++;
      }
    }

    const timeDeltaMinutes = Math.abs(new Date(candidate.playedAt).getTime() - retroTime) / 60_000;
    const closeEnough = timeDeltaMinutes <= 180;
    const enoughExactMatches = exactPairMatches >= Math.min(3, candidatePicks.length);
    const enoughChampionMatches = championMatches >= Math.min(4, candidatePicks.length);
    if (!closeEnough || (!enoughExactMatches && !enoughChampionMatches)) continue;

    const score =
      exactPairMatches * 100 +
      championMatches * 25 +
      Math.max(0, 180 - timeDeltaMinutes) +
      ((candidate.winningTeam !== null && candidate.winningTeam === winner) ? 10 : 0) +
      (((candidate.mode ?? 'aram') === mode) ? 5 : 0);

    if (!best || score > best.score) {
      best = { game: candidate, score };
    }
  }

  return best?.game;
}

async function resequenceSessionGames(sessionId: number): Promise<void> {
  const games = await db.games.where('sessionId').equals(sessionId).toArray();
  games.sort((a, b) => {
    const timeDiff = new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.gameNumber - b.gameNumber;
  });

  await db.transaction('rw', [db.games], async () => {
    for (let index = 0; index < games.length; index++) {
      const nextNumber = index + 1;
      if (games[index].gameNumber !== nextNumber) {
        await db.games.update(games[index].id!, { gameNumber: nextNumber });
      }
    }
  });
}

export async function importRetroCustomGames(games: LcuRetroGame[]): Promise<RetroImportResult> {
  const uniqueGames = games
    .filter((game, index, arr) => arr.findIndex((candidate) => candidate.gameId === game.gameId) === index)
    .sort((a, b) => a.gameCreation - b.gameCreation);

  if (uniqueGames.length === 0) {
    return { imported: 0, updated: 0, skipped: 0, sessionId: null };
  }

  const [session, allPlayers, champions] = await Promise.all([
    getOrCreateImportSession(),
    db.players.toArray(),
    db.champions.toArray(),
  ]);

  const championMap = await buildChampionKeyMap(champions);
  const playerMap = new Map(allPlayers.map((player) => [normalizeName(player.name), player]));
  const playersById = new Map(allPlayers.map((player) => [player.id!, player]));
  let sessionGames = await db.games.where('sessionId').equals(session.id!).toArray();
  const sessionGameIds = sessionGames.map((game) => game.id!).filter(Boolean);
  const sessionPicks = sessionGameIds.length > 0
    ? await db.gamePicks.where('gameId').anyOf(sessionGameIds).toArray()
    : [];
  const picksByGameId = new Map<number, GamePick[]>();
  for (const pick of sessionPicks) {
    const list = picksByGameId.get(pick.gameId) ?? [];
    list.push(pick);
    picksByGameId.set(pick.gameId, list);
  }
  let nextGameNumber = sessionGames.reduce((max, game) => Math.max(max, game.gameNumber), 0) + 1;
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const changedSessionIds = new Set<number>();
  const claimedUnlinkedGameIds = new Set<number>();

  for (const game of uniqueGames) {
    const existingByMatchId = await db.games.where('sourceMatchId').equals(game.gameId).first();
    const existingUnlinked = existingByMatchId
      ? undefined
      : findUnlinkedSessionGameForRetro(
        game,
        sessionGames,
        picksByGameId,
        playersById,
        championMap,
        claimedUnlinkedGameIds,
      );
    if (existingUnlinked?.id) {
      claimedUnlinkedGameIds.add(existingUnlinked.id);
    }

    const existing = existingByMatchId ?? existingUnlinked;
    const saved = await saveSingleRetroGame(game, session, nextGameNumber, playerMap, championMap, existing);
    if (saved === 'created') {
      imported++;
      nextGameNumber++;
      changedSessionIds.add(session.id!);
    } else if (saved === 'updated') {
      updated++;
      changedSessionIds.add(existing?.sessionId ?? session.id!);
    } else {
      skipped++;
    }

    sessionGames = await db.games.where('sessionId').equals(session.id!).toArray();
  }

  await Promise.all([...changedSessionIds].map((sessionId) => resequenceSessionGames(sessionId)));

  window.dispatchEvent(new CustomEvent('lol-data-changed', {
    detail: { source: 'retro-import', imported, updated, skipped, sessionId: session.id },
  }));

  return { imported, updated, skipped, sessionId: session.id! };
}
