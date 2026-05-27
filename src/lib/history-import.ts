import { db, getActiveSession, type Champion, type GameMode, type GameParticipantStat, type GamePick, type Player, type Session } from './db';
import type { LcuRetroGame } from '@/hooks/useLcuBridge';

interface DataDragonChampion {
  id: string;
  key: string;
}

export interface RetroImportResult {
  imported: number;
  skipped: number;
  sessionId: number | null;
}

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

function inferMode(): GameMode {
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

async function importSingleRetroGame(
  game: LcuRetroGame,
  session: Session,
  nextGameNumber: number,
  players: Map<string, Player>,
  championMap: Map<number, string>,
): Promise<boolean> {
  const existing = await db.games.where('sourceMatchId').equals(game.gameId).first();
  if (existing) return false;

  const participants = game.participants.filter((participant) => participant.teamId === 100 || participant.teamId === 200);
  if (participants.length === 0) return false;

  const picks: Array<Omit<GamePick, 'id' | 'gameId'>> = [];
  const participantRows: GameParticipantStat[] = [];

  const gameId = await db.games.add({
    sessionId: session.id!,
    gameNumber: nextGameNumber,
    format: inferFormat(participants.length),
    mode: inferMode(),
    playedAt: new Date(game.gameCreation),
    winningTeam: inferWinningTeam(game.winnerTeamId),
    notes: '',
    sourceMatchId: game.gameId,
  });

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
      gameId: gameId as number,
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

  if (picks.length > 0) {
    await db.gamePicks.bulkAdd(picks.map((pick) => ({ ...pick, gameId: gameId as number })));
  }

  const fingerprint = `history_${game.gameId}`;
  const captureId = await db.gameEogCaptures.add({
    gameId: gameId as number,
    sessionId: session.id!,
    source: 'lcu_history',
    status: 'captured',
    capturedAt: new Date(),
    fingerprint,
    rawJson: JSON.stringify(game.raw),
    trigger: 'history-import',
    error: null,
    winnerTeam: inferWinningTeam(game.winnerTeamId),
    participantCount: participants.length,
    mappedParticipants: participantRows.length,
  });

  if (participantRows.length > 0) {
    await db.gameParticipantStats.bulkAdd(
      participantRows.map((row) => ({ ...row, captureId: captureId as number })),
    );
  }

  return true;
}

export async function importRetroCustomGames(games: LcuRetroGame[]): Promise<RetroImportResult> {
  const uniqueGames = games
    .filter((game, index, arr) => arr.findIndex((candidate) => candidate.gameId === game.gameId) === index)
    .sort((a, b) => a.gameCreation - b.gameCreation);

  if (uniqueGames.length === 0) {
    return { imported: 0, skipped: 0, sessionId: null };
  }

  const [session, allPlayers, champions] = await Promise.all([
    getOrCreateImportSession(),
    db.players.toArray(),
    db.champions.toArray(),
  ]);

  const championMap = await buildChampionKeyMap(champions);
  const playerMap = new Map(allPlayers.map((player) => [normalizeName(player.name), player]));
  const existingGames = await db.games.where('sessionId').equals(session.id!).toArray();
  let nextGameNumber = existingGames.reduce((max, game) => Math.max(max, game.gameNumber), 0) + 1;
  let imported = 0;
  let skipped = 0;

  for (const game of uniqueGames) {
    const exists = await db.games.where('sourceMatchId').equals(game.gameId).first();
    if (exists) {
      skipped++;
      continue;
    }
    const saved = await importSingleRetroGame(game, session, nextGameNumber, playerMap, championMap);
    if (saved) {
      imported++;
      nextGameNumber++;
    } else {
      skipped++;
    }
  }

  window.dispatchEvent(new CustomEvent('lol-data-changed', {
    detail: { source: 'retro-import', imported, sessionId: session.id },
  }));

  return { imported, skipped, sessionId: session.id! };
}
