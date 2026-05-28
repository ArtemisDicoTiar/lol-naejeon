import { db, type GameMode, type Player } from './db';
import type { GameParticipantStat } from './db';
import { computeFullStats } from './stats';

export interface PlayerProfileChampionEntry {
  championId: string;
  championNameKo: string;
  championImageUrl: string;
  games: number;
  wins: number;
  losses: number;
  winrate: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgDamageDealtToChampions: number;
  avgDamageTaken: number;
  avgGoldEarned: number;
}

export interface PlayerProfileRoleEntry {
  role: string;
  label: string;
  games: number;
  wins: number;
  winrate: number;
}

export interface PlayerProfileRecentMatchEntry {
  gameId: number;
  gameNumber: number;
  playedAt: Date;
  mode: GameMode;
  format: '3v3' | '3v4';
  result: 'W' | 'L' | '미입력';
  championId: string;
  championNameKo: string;
  championImageUrl: string;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  totalDamageDealtToChampions: number | null;
  totalDamageTaken: number | null;
  totalHeal: number | null;
  totalDamageShieldedOnTeammates: number | null;
  timeCCingOthers: number | null;
  goldEarned: number | null;
}

export interface PlayerProfileStats {
  player: Player;
  totalGames: number;
  wins: number;
  losses: number;
  winrate: number;
  recentWins: number;
  recentLosses: number;
  recentGames: number;
  recentWinrate: number;
  trendDelta: number;
  streakType: 'W' | 'L' | null;
  streakCount: number;
  uniqueChampions: number;
  eogGames: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgDamageDealtToChampions: number;
  avgDamageTaken: number;
  avgFrontlineContribution: number;
  avgTotalHeal: number;
  avgTotalShielded: number;
  avgTimeCCingOthers: number;
  avgTimeSpentDead: number;
  avgKdaParticipation: number;
  avgGoldEfficiency: number;
  overallCombatAverages: {
    damage: number;
    frontline: number;
    heal: number;
    cc: number;
    kda: number;
    goldEfficiency: number;
  };
  topChampions: PlayerProfileChampionEntry[];
  roleStats: PlayerProfileRoleEntry[];
  recentMatches: PlayerProfileRecentMatchEntry[];
}

const RECENT_MATCH_LIMIT = 12;

function average(total: number, count: number) {
  return count > 0 ? total / count : 0;
}

function avgOfRows(rows: GameParticipantStat[], selector: (row: GameParticipantStat) => number) {
  return rows.length > 0 ? rows.reduce((sum, row) => sum + selector(row), 0) / rows.length : 0;
}

export async function computePlayerProfile(playerId: number, modeFilter?: GameMode): Promise<PlayerProfileStats | null> {
  const [fullStats, players, gamesRaw, picksRaw, participantStatsRaw] = await Promise.all([
    computeFullStats(modeFilter),
    db.players.toArray(),
    db.games.toArray(),
    db.gamePicks.toArray(),
    db.gameParticipantStats.toArray(),
  ]);

  const player = players.find((entry) => entry.id === playerId);
  if (!player) return null;

  const games = modeFilter
    ? gamesRaw.filter((game) => (game.mode ?? 'aram') === modeFilter)
    : gamesRaw;
  const gameMap = new Map(games.map((game) => [game.id!, game]));
  const playerPicks = picksRaw.filter((pick) => pick.playerId === playerId && gameMap.has(pick.gameId));
  const playerRows = participantStatsRaw.filter((row) => row.playerId === playerId && row.gameId && gameMap.has(row.gameId));
  const participantByGameId = new Map(playerRows.map((row) => [row.gameId!, row]));
  const championMap = new Map(fullStats.champions.map((champion) => [champion.id, champion]));

  const overall = fullStats.wrStats.playerOverallStats[playerId];
  const trend = fullStats.playerTrend[playerId];
  const streak = fullStats.playerStreak[playerId];
  const pool = fullStats.playerChampionPool[playerId];
  const eogSummary = fullStats.playerEogSummary.find((entry) => entry.playerId === playerId);

  const championMapStats = new Map<string, {
    games: number;
    wins: number;
    losses: number;
    kills: number;
    deaths: number;
    assists: number;
    damage: number;
    taken: number;
    gold: number;
    eogGames: number;
  }>();

  for (const pick of playerPicks) {
    const game = gameMap.get(pick.gameId);
    if (!game) continue;
    const stats = championMapStats.get(pick.championId) ?? {
      games: 0,
      wins: 0,
      losses: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      damage: 0,
      taken: 0,
      gold: 0,
      eogGames: 0,
    };
    stats.games++;
    if (game.winningTeam !== null) {
      if (pick.team === game.winningTeam) stats.wins++;
      else stats.losses++;
    }
    const row = participantByGameId.get(game.id!);
    if (row) {
      stats.kills += row.kills;
      stats.deaths += row.deaths;
      stats.assists += row.assists;
      stats.damage += row.totalDamageDealtToChampions;
      stats.taken += row.totalDamageTaken;
      stats.gold += row.goldEarned;
      stats.eogGames++;
    }
    championMapStats.set(pick.championId, stats);
  }

  const topChampions = [...championMapStats.entries()]
    .map(([championId, entry]) => {
      const champion = championMap.get(championId);
      return {
        championId,
        championNameKo: champion?.nameKo ?? championId,
        championImageUrl: champion?.imageUrl ?? '',
        games: entry.games,
        wins: entry.wins,
        losses: entry.losses,
        winrate: average(entry.wins * 100, Math.max(entry.wins + entry.losses, 1)),
        avgKills: average(entry.kills, entry.eogGames),
        avgDeaths: average(entry.deaths, entry.eogGames),
        avgAssists: average(entry.assists, entry.eogGames),
        avgDamageDealtToChampions: average(entry.damage, entry.eogGames),
        avgDamageTaken: average(entry.taken, entry.eogGames),
        avgGoldEarned: average(entry.gold, entry.eogGames),
      };
    })
    .sort((a, b) => {
      if (b.games !== a.games) return b.games - a.games;
      if (b.winrate !== a.winrate) return b.winrate - a.winrate;
      return b.avgDamageDealtToChampions - a.avgDamageDealtToChampions;
    });

  const roleStats = (fullStats.roleRadarData[playerId] ?? [])
    .filter((entry) => entry.picks > 0)
    .map((entry) => ({
      role: entry.role,
      label: entry.axis,
      games: entry.picks,
      wins: entry.wins,
      winrate: entry.value,
    }))
    .sort((a, b) => b.games - a.games);

  const recentMatches = [...playerPicks]
    .sort((a, b) => {
      const gameA = gameMap.get(a.gameId);
      const gameB = gameMap.get(b.gameId);
      return new Date(gameB?.playedAt ?? 0).getTime() - new Date(gameA?.playedAt ?? 0).getTime();
    })
    .slice(0, RECENT_MATCH_LIMIT)
    .map((pick) => {
      const game = gameMap.get(pick.gameId)!;
      const champion = championMap.get(pick.championId);
      const row = participantByGameId.get(game.id!);
      const result: PlayerProfileRecentMatchEntry['result'] = game.winningTeam === null
        ? '미입력'
        : (pick.team === game.winningTeam ? 'W' : 'L');
      return {
        gameId: game.id!,
        gameNumber: game.gameNumber,
        playedAt: new Date(game.playedAt),
        mode: game.mode ?? 'aram',
        format: game.format,
        result,
        championId: pick.championId,
        championNameKo: champion?.nameKo ?? pick.championId,
        championImageUrl: champion?.imageUrl ?? '',
        kills: row?.kills ?? null,
        deaths: row?.deaths ?? null,
        assists: row?.assists ?? null,
        totalDamageDealtToChampions: row?.totalDamageDealtToChampions ?? null,
        totalDamageTaken: row?.totalDamageTaken ?? null,
        totalHeal: row?.totalHeal ?? null,
        totalDamageShieldedOnTeammates: row?.totalDamageShieldedOnTeammates ?? null,
        timeCCingOthers: row?.timeCCingOthers ?? null,
        goldEarned: row?.goldEarned ?? null,
      };
    });

  const totals = playerRows.reduce((acc, row) => ({
    kills: acc.kills + row.kills,
    deaths: acc.deaths + row.deaths,
    assists: acc.assists + row.assists,
    damage: acc.damage + row.totalDamageDealtToChampions,
    taken: acc.taken + row.totalDamageTaken,
    frontline: acc.frontline + row.totalDamageTaken + row.damageSelfMitigated,
  }), { kills: 0, deaths: 0, assists: 0, damage: 0, taken: 0, frontline: 0 });

  return {
    player,
    totalGames: overall?.totalPicks ?? playerPicks.length,
    wins: overall?.wins ?? 0,
    losses: overall?.losses ?? 0,
    winrate: overall?.winrate ?? 0,
    recentWins: trend?.recentWins ?? 0,
    recentLosses: trend?.recentLosses ?? 0,
    recentGames: trend?.recentGames ?? 0,
    recentWinrate: trend?.recentWinrate ?? 0,
    trendDelta: trend?.delta ?? 0,
    streakType: streak?.type ?? null,
    streakCount: streak?.count ?? 0,
    uniqueChampions: pool?.uniqueCount ?? 0,
    eogGames: eogSummary?.games ?? playerRows.length,
    avgKills: average(totals.kills, playerRows.length),
    avgDeaths: average(totals.deaths, playerRows.length),
    avgAssists: average(totals.assists, playerRows.length),
    avgDamageDealtToChampions: eogSummary?.avgDamageDealtToChampions ?? average(totals.damage, playerRows.length),
    avgDamageTaken: eogSummary?.avgDamageTaken ?? average(totals.taken, playerRows.length),
    avgFrontlineContribution: eogSummary?.avgFrontlineContribution ?? average(totals.frontline, playerRows.length),
    avgTotalHeal: eogSummary?.avgTotalHeal ?? 0,
    avgTotalShielded: eogSummary?.avgTotalShielded ?? 0,
    avgTimeCCingOthers: eogSummary?.avgTimeCCingOthers ?? 0,
    avgTimeSpentDead: eogSummary?.avgTimeSpentDead ?? 0,
    avgKdaParticipation: eogSummary?.avgKdaParticipation ?? avgOfRows(playerRows, (row) => (row.kills + row.assists) / Math.max(row.deaths, 1)),
    avgGoldEfficiency: eogSummary?.avgGoldEfficiency ?? avgOfRows(playerRows, (row) => row.totalDamageDealtToChampions / Math.max(row.goldEarned, 1)),
    overallCombatAverages: {
      damage: fullStats.eogOverview.avgDamageDealtToChampions,
      frontline: fullStats.eogOverview.avgFrontlineContribution,
      heal: fullStats.eogOverview.avgTotalHeal,
      cc: fullStats.eogOverview.avgTimeCCingOthers,
      kda: fullStats.eogOverview.avgKdaParticipation,
      goldEfficiency: fullStats.eogOverview.avgGoldEfficiency,
    },
    topChampions,
    roleStats,
    recentMatches,
  };
}
