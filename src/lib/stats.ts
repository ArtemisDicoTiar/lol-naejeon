import { db, type Champion, type Game, type GameMode, type GameParticipantStat, type GamePick, type Player, getActiveSession } from './db';
import type { WinrateStats } from './recommendation/winrate';
import { computeStatsFromData } from './recommendation/winrate-pure';
import { aramChampionMeta } from '@/data/aram-champion-meta';
import { resolveParticipantStatsToPicks } from './participant-stats';

// Local-time YYYY-MM-DD bucket key for grouping a player's games into days.
function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// Day-based streak: each day a player has games becomes a W/L/tie based on
// that day's net record. Tie days (wins === losses) act as "maintain" — they
// don't break or extend the running streak. Walk days from most recent.
export function computePlayerStreaksFromData(
  playerIds: number[],
  games: Game[],
  picks: GamePick[],
): Record<number, PlayerStreakEntry> {
  const completed = games.filter((g) => g.winningTeam !== null && g.id !== undefined);
  const pickByGameAndPlayer = new Map<string, GamePick>();
  for (const pick of picks) {
    pickByGameAndPlayer.set(`${pick.gameId}:${pick.playerId}`, pick);
  }
  const out: Record<number, PlayerStreakEntry> = {};
  for (const pid of playerIds) {
    const buckets = new Map<string, { wins: number; losses: number }>();
    for (const g of completed) {
      const myPick = pickByGameAndPlayer.get(`${g.id}:${pid}`);
      if (!myPick) continue;
      const key = dayKey(new Date(g.playedAt));
      const b = buckets.get(key) ?? { wins: 0, losses: 0 };
      if (myPick.team === g.winningTeam) b.wins++; else b.losses++;
      buckets.set(key, b);
    }
    const sortedDays = [...buckets.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    let type: 'W' | 'L' | null = null;
    let count = 0;
    for (const [, day] of sortedDays) {
      if (day.wins === day.losses) continue; // tie day — maintain, don't add
      const r: 'W' | 'L' = day.wins > day.losses ? 'W' : 'L';
      if (type === null) { type = r; count = 1; continue; }
      if (r !== type) break;
      count++;
    }
    out[pid] = { type, count };
  }
  return out;
}

export async function computePlayerStreaks(playerIds: number[]): Promise<Record<number, PlayerStreakEntry>> {
  if (playerIds.length === 0) return {};
  const [games, picks] = await Promise.all([db.games.toArray(), db.gamePicks.toArray()]);
  return computePlayerStreaksFromData(playerIds, games, picks);
}

// Session-based streak: counts consecutive same-result games within ONE
// session (typically one inhouse day), newest → oldest. Used in BanPickScreen
// so players see their current momentum in this inhouse.
//
// Why session and not calendar day: imported games (via import-records.ts) all
// share the import-time `playedAt`, so a date filter would falsely lump
// historical games into "today". Filtering by sessionId is unambiguous.
export function computeSessionStreaksFromData(
  playerIds: number[],
  games: Game[],
  picks: GamePick[],
  sessionId: number,
): Record<number, PlayerStreakEntry> {
  const sessionGames = games
    .filter((g) => g.winningTeam !== null && g.id !== undefined && g.sessionId === sessionId)
    .sort((a, b) => b.gameNumber - a.gameNumber); // newest gameNumber first
  const pickByGameAndPlayer = new Map<string, GamePick>();
  for (const pick of picks) {
    pickByGameAndPlayer.set(`${pick.gameId}:${pick.playerId}`, pick);
  }
  const out: Record<number, PlayerStreakEntry> = {};
  for (const pid of playerIds) {
    let type: 'W' | 'L' | null = null;
    let count = 0;
    for (const g of sessionGames) {
      const myPick = pickByGameAndPlayer.get(`${g.id}:${pid}`);
      if (!myPick) continue;
      const result: 'W' | 'L' = myPick.team === g.winningTeam ? 'W' : 'L';
      if (type === null) { type = result; count = 1; continue; }
      if (result !== type) break;
      count++;
    }
    out[pid] = { type, count };
  }
  return out;
}

export async function computeSessionStreaks(playerIds: number[]): Promise<Record<number, PlayerStreakEntry>> {
  if (playerIds.length === 0) return {};
  const [games, picks, session] = await Promise.all([
    db.games.toArray(),
    db.gamePicks.toArray(),
    getActiveSession(),
  ]);
  if (!session) return {};
  return computeSessionStreaksFromData(playerIds, games, picks, session.id!);
}

export interface PlayerRadarData {
  axis: string;
  value: number; // 0~100
}

export interface HeadToHeadEntry {
  player1Id: number;
  player2Id: number;
  sameTeamWins: number;
  sameTeamLosses: number;
  sameTeamWinrate: number;
}

export interface RoleDistEntry {
  role: string;
  roleKo: string;
  count: number;
  wins: number;
  winrate: number;
}

export interface ChampionCompareEntry {
  championId: string;
  nameKo: string;
  internalWinrate: number;
  internalPicks: number;
  internalBans: number;
  internalPickRate: number;
  internalBanRate: number;
  aramWinrate: number;
  aramTier: string;
  diff: number; // internal - aram
}

export interface PlayerChampionPoolEntry {
  uniqueCount: number;
  poolScore: number;
  topChamps: { championId: string; picks: number; wins: number; losses: number }[];
}

export interface PlayerRoleRadarPoint {
  axis: string;
  role: string;
  value: number; // winrate 0~100
  picks: number;
  wins: number;
}

export interface PlayerTrendEntry {
  recentWins: number;
  recentLosses: number;
  recentGames: number;
  recentWinrate: number;
  allWinrate: number;
  delta: number;
}

export interface PlayerStreakEntry {
  type: 'W' | 'L' | null;
  count: number;
}

export interface TrioPlayerSynergyEntry {
  playerIds: [number, number, number];
  sameTeamWins: number;
  sameTeamLosses: number;
  winrate: number;
}

export interface PlayerEogSummaryEntry {
  playerId: number;
  games: number;
  totalDamageDealtToChampions: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgDamageDealtToChampions: number;
  avgDamageTaken: number;
  avgDamageSelfMitigated: number;
  avgFrontlineContribution: number;
  avgTotalHeal: number;
  avgTotalShielded: number;
  avgTimeCCingOthers: number;
  avgTimeSpentDead: number;
  avgGoldEarned: number;
  avgKdaParticipation: number;
  avgGoldEfficiency: number;
}

export interface ChampionEogSummaryEntry {
  championId: string;
  games: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgDamageDealtToChampions: number;
  avgDamageTaken: number;
  avgDamageSelfMitigated: number;
  avgFrontlineContribution: number;
  avgTotalHeal: number;
  avgTimeCCingOthers: number;
  avgGoldEarned: number;
  avgKdaParticipation: number;
  avgGoldEfficiency: number;
}

export interface EogOverview {
  capturedGames: number;
  participantRows: number;
  avgDamageDealtToChampions: number;
  avgDamageTaken: number;
  avgDamageSelfMitigated: number;
  avgFrontlineContribution: number;
  avgTotalHeal: number;
  avgTotalShielded: number;
  avgTimeCCingOthers: number;
  avgTimeSpentDead: number;
  avgGoldEarned: number;
  avgKdaParticipation: number;
  avgGoldEfficiency: number;
}

export interface FullStats {
  wrStats: WinrateStats;
  players: Player[];
  champions: Champion[];
  radarData: Record<number, PlayerRadarData[]>;
  roleRadarData: Record<number, PlayerRoleRadarPoint[]>;
  playerChampionPool: Record<number, PlayerChampionPoolEntry>;
  playerTrend: Record<number, PlayerTrendEntry>;
  playerStreak: Record<number, PlayerStreakEntry>;
  headToHead: HeadToHeadEntry[];
  trioPlayerSynergy: TrioPlayerSynergyEntry[];
  roleDist: { all: RoleDistEntry[]; wins: RoleDistEntry[]; losses: RoleDistEntry[] };
  champCompare: ChampionCompareEntry[];
  formatStats: { format: string; wins: number; losses: number; total: number; winrate: number }[];
  sideStats: { team1Wins: number; team2Wins: number; total: number };
  eogOverview: EogOverview;
  playerEogSummary: PlayerEogSummaryEntry[];
  championEogSummary: ChampionEogSummaryEntry[];
}

const ROLE_KO: Record<string, string> = {
  poke: '포크', engage: '이니시', sustain: '유지력',
  dps: '딜러', tank: '탱커', utility: '유틸',
};

const ROLE_KEYS = ['poke', 'engage', 'dps', 'tank'] as const;
const VISIBLE_ROLE_KEYS = new Set<string>(ROLE_KEYS);
const RECENT_GAMES_WINDOW = 5;
const ROLE_WINRATE_PRIOR_GAMES = 4;

export async function computeFullStats(modeFilter?: GameMode): Promise<FullStats> {
  const [players, champions, allGamesRaw, allPicksRaw, allBansRaw, allParticipantStatsRaw, allProficiencies] = await Promise.all([
    db.players.toArray(),
    db.champions.toArray(),
    db.games.toArray(),
    db.gamePicks.toArray(),
    db.gameBans.toArray(),
    db.gameParticipantStats.toArray(),
    db.proficiencies.toArray(),
  ]);
  // Apply same mode filter to games/picks so downstream calcs (radar, role
  // dist, head-to-head, trio synergy, etc.) only see the requested mode.
  const allGames = modeFilter
    ? allGamesRaw.filter((g) => (g.mode ?? 'aram') === modeFilter)
    : allGamesRaw;
  const gameIdSet = modeFilter ? new Set(allGames.map((g) => g.id)) : null;
  const allPicks = gameIdSet
    ? allPicksRaw.filter((p) => gameIdSet.has(p.gameId))
    : allPicksRaw;
  const allBans = gameIdSet
    ? allBansRaw.filter((b) => gameIdSet.has(b.gameId))
    : allBansRaw;
  const wrStats = computeStatsFromData(allGames, allPicks, allBans);
  const gameMap = new Map(allGames.map((game) => [game.id, game]));
  const filteredParticipantStats = gameIdSet
    ? allParticipantStatsRaw.filter((row) => row.gameId && gameIdSet.has(row.gameId))
    : allParticipantStatsRaw.filter((row) => row.gameId);
  const picksByGameId = new Map<number, GamePick[]>();
  const picksByPlayerId = new Map<number, GamePick[]>();
  for (const pick of allPicks) {
    const gamePicks = picksByGameId.get(pick.gameId) ?? [];
    gamePicks.push(pick);
    picksByGameId.set(pick.gameId, gamePicks);
    const playerPicks = picksByPlayerId.get(pick.playerId) ?? [];
    playerPicks.push(pick);
    picksByPlayerId.set(pick.playerId, playerPicks);
  }
  const participantStatsByGameId = new Map<number, GameParticipantStat[]>();
  for (const row of filteredParticipantStats) {
    if (!row.gameId) continue;
    const list = participantStatsByGameId.get(row.gameId) ?? [];
    list.push(row);
    participantStatsByGameId.set(row.gameId, list);
  }
  const allParticipantStats = [...participantStatsByGameId.entries()].flatMap(([gameId, rows]) =>
    resolveParticipantStatsToPicks(rows, picksByGameId.get(gameId) ?? []),
  );
  const participantStatsByPlayerId = new Map<number, GameParticipantStat[]>();
  for (const row of allParticipantStats) {
    if (!row.playerId) continue;
    const rows = participantStatsByPlayerId.get(row.playerId) ?? [];
    rows.push(row);
    participantStatsByPlayerId.set(row.playerId, rows);
  }
  const proficienciesByPlayerId = new Map<number, Map<string, string>>();
  for (const proficiency of allProficiencies) {
    const map = proficienciesByPlayerId.get(proficiency.playerId) ?? new Map<string, string>();
    map.set(proficiency.championId, proficiency.level);
    proficienciesByPlayerId.set(proficiency.playerId, map);
  }

  const champMap = new Map(champions.map((c) => [c.id, c]));

  // --- Radar data per player ---
  const radarData: Record<number, PlayerRadarData[]> = {};
  const roleRadarData: Record<number, PlayerRoleRadarPoint[]> = {};
  const playerChampionPool: Record<number, PlayerChampionPoolEntry> = {};
  const playerTrend: Record<number, PlayerTrendEntry> = {};
  const playerStreak: Record<number, PlayerStreakEntry> = {};
  const playerEogSummary: PlayerEogSummaryEntry[] = [];
  const championEogSummary: ChampionEogSummaryEntry[] = [];

  const avgOfRows = (rows: GameParticipantStat[], selector: (row: GameParticipantStat) => number) => {
    if (rows.length === 0) return 0;
    return rows.reduce((sum, row) => sum + selector(row), 0) / rows.length;
  };

  const globalRoleWins: Record<string, { picks: number; wins: number }> = {};
  for (const pick of allPicks) {
    const game = gameMap.get(pick.gameId);
    const champ = champMap.get(pick.championId);
    if (!game || game.winningTeam === null || !champ || !VISIBLE_ROLE_KEYS.has(champ.aramRole)) continue;
    const role = champ.aramRole;
    const rec = globalRoleWins[role] ?? { picks: 0, wins: 0 };
    rec.picks++;
    if (pick.team === game.winningTeam) rec.wins++;
    globalRoleWins[role] = rec;
  }
  const globalVisibleRoleWins = Object.values(globalRoleWins).reduce((sum, row) => sum + row.wins, 0);
  const globalVisibleRolePicks = Object.values(globalRoleWins).reduce((sum, row) => sum + row.picks, 0);
  const globalVisibleRoleWinrate = globalVisibleRolePicks > 0 ? globalVisibleRoleWins / globalVisibleRolePicks : 0.5;
  const smoothedRoleWinrate = (role: string, wins: number, picks: number) => {
    if (picks === 0) return 0;
    const global = globalRoleWins[role]?.picks
      ? globalRoleWins[role].wins / globalRoleWins[role].picks
      : globalVisibleRoleWinrate;
    return ((wins + global * ROLE_WINRATE_PRIOR_GAMES) / (picks + ROLE_WINRATE_PRIOR_GAMES)) * 100;
  };

  // Pre-sort games by playedAt desc once for trend/streak lookups
  const gamesByRecent = [...allGames]
    .filter((g) => g.winningTeam !== null)
    .sort((a, b) => new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime());

  for (const player of players) {
    const pid = player.id!;
    const pStats = wrStats.playerOverallStats[pid];
    const playerPicks = picksByPlayerId.get(pid) ?? [];
    const playerParticipantStats = participantStatsByPlayerId.get(pid) ?? [];
    const profMap = proficienciesByPlayerId.get(pid) ?? new Map<string, string>();

    const winrate = pStats?.winrate ?? 0;

    // Role stats
    const roleWins: Record<string, { picks: number; wins: number }> = {};
    for (const pick of playerPicks) {
      const champ = champMap.get(pick.championId);
      if (!champ) continue;
      const game = gameMap.get(pick.gameId);
      if (!game || game.winningTeam === null) continue;
      const role = champ.aramRole;
      if (!roleWins[role]) roleWins[role] = { picks: 0, wins: 0 };
      roleWins[role].picks++;
      if (pick.team === game.winningTeam) roleWins[role].wins++;
    }

    const roleScore = (roles: string[]) => {
      let totalPicks = 0, totalWins = 0;
      for (const r of roles) {
        if (roleWins[r]) { totalPicks += roleWins[r].picks; totalWins += roleWins[r].wins; }
      }
      if (totalPicks === 0) return 0;
      const pickRatio = totalPicks / Math.max(playerPicks.length, 1);
      const wr = totalWins / totalPicks;
      return Math.min(100, pickRatio * wr * 200);
    };

    // Champion pool breadth (kept for separate display)
    const uniqueChampMap = new Map<string, { picks: number; wins: number; losses: number }>();
    for (const pick of playerPicks) {
      const game = gameMap.get(pick.gameId);
      if (!game) continue;
      const rec = uniqueChampMap.get(pick.championId) ?? { picks: 0, wins: 0, losses: 0 };
      rec.picks++;
      if (game.winningTeam !== null) {
        if (pick.team === game.winningTeam) rec.wins++; else rec.losses++;
      }
      uniqueChampMap.set(pick.championId, rec);
    }
    const poolScore = Math.min(100, (uniqueChampMap.size / 20) * 100);
    const topChamps = [...uniqueChampMap.entries()]
      .map(([championId, s]) => ({ championId, ...s }))
      .sort((a, b) => b.picks - a.picks)
      .slice(0, 5);
    playerChampionPool[pid] = { uniqueCount: uniqueChampMap.size, poolScore, topChamps };

    // Carry: winrate on proficiency S/상/중 champions
    let carryWins = 0, carryTotal = 0;
    for (const pick of playerPicks) {
      const prof = profMap.get(pick.championId);
      if (prof === 'S' || prof === '상' || prof === '중') {
        const game = gameMap.get(pick.gameId);
        if (game?.winningTeam !== null) {
          carryTotal++;
          if (pick.team === game!.winningTeam) carryWins++;
        }
      }
    }
    const carryScore = carryTotal > 0 ? (carryWins / carryTotal) * 100 : 0;

    radarData[pid] = [
      { axis: '승률', value: winrate },
      { axis: '포크', value: roleScore(['poke']) },
      { axis: '이니시', value: roleScore(['engage', 'tank']) },
      { axis: '챔프폭', value: poolScore },
      { axis: '캐리력', value: carryScore },
    ];

    // Role-based radar: one axis per aram role, value = winrate on that role
    roleRadarData[pid] = ROLE_KEYS.map((role) => {
      const r = roleWins[role] ?? { picks: 0, wins: 0 };
      const value = smoothedRoleWinrate(role, r.wins, r.picks);
      return { axis: ROLE_KO[role] ?? role, role, value, picks: r.picks, wins: r.wins };
    });

    // Recent trend (last N completed games where the player participated)
    let recentWins = 0, recentLosses = 0;
    for (const g of gamesByRecent) {
      if (recentWins + recentLosses >= RECENT_GAMES_WINDOW) break;
      const myPick = (picksByGameId.get(g.id!) ?? []).find((p) => p.playerId === pid);
      if (!myPick) continue;
      if (myPick.team === g.winningTeam) recentWins++; else recentLosses++;
    }
    const recentGames = recentWins + recentLosses;
    const recentWr = recentGames > 0 ? (recentWins / recentGames) * 100 : 0;
    playerTrend[pid] = {
      recentWins, recentLosses, recentGames,
      recentWinrate: recentWr,
      allWinrate: winrate,
      delta: recentGames > 0 ? recentWr - winrate : 0,
    };

    if (playerParticipantStats.length > 0) {
      const totalDamage = playerParticipantStats.reduce((sum, row) => sum + row.totalDamageDealtToChampions, 0);
      playerEogSummary.push({
        playerId: pid,
        games: playerParticipantStats.length,
        totalDamageDealtToChampions: totalDamage,
        avgKills: avgOfRows(playerParticipantStats, (row) => row.kills),
        avgDeaths: avgOfRows(playerParticipantStats, (row) => row.deaths),
        avgAssists: avgOfRows(playerParticipantStats, (row) => row.assists),
        avgDamageDealtToChampions: totalDamage / playerParticipantStats.length,
        avgDamageTaken: avgOfRows(playerParticipantStats, (row) => row.totalDamageTaken),
        avgDamageSelfMitigated: avgOfRows(playerParticipantStats, (row) => row.damageSelfMitigated),
        avgFrontlineContribution: avgOfRows(playerParticipantStats, (row) => row.totalDamageTaken + row.damageSelfMitigated),
        avgTotalHeal: avgOfRows(playerParticipantStats, (row) => row.totalHeal),
        avgTotalShielded: avgOfRows(playerParticipantStats, (row) => row.totalDamageShieldedOnTeammates),
        avgTimeCCingOthers: avgOfRows(playerParticipantStats, (row) => row.timeCCingOthers),
        avgTimeSpentDead: avgOfRows(playerParticipantStats, (row) => row.totalTimeSpentDead),
        avgGoldEarned: avgOfRows(playerParticipantStats, (row) => row.goldEarned),
        avgKdaParticipation: avgOfRows(playerParticipantStats, (row) => (row.kills + row.assists) / Math.max(row.deaths, 1)),
        avgGoldEfficiency: avgOfRows(playerParticipantStats, (row) => row.totalDamageDealtToChampions / Math.max(row.goldEarned, 1)),
      });
    }

  }
  // Day-based streak for every player (computed in one batch)
  const streakBatch = computePlayerStreaksFromData(players.map((p) => p.id!), allGames, allPicks);
  for (const pid of Object.keys(streakBatch).map(Number)) playerStreak[pid] = streakBatch[pid];

  const activePoolSizes = Object.values(playerChampionPool)
    .map((entry) => entry.uniqueCount)
    .filter((count) => count > 0);
  const minPool = activePoolSizes.length > 0 ? Math.min(...activePoolSizes) : 0;
  const maxPool = activePoolSizes.length > 0 ? Math.max(...activePoolSizes) : 0;
  for (const [pidString, entry] of Object.entries(playerChampionPool)) {
    const pid = Number(pidString);
    const smoothedPoolScore = entry.uniqueCount === 0
      ? 0
      : maxPool === minPool
        ? 75
        : 50 + ((entry.uniqueCount - minPool) / (maxPool - minPool)) * 50;
    radarData[pid] = (radarData[pid] ?? []).map((point) =>
      point.axis === '챔프폭' ? { ...point, value: smoothedPoolScore } : point,
    );
    playerChampionPool[pid] = { ...entry, poolScore: smoothedPoolScore };
  }

  // --- Head to Head + Trio Synergy (precompute per-game player→team map for speed) ---
  const gameTeamMap = new Map<number, Map<number, number>>(); // gameId → playerId → team
  const gameResultMap = new Map<number, number>(); // gameId → winningTeam
  for (const game of allGames) {
    if (game.winningTeam === null || game.id === undefined) continue;
    gameResultMap.set(game.id, game.winningTeam);
    const map = new Map<number, number>();
    for (const p of picksByGameId.get(game.id) ?? []) map.set(p.playerId, p.team);
    gameTeamMap.set(game.id, map);
  }

  const pairStats = new Map<string, { player1Id: number; player2Id: number; wins: number; losses: number }>();
  const trioStats = new Map<string, { playerIds: [number, number, number]; wins: number; losses: number }>();
  const MIN_TRIO_GAMES = 3;

  for (const [gameId, teamMap] of gameTeamMap) {
    const winner = gameResultMap.get(gameId)!;
    const teamPlayers = new Map<number, number[]>();
    for (const [playerId, team] of teamMap) {
      const list = teamPlayers.get(team) ?? [];
      list.push(playerId);
      teamPlayers.set(team, list);
    }

    for (const [team, playerIds] of teamPlayers) {
      const sortedIds = [...playerIds].sort((a, b) => a - b);
      const won = team === winner;

      for (let i = 0; i < sortedIds.length; i++) {
        for (let j = i + 1; j < sortedIds.length; j++) {
          const player1Id = sortedIds[i];
          const player2Id = sortedIds[j];
          const key = `${player1Id}:${player2Id}`;
          const rec = pairStats.get(key) ?? { player1Id, player2Id, wins: 0, losses: 0 };
          if (won) rec.wins++; else rec.losses++;
          pairStats.set(key, rec);
        }
      }

      for (let i = 0; i < sortedIds.length; i++) {
        for (let j = i + 1; j < sortedIds.length; j++) {
          for (let k = j + 1; k < sortedIds.length; k++) {
            const playerIds = [sortedIds[i], sortedIds[j], sortedIds[k]] as [number, number, number];
            const key = playerIds.join(':');
            const rec = trioStats.get(key) ?? { playerIds, wins: 0, losses: 0 };
            if (won) rec.wins++; else rec.losses++;
            trioStats.set(key, rec);
          }
        }
      }
    }
  }

  const headToHead: HeadToHeadEntry[] = [...pairStats.values()].map((rec) => {
    const total = rec.wins + rec.losses;
    return {
      player1Id: rec.player1Id,
      player2Id: rec.player2Id,
      sameTeamWins: rec.wins,
      sameTeamLosses: rec.losses,
      sameTeamWinrate: total > 0 ? (rec.wins / total) * 100 : 0,
    };
  });

  const trioPlayerSynergy: TrioPlayerSynergyEntry[] = [...trioStats.values()]
    .filter((rec) => rec.wins + rec.losses >= MIN_TRIO_GAMES)
    .map((rec) => {
      const total = rec.wins + rec.losses;
      return {
        playerIds: rec.playerIds,
        sameTeamWins: rec.wins,
        sameTeamLosses: rec.losses,
        winrate: total > 0 ? (rec.wins / total) * 100 : 0,
      };
    });
  trioPlayerSynergy.sort((a, b) => b.winrate - a.winrate);

  // --- Role Distribution ---
  const computeRoleDist = (filter: (game: typeof allGames[0], pick: typeof allPicks[0]) => boolean) => {
    const dist: Record<string, { count: number; wins: number }> = {};
    for (const pick of allPicks) {
      const game = gameMap.get(pick.gameId);
      if (!game || game.winningTeam === null) continue;
      if (!filter(game, pick)) continue;
      const champ = champMap.get(pick.championId);
      if (!champ) continue;
      const role = champ.aramRole;
      if (!VISIBLE_ROLE_KEYS.has(role)) continue;
      if (!dist[role]) dist[role] = { count: 0, wins: 0 };
      dist[role].count++;
      if (pick.team === game.winningTeam) dist[role].wins++;
    }
    return Object.entries(dist).map(([role, d]) => ({
      role, roleKo: ROLE_KO[role] ?? role, count: d.count, wins: d.wins,
      winrate: smoothedRoleWinrate(role, d.wins, d.count),
    }));
  };

  const roleDist = {
    all: computeRoleDist(() => true),
    wins: computeRoleDist((game, pick) => pick.team === game.winningTeam),
    losses: computeRoleDist((game, pick) => pick.team !== game.winningTeam),
  };

  // --- Champion Compare ---
  const champCompare: ChampionCompareEntry[] = [];
  for (const [cid, cs] of Object.entries(wrStats.champOverallStats)) {
    if (cs.picks === 0) continue;
    const champ = champMap.get(cid);
    const meta = aramChampionMeta[cid];
    if (!champ) continue;
    champCompare.push({
      championId: cid, nameKo: champ.nameKo,
      internalWinrate: cs.winrate, internalPicks: cs.picks, internalBans: cs.bans,
      internalPickRate: cs.pickRate, internalBanRate: cs.banRate,
      aramWinrate: meta?.aramWinrate ?? 50, aramTier: meta?.aramTier ?? 'B',
      diff: cs.winrate - (meta?.aramWinrate ?? 50),
    });
  }
  champCompare.sort((a, b) => b.internalPicks - a.internalPicks);

  // --- Format Stats ---
  const formatMap: Record<string, { wins: number; losses: number }> = {};
  for (const game of allGames) {
    if (game.winningTeam === null) continue;
    if (!formatMap[game.format]) formatMap[game.format] = { wins: 0, losses: 0 };
    formatMap[game.format].wins++;
  }
  const formatStats = Object.entries(formatMap).map(([format, s]) => ({
    format, wins: s.wins, losses: s.losses, total: s.wins + s.losses,
    winrate: (s.wins / (s.wins + s.losses)) * 100,
  }));

  // --- Side Stats ---
  let t1Wins = 0, t2Wins = 0;
  for (const game of allGames) {
    if (game.winningTeam === 1) t1Wins++;
    else if (game.winningTeam === 2) t2Wins++;
  }

  const eogOverview: EogOverview = {
    capturedGames: new Set(allParticipantStats.map((row) => row.gameId).filter((value): value is number => typeof value === 'number')).size,
    participantRows: allParticipantStats.length,
    avgDamageDealtToChampions: avgOfRows(allParticipantStats, (row) => row.totalDamageDealtToChampions),
    avgDamageTaken: avgOfRows(allParticipantStats, (row) => row.totalDamageTaken),
    avgDamageSelfMitigated: avgOfRows(allParticipantStats, (row) => row.damageSelfMitigated),
    avgFrontlineContribution: avgOfRows(allParticipantStats, (row) => row.totalDamageTaken + row.damageSelfMitigated),
    avgTotalHeal: avgOfRows(allParticipantStats, (row) => row.totalHeal),
    avgTotalShielded: avgOfRows(allParticipantStats, (row) => row.totalDamageShieldedOnTeammates),
    avgTimeCCingOthers: avgOfRows(allParticipantStats, (row) => row.timeCCingOthers),
    avgTimeSpentDead: avgOfRows(allParticipantStats, (row) => row.totalTimeSpentDead),
    avgGoldEarned: avgOfRows(allParticipantStats, (row) => row.goldEarned),
    avgKdaParticipation: avgOfRows(allParticipantStats, (row) => (row.kills + row.assists) / Math.max(row.deaths, 1)),
    avgGoldEfficiency: avgOfRows(allParticipantStats, (row) => row.totalDamageDealtToChampions / Math.max(row.goldEarned, 1)),
  };

  const participantStatsByChampionId = new Map<string, GameParticipantStat[]>();
  for (const row of allParticipantStats) {
    if (!row.championId) continue;
    const rows = participantStatsByChampionId.get(row.championId) ?? [];
    rows.push(row);
    participantStatsByChampionId.set(row.championId, rows);
  }
  for (const [championId, rows] of participantStatsByChampionId) {
    championEogSummary.push({
      championId,
      games: rows.length,
      avgKills: avgOfRows(rows, (row) => row.kills),
      avgDeaths: avgOfRows(rows, (row) => row.deaths),
      avgAssists: avgOfRows(rows, (row) => row.assists),
      avgDamageDealtToChampions: avgOfRows(rows, (row) => row.totalDamageDealtToChampions),
      avgDamageTaken: avgOfRows(rows, (row) => row.totalDamageTaken),
      avgDamageSelfMitigated: avgOfRows(rows, (row) => row.damageSelfMitigated),
      avgFrontlineContribution: avgOfRows(rows, (row) => row.totalDamageTaken + row.damageSelfMitigated),
      avgTotalHeal: avgOfRows(rows, (row) => row.totalHeal),
      avgTimeCCingOthers: avgOfRows(rows, (row) => row.timeCCingOthers),
      avgGoldEarned: avgOfRows(rows, (row) => row.goldEarned),
      avgKdaParticipation: avgOfRows(rows, (row) => (row.kills + row.assists) / Math.max(row.deaths, 1)),
      avgGoldEfficiency: avgOfRows(rows, (row) => row.totalDamageDealtToChampions / Math.max(row.goldEarned, 1)),
    });
  }

  return {
    wrStats, players, champions,
    radarData, roleRadarData,
    playerChampionPool, playerTrend, playerStreak,
    headToHead, trioPlayerSynergy,
    roleDist, champCompare, formatStats,
    sideStats: { team1Wins: t1Wins, team2Wins: t2Wins, total: t1Wins + t2Wins },
    eogOverview,
    playerEogSummary: playerEogSummary.sort((a, b) => b.avgDamageDealtToChampions - a.avgDamageDealtToChampions),
    championEogSummary: championEogSummary.sort((a, b) => b.avgDamageDealtToChampions - a.avgDamageDealtToChampions),
  };
}
