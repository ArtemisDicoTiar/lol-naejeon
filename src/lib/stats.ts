import { db, type Champion, type Player, getPlayerProficiencies } from './db';
import { computeWinrateStats, type WinrateStats } from './recommendation/winrate';
import { aramChampionMeta } from '@/data/aram-champion-meta';

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

export interface FullStats {
  wrStats: WinrateStats;
  players: Player[];
  champions: Champion[];
  radarData: Record<number, PlayerRadarData[]>;
  headToHead: HeadToHeadEntry[];
  roleDist: { all: RoleDistEntry[]; wins: RoleDistEntry[]; losses: RoleDistEntry[] };
  champCompare: ChampionCompareEntry[];
  formatStats: { format: string; wins: number; losses: number; total: number; winrate: number }[];
  sideStats: { team1Wins: number; team2Wins: number; total: number };
}

const ROLE_KO: Record<string, string> = {
  poke: '포크', engage: '인게이지', sustain: '서스테인',
  dps: '딜러', tank: '탱커', utility: '유틸리티',
};

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

    // Champion pool breadth
    const uniqueChamps = new Set(playerPicks.map((p) => p.championId));
    const poolScore = Math.min(100, (uniqueChamps.size / 20) * 100); // 20 unique = 100

    // Carry: winrate on proficiency 상/중 champions
    let carryWins = 0, carryTotal = 0;
    for (const pick of playerPicks) {
      const prof = profMap.get(pick.championId);
      if (prof === '상' || prof === '중') {
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
      { axis: '인게이지', value: roleScore(['engage', 'tank']) },
      { axis: '서스테인', value: roleScore(['sustain', 'utility']) },
      { axis: '챔피언 폭', value: poolScore },
      { axis: '캐리력', value: carryScore },
    ];
  }

  // --- Head to Head ---
  const headToHead: HeadToHeadEntry[] = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const p1 = players[i].id!, p2 = players[j].id!;
      let sameW = 0, sameL = 0;
      for (const game of allGames) {
        if (game.winningTeam === null) continue;
        const picks = allPicks.filter((p) => p.gameId === game.id!);
        const p1Pick = picks.find((p) => p.playerId === p1);
        const p2Pick = picks.find((p) => p.playerId === p2);
        if (!p1Pick || !p2Pick) continue;
        if (p1Pick.team === p2Pick.team) {
          if (p1Pick.team === game.winningTeam) sameW++; else sameL++;
        }
      }
      const total = sameW + sameL;
      if (total > 0) {
        headToHead.push({ player1Id: p1, player2Id: p2, sameTeamWins: sameW, sameTeamLosses: sameL, sameTeamWinrate: (sameW / total) * 100 });
      }
    }
  }

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
    wrStats, players, champions, radarData, headToHead, roleDist, champCompare, formatStats,
    sideStats: { team1Wins: t1Wins, team2Wins: t2Wins, total: t1Wins + t2Wins },
  };
}
