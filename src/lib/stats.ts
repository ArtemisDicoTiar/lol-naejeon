import { db, type Champion, type Game, type GamePick, type Player, getPlayerProficiencies, getActiveSession } from './db';
import { computeWinrateStats, type WinrateStats } from './recommendation/winrate';
import { aramChampionMeta } from '@/data/aram-champion-meta';

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
  const out: Record<number, PlayerStreakEntry> = {};
  for (const pid of playerIds) {
    const buckets = new Map<string, { wins: number; losses: number }>();
    for (const g of completed) {
      const myPick = picks.find((p) => p.gameId === g.id && p.playerId === pid);
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
  const out: Record<number, PlayerStreakEntry> = {};
  for (const pid of playerIds) {
    let type: 'W' | 'L' | null = null;
    let count = 0;
    for (const g of sessionGames) {
      const myPick = picks.find((p) => p.gameId === g.id && p.playerId === pid);
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
}

const ROLE_KO: Record<string, string> = {
  poke: '포크', engage: '이니시', sustain: '유지력',
  dps: '딜러', tank: '탱커', utility: '유틸',
};

const ROLE_KEYS = ['poke', 'engage', 'sustain', 'dps', 'tank', 'utility'] as const;
const RECENT_GAMES_WINDOW = 5;

export async function computeFullStats(): Promise<FullStats> {
  const [wrStats, players, champions, allGames, allPicks] = await Promise.all([
    computeWinrateStats(),
    db.players.toArray(),
    db.champions.toArray(),
    db.games.toArray(),
    db.gamePicks.toArray(),
  ]);

  const champMap = new Map(champions.map((c) => [c.id, c]));

  // --- Radar data per player ---
  const radarData: Record<number, PlayerRadarData[]> = {};
  const roleRadarData: Record<number, PlayerRoleRadarPoint[]> = {};
  const playerChampionPool: Record<number, PlayerChampionPoolEntry> = {};
  const playerTrend: Record<number, PlayerTrendEntry> = {};
  const playerStreak: Record<number, PlayerStreakEntry> = {};

  // Pre-sort games by playedAt desc once for trend/streak lookups
  const gamesByRecent = [...allGames]
    .filter((g) => g.winningTeam !== null)
    .sort((a, b) => new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime());

  for (const player of players) {
    const pid = player.id!;
    const pStats = wrStats.playerOverallStats[pid];
    const playerPicks = allPicks.filter((p) => p.playerId === pid);
    const profMap = await getPlayerProficiencies(pid);

    const winrate = pStats?.winrate ?? 0;

    // Role stats
    const roleWins: Record<string, { picks: number; wins: number }> = {};
    for (const pick of playerPicks) {
      const champ = champMap.get(pick.championId);
      if (!champ) continue;
      const game = allGames.find((g) => g.id === pick.gameId);
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
      const game = allGames.find((g) => g.id === pick.gameId);
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
        const game = allGames.find((g) => g.id === pick.gameId);
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
      { axis: '유지력', value: roleScore(['sustain', 'utility']) },
      { axis: '캐리력', value: carryScore },
    ];

    // Role-based radar: one axis per aram role, value = winrate on that role
    roleRadarData[pid] = ROLE_KEYS.map((role) => {
      const r = roleWins[role] ?? { picks: 0, wins: 0 };
      const value = r.picks > 0 ? (r.wins / r.picks) * 100 : 0;
      return { axis: ROLE_KO[role] ?? role, role, value, picks: r.picks, wins: r.wins };
    });

    // Recent trend (last N completed games where the player participated)
    let recentWins = 0, recentLosses = 0;
    for (const g of gamesByRecent) {
      if (recentWins + recentLosses >= RECENT_GAMES_WINDOW) break;
      const myPick = allPicks.find((p) => p.gameId === g.id && p.playerId === pid);
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

  }
  // Day-based streak for every player (computed in one batch)
  const streakBatch = computePlayerStreaksFromData(players.map((p) => p.id!), allGames, allPicks);
  for (const pid of Object.keys(streakBatch).map(Number)) playerStreak[pid] = streakBatch[pid];

  // --- Head to Head + Trio Synergy (precompute per-game player→team map for speed) ---
  const gameTeamMap = new Map<number, Map<number, number>>(); // gameId → playerId → team
  const gameResultMap = new Map<number, number>(); // gameId → winningTeam
  for (const game of allGames) {
    if (game.winningTeam === null || game.id === undefined) continue;
    gameResultMap.set(game.id, game.winningTeam);
    const map = new Map<number, number>();
    for (const p of allPicks) {
      if (p.gameId === game.id) map.set(p.playerId, p.team);
    }
    gameTeamMap.set(game.id, map);
  }

  const headToHead: HeadToHeadEntry[] = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const p1 = players[i].id!, p2 = players[j].id!;
      let sameW = 0, sameL = 0;
      for (const [gameId, teamMap] of gameTeamMap) {
        const t1 = teamMap.get(p1);
        const t2 = teamMap.get(p2);
        if (t1 == null || t2 == null) continue;
        if (t1 !== t2) continue;
        const winner = gameResultMap.get(gameId)!;
        if (t1 === winner) sameW++; else sameL++;
      }
      const total = sameW + sameL;
      if (total > 0) {
        headToHead.push({ player1Id: p1, player2Id: p2, sameTeamWins: sameW, sameTeamLosses: sameL, sameTeamWinrate: (sameW / total) * 100 });
      }
    }
  }

  // 3-player synergy: any trio of our players who played together on the same team
  const trioPlayerSynergy: TrioPlayerSynergyEntry[] = [];
  const MIN_TRIO_GAMES = 3;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      for (let k = j + 1; k < players.length; k++) {
        const p1 = players[i].id!, p2 = players[j].id!, p3 = players[k].id!;
        let wins = 0, losses = 0;
        for (const [gameId, teamMap] of gameTeamMap) {
          const t1 = teamMap.get(p1);
          const t2 = teamMap.get(p2);
          const t3 = teamMap.get(p3);
          if (t1 == null || t2 == null || t3 == null) continue;
          if (t1 !== t2 || t2 !== t3) continue;
          if (t1 === gameResultMap.get(gameId)!) wins++; else losses++;
        }
        const total = wins + losses;
        if (total >= MIN_TRIO_GAMES) {
          trioPlayerSynergy.push({
            playerIds: [p1, p2, p3],
            sameTeamWins: wins,
            sameTeamLosses: losses,
            winrate: (wins / total) * 100,
          });
        }
      }
    }
  }
  trioPlayerSynergy.sort((a, b) => b.winrate - a.winrate);

  // --- Role Distribution ---
  const computeRoleDist = (filter: (game: typeof allGames[0], pick: typeof allPicks[0]) => boolean) => {
    const dist: Record<string, { count: number; wins: number }> = {};
    for (const pick of allPicks) {
      const game = allGames.find((g) => g.id === pick.gameId);
      if (!game || game.winningTeam === null) continue;
      if (!filter(game, pick)) continue;
      const champ = champMap.get(pick.championId);
      if (!champ) continue;
      const role = champ.aramRole;
      if (!dist[role]) dist[role] = { count: 0, wins: 0 };
      dist[role].count++;
      if (pick.team === game.winningTeam) dist[role].wins++;
    }
    return Object.entries(dist).map(([role, d]) => ({
      role, roleKo: ROLE_KO[role] ?? role, count: d.count, wins: d.wins,
      winrate: d.count > 0 ? (d.wins / d.count) * 100 : 0,
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

  return {
    wrStats, players, champions,
    radarData, roleRadarData,
    playerChampionPool, playerTrend, playerStreak,
    headToHead, trioPlayerSynergy,
    roleDist, champCompare, formatStats,
    sideStats: { team1Wins: t1Wins, team2Wins: t2Wins, total: t1Wins + t2Wins },
  };
}
