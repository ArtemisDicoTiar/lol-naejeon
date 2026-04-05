import { useState, useMemo, useEffect } from 'react';
import type { Champion, Player, ProficiencyLevel } from '@/lib/db';
import type { RecommendedComp } from '@/lib/recommendation/types';
import { generateRecommendations, generatePerPlayerBanRecs, getPlayerTopChampions } from '@/lib/recommendation/engine';
import { computeWinrateStats, estimateCompWinrate, type WinrateStats } from '@/lib/recommendation/winrate';
import { loadSynergyCounterData, type SynergyCounterData } from '@/lib/recommendation/data-loader';
import { estimatePlayerProficiencies, type EstimatedProficiency } from '@/lib/recommendation/proficiency-estimator';
import { championTraits } from '@/data/champion-tags';
import { ChampionIcon } from '@/components/champions/ChampionIcon';
import { ChampionWithHover } from '@/components/champions/ChampionWithHover';
import { ProficiencyBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useLcuContext, useIdentityContext } from '@/App';

interface BanPickScreenProps {
  format: '3v3' | '3v4';
  team1PlayerIds: number[];
  team2PlayerIds: number[];
  players: Player[];
  champions: Champion[];
  fierlessBans: string[];
  proficiencies: Record<number, Map<string, ProficiencyLevel>>;
  onConfirm: (result: { bans: Record<1 | 2, string[]>; picks: Record<number, string> }) => void;
  onBack: () => void;
  onReorderTeams?: (team1: number[], team2: number[]) => void;
}

type ActiveSlot =
  | { type: 'ban'; team: 1 | 2; index: number }
  | { type: 'pick'; playerId: number }
  | null;

const SKIP_BAN = '__SKIP__';

export function BanPickScreen({
  format, team1PlayerIds, team2PlayerIds, players, champions,
  fierlessBans, proficiencies, onConfirm, onBack, onReorderTeams,
}: BanPickScreenProps) {
  const { userId } = useIdentityContext();
  const team1Size = team1PlayerIds.length;
  const team2Size = team2PlayerIds.length;

  // Ban state: each team bans as many as their OWN player count
  const [team1Bans, setTeam1Bans] = useState<string[]>(Array(team1Size).fill(''));
  const [team2Bans, setTeam2Bans] = useState<string[]>(Array(team2Size).fill(''));
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [activeSlot, setActiveSlot] = useState<ActiveSlot>({ type: 'ban', team: 1, index: 0 });
  const [search, setSearch] = useState('');
  const [phase, setPhase] = useState<'ban' | 'pick'>('ban');
  const [lockedPicks, setLockedPicks] = useState<Set<number>>(new Set());
  const [sortMode, setSortMode] = useState<'auto' | 'name' | 'tier' | 'winrate'>('auto');
  const [lcuPaused, setLcuPaused] = useState(false); // pause LCU sync after manual reset
  const [wrStats, setWrStats] = useState<WinrateStats | null>(null);
  const [matchData, setMatchData] = useState<SynergyCounterData | null>(null);
  const lcu = useLcuContext();

  useEffect(() => { computeWinrateStats().then(setWrStats); }, []);
  useEffect(() => { loadSynergyCounterData().then(setMatchData); }, []);

  // --- LCU Bridge: auto-apply champion select data ---
  // Build numeric champion key → string ID mapping from Data Dragon
  const [champKeyMap, setChampKeyMap] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    // Fetch champion data to get numeric key mapping
    fetch('https://ddragon.leagueoflegends.com/api/versions.json')
      .then(r => r.json())
      .then(versions => fetch(`https://ddragon.leagueoflegends.com/cdn/${versions[0]}/data/ko_KR/champion.json`))
      .then(r => r.json())
      .then(data => {
        const map = new Map<number, string>();
        for (const [key, champ] of Object.entries(data.data as Record<string, any>)) {
          map.set(parseInt(champ.key), key);
        }
        setChampKeyMap(map);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reverse map: string champion ID → numeric ID (for sending to LCU)
  const champIdToNumeric = useMemo(() => {
    const map = new Map<string, number>();
    for (const [num, str] of champKeyMap) map.set(str, num);
    return map;
  }, [champKeyMap]);

  // Resume LCU sync when a new champ select starts (different state from what caused pause)
  useEffect(() => {
    if (lcuPaused && lcu.champSelectActive) {
      setLcuPaused(false);
    }
  }, [lcu.champSelectActive, lcuPaused]);

  // Apply LCU state to ban/pick slots
  useEffect(() => {
    if (lcuPaused) return;
    if (!lcu.lastState || champKeyMap.size === 0) return;
    const state = lcu.lastState;
    const lcuPhase = state.phase?.toUpperCase() ?? '';

    // Rebuild team assignments from LCU data (always, regardless of phase)
    const playerNameToId = new Map<string, number>();
    for (const id of [...team1PlayerIds, ...team2PlayerIds]) {
      const name = players.find(p => p.id === id)?.name ?? '';
      if (name) playerNameToId.set(name, id);
    }

    const buildTeamFromLcu = (lcuPicks: typeof state.team1Picks) => {
      const sorted = [...lcuPicks].sort((a, b) => a.cellId - b.cellId);
      const ids: number[] = [];
      for (const p of sorted) {
        if (p.alias && playerNameToId.has(p.alias)) {
          ids.push(playerNameToId.get(p.alias)!);
        }
      }
      return ids;
    };

    if (state.team1Picks.some(p => p.alias) || state.team2Picks.some(p => p.alias)) {
      const lcuT1 = buildTeamFromLcu(state.team1Picks);
      const lcuT2 = buildTeamFromLcu(state.team2Picks);
      const matched = new Set([...lcuT1, ...lcuT2]);
      for (const id of team1PlayerIds) { if (!matched.has(id)) lcuT1.push(id); }
      for (const id of team2PlayerIds) { if (!matched.has(id)) lcuT2.push(id); }
      const t1Changed = JSON.stringify(lcuT1) !== JSON.stringify(team1PlayerIds);
      const t2Changed = JSON.stringify(lcuT2) !== JSON.stringify(team2PlayerIds);
      if ((t1Changed || t2Changed) && onReorderTeams) onReorderTeams(lcuT1, lcuT2);
    }

    // PLANNING phase: only reorder teams, don't apply bans/picks
    if (lcuPhase === 'PLANNING') return;

    // BAN phase: apply bans only
    const lcuBans1 = state.team1Bans.map(id => champKeyMap.get(id) ?? '').filter(Boolean);
    const lcuBans2 = state.team2Bans.map(id => champKeyMap.get(id) ?? '').filter(Boolean);

    if (lcuBans1.length > 0) {
      setTeam1Bans(prev => {
        const size = Math.max(prev.length, lcuBans1.length);
        const newBans = Array(size).fill('');
        prev.forEach((b, i) => { if (i < size) newBans[i] = b; });
        lcuBans1.forEach((champId, i) => { newBans[i] = champId; });
        return newBans;
      });
    }
    if (lcuBans2.length > 0) {
      setTeam2Bans(prev => {
        const size = Math.max(prev.length, lcuBans2.length);
        const newBans = Array(size).fill('');
        prev.forEach((b, i) => { if (i < size) newBans[i] = b; });
        lcuBans2.forEach((champId, i) => { newBans[i] = champId; });
        return newBans;
      });
    }

    // Auto-transition to pick phase if bans are filled
    if (lcuBans1.length > 0 || lcuBans2.length > 0) {
      const allBansFilled = team1Bans.every(b => b) && team2Bans.every(b => b);
      if (allBansFilled && phase === 'ban') {
        setPhase('pick');
        const firstInDraft = draftOrder.find((id) => !picks[id]);
        setActiveSlot(firstInDraft ? { type: 'pick', playerId: firstInDraft } : null);
      }
    }

    // PICK/FINALIZATION phase: apply picks
    if (lcuPhase !== 'BAN_PICK' || (lcuBans1.length + lcuBans2.length > 0 && team1Bans.every(b => b) && team2Bans.every(b => b))) {
      const applyPicks = (lcuPicks: typeof state.team1Picks, fallbackIds: number[]) => {
        const result: Record<number, string> = {};
        lcuPicks.forEach((p, i) => {
          // Only apply picks that have a locked champion or are in pick actions (not hover during ban)
          if (p.champId <= 0) return;
          const champStrId = champKeyMap.get(p.champId);
          if (!champStrId) return;
          if (p.alias && playerNameToId.has(p.alias)) {
            result[playerNameToId.get(p.alias)!] = champStrId;
          } else if (i < fallbackIds.length) {
            result[fallbackIds[i]] = champStrId;
          }
        });
        return result;
      };

      const picks1 = applyPicks(state.team1Picks, team1PlayerIds);
      const picks2 = applyPicks(state.team2Picks, team2PlayerIds);

      if (Object.keys(picks1).length > 0 || Object.keys(picks2).length > 0) {
        setPicks(prev => ({ ...prev, ...picks1, ...picks2 }));
        setPhase('pick');
      }
    }

    // Auto lock-in: match by alias first, then by position fallback
    const lockFromLcu = (lcuPicks: typeof state.team1Picks, fallbackIds: number[]) => {
      const result: number[] = [];
      lcuPicks.forEach((p, i) => {
        if (!p.locked || p.champId <= 0) return;
        // Try alias match
        if (p.alias && playerNameToId.has(p.alias)) {
          result.push(playerNameToId.get(p.alias)!);
        } else if (i < fallbackIds.length) {
          // Fallback: position order
          result.push(fallbackIds[i]);
        }
      });
      return result;
    };

    const locked1 = lockFromLcu(state.team1Picks, team1PlayerIds);
    const locked2 = lockFromLcu(state.team2Picks, team2PlayerIds);
    const allToLock = [...locked1, ...locked2];

    if (allToLock.length > 0) {
      setLockedPicks(prev => {
        const next = new Set(prev);
        let changed = false;
        for (const pid of allToLock) {
          if (!next.has(pid)) { next.add(pid); changed = true; }
        }
        return changed ? next : prev;
      });
    }
  }, [lcu.lastState, champKeyMap, team1PlayerIds, team2PlayerIds, players, onReorderTeams]);

  // Estimated proficiencies: auto-estimate for champions without manual proficiency
  const { mergedProficiencies, estimatedMap } = useMemo(() => {
    if (!wrStats) return { mergedProficiencies: proficiencies, estimatedMap: new Map<string, Map<string, EstimatedProficiency>>() };

    const champIds = champions.map((c) => c.id);
    const aramWrMap = new Map(champions.map((c) => [c.id, c.aramWinrate]));
    const allPlayerIds = [...team1PlayerIds, ...team2PlayerIds];
    const estMap = new Map<string, Map<string, EstimatedProficiency>>();
    const merged = { ...proficiencies };

    for (const pid of allPlayerIds) {
      const manual = proficiencies[pid] ?? new Map();
      const estimates = estimatePlayerProficiencies(pid, manual, champIds, aramWrMap, wrStats);
      estMap.set(String(pid), estimates);

      // Merge: manual proficiency takes priority, estimated fills gaps
      if (estimates.size > 0) {
        const mergedMap = new Map(manual);
        for (const [champId, est] of estimates) {
          if (!mergedMap.has(champId) || mergedMap.get(champId) === '없음') {
            mergedMap.set(champId, est.level);
          }
        }
        merged[pid] = mergedMap;
      }
    }

    return { mergedProficiencies: merged, estimatedMap: estMap };
  }, [wrStats, proficiencies, champions, team1PlayerIds, team2PlayerIds]);

  const getPlayerName = (id: number) => players.find((p) => p.id === id)?.name ?? '';
  const getTeamBans = (team: 1 | 2) => team === 1 ? team1Bans : team2Bans;
  const setTeamBans = (team: 1 | 2, bans: string[]) => team === 1 ? setTeam1Bans(bans) : setTeam2Bans(bans);

  // All banned champion ids (fierless + game bans, excluding SKIP)
  const allBannedIds = useMemo(() => {
    const gameBans = [...team1Bans, ...team2Bans].filter((b) => b && b !== SKIP_BAN);
    return new Set([...fierlessBans, ...gameBans]);
  }, [fierlessBans, team1Bans, team2Bans]);

  const pickedIds = useMemo(() => new Set(Object.values(picks)), [picks]);

  // Available champions (not fierless, not game-banned, not picked)
  const availableChampions = useMemo(() => {
    return champions.filter((c) => !allBannedIds.has(c.id) && !pickedIds.has(c.id));
  }, [champions, allBannedIds, pickedIds]);

  // Fierless champion objects
  const fierlessChampions = useMemo(() => {
    return champions.filter((c) => fierlessBans.includes(c.id));
  }, [champions, fierlessBans]);

  // Ban recommendations (per opponent player, 5 each)
  const alreadyBannedAll = useMemo(() => [
    ...fierlessBans,
    ...team1Bans.filter((b) => b && b !== SKIP_BAN),
    ...team2Bans.filter((b) => b && b !== SKIP_BAN),
  ], [fierlessBans, team1Bans, team2Bans]);

  const team1OurProfs = useMemo(() => {
    const m: Record<number, Map<string, any>> = {};
    for (const pid of team1PlayerIds) { if (mergedProficiencies[pid]) m[pid] = mergedProficiencies[pid]; }
    return m;
  }, [team1PlayerIds, proficiencies]);
  const team2OurProfs = useMemo(() => {
    const m: Record<number, Map<string, any>> = {};
    for (const pid of team2PlayerIds) { if (mergedProficiencies[pid]) m[pid] = mergedProficiencies[pid]; }
    return m;
  }, [team2PlayerIds, proficiencies]);

  const team1BanRecs = useMemo(() => generatePerPlayerBanRecs({
    opponentPlayerIds: team2PlayerIds,
    opponentPlayerNames: Object.fromEntries(players.map((p) => [p.id!, p.name])),
    proficiencies: mergedProficiencies, allChampions: champions, alreadyBanned: alreadyBannedAll,
    ourTeamProficiencies: team1OurProfs,
  }), [team2PlayerIds, players, mergedProficiencies, champions, alreadyBannedAll, team1OurProfs]);

  const team2BanRecs = useMemo(() => generatePerPlayerBanRecs({
    opponentPlayerIds: team1PlayerIds,
    opponentPlayerNames: Object.fromEntries(players.map((p) => [p.id!, p.name])),
    proficiencies: mergedProficiencies, allChampions: champions, alreadyBanned: alreadyBannedAll,
    ourTeamProficiencies: team2OurProfs,
  }), [team1PlayerIds, players, mergedProficiencies, champions, alreadyBannedAll, team2OurProfs]);

  // Opponent picks per team (for counter recommendations)
  const team1Picks = useMemo(() =>
    team1PlayerIds.map((id) => picks[id]).filter(Boolean), [team1PlayerIds, picks]);
  const team2Picks = useMemo(() =>
    team2PlayerIds.map((id) => picks[id]).filter(Boolean), [team2PlayerIds, picks]);

  // Draft order: B1 → R1,R2 → B2,B3 → R3 (3v3) or B1 → R1,R2 → B2,B3 → R3,R4 (3v4)
  const draftOrder = useMemo(() => {
    const b = team1PlayerIds;
    const r = team2PlayerIds;
    if (format === '3v3') {
      return [
        { team: 1 as const, idx: 0 },
        { team: 2 as const, idx: 0 }, { team: 2 as const, idx: 1 },
        { team: 1 as const, idx: 1 }, { team: 1 as const, idx: 2 },
        { team: 2 as const, idx: 2 },
      ].map((d) => d.team === 1 ? b[d.idx] : r[d.idx]);
    }
    // 3v4
    return [
      { team: 1 as const, idx: 0 },
      { team: 2 as const, idx: 0 }, { team: 2 as const, idx: 1 },
      { team: 1 as const, idx: 1 }, { team: 1 as const, idx: 2 },
      { team: 2 as const, idx: 2 }, { team: 2 as const, idx: 3 },
    ].map((d) => d.team === 1 ? b[d.idx] : r[d.idx]);
  }, [team1PlayerIds, team2PlayerIds, format]);

  // Comp recommendations (with opponent counter logic)
  const getCompRecs = (teamPlayerIds: number[], team: 1 | 2) => {
    const teamPlayerObjs = teamPlayerIds.map((id) => players.find((p) => p.id === id)).filter(Boolean) as Player[];
    if (teamPlayerObjs.length === 0) return [];
    const opponentCurrentPicks = team === 1 ? team2Picks : team1Picks;

    // Separate own team's picks (locked) from opponent/other picks (banned)
    const ownTeamPicks: Record<number, string> = {};
    const otherPicks: string[] = [];
    const opponentIds = new Set(team === 1 ? team2PlayerIds : team1PlayerIds);
    for (const [pidStr, champId] of Object.entries(picks)) {
      const pid = Number(pidStr);
      if (teamPlayerIds.includes(pid)) {
        ownTeamPicks[pid] = champId;
      } else if (opponentIds.has(pid)) {
        otherPicks.push(champId);
      }
    }

    const recs = generateRecommendations({
      teamPlayers: teamPlayerObjs,
      bannedChampions: [...Array.from(allBannedIds), ...otherPicks],
      allChampions: champions, proficiencies: mergedProficiencies, format,
      opponentPicks: opponentCurrentPicks.length > 0 ? opponentCurrentPicks : undefined,
      matchData,
      lockedPicks: Object.keys(ownTeamPicks).length > 0 ? ownTeamPicks : undefined,
    }).slice(0, 10);
    if (wrStats) {
      for (const rec of recs) {
        rec.estimatedWinrate = estimateCompWinrate(rec.assignments, wrStats, rec.score);
      }
    }
    return recs;
  };

  // Per-player top champions
  const getPlayerRecs = (playerId: number) => {
    const profMap = mergedProficiencies[playerId] ?? new Map();
    return getPlayerTopChampions(playerId, profMap, availableChampions.filter((c) => !pickedIds.has(c.id) || picks[playerId] === c.id), 7);
  };

  // Handle champion click from grid
  const handleChampionSelect = (champId: string) => {
    if (!activeSlot) return;
    setSearch(''); // clear search on any selection
    if (activeSlot.type === 'ban') {
      const bans = [...getTeamBans(activeSlot.team)];
      bans[activeSlot.index] = champId;
      setTeamBans(activeSlot.team, bans);
      advanceBanSlot(activeSlot.team, activeSlot.index);
    } else {
      setPicks((prev) => ({ ...prev, [activeSlot.playerId]: champId }));
      // If this is my pick, send to LoL client
      if (lcu.connected && activeSlot.playerId === userId) {
        const numId = champIdToNumeric.get(champId);
        if (numId) lcu.hoverChampion(numId);
      }
      // Stay on same player until lock-in (don't auto-advance)
    }
  };

  const resetRound = () => {
    setTeam1Bans(Array(team1PlayerIds.length).fill(''));
    setTeam2Bans(Array(team2PlayerIds.length).fill(''));
    setPicks({});
    setLockedPicks(new Set());
    setSwapFirst(null);
    setPhase('ban');
    setActiveSlot({ type: 'ban', team: 1, index: 0 });
    setSearch('');
    // Pause LCU sync so it doesn't re-apply old state
    setLcuPaused(true);
  };

  // Auto-reset when LCU champion select ends (went back to lobby)
  useEffect(() => {
    if (lcu.connected && !lcu.champSelectActive) {
      // Champ select ended — only reset if we had picks (a round was in progress)
      const hadPicks = Object.keys(picks).length > 0 || team1Bans.some(b => b) || team2Bans.some(b => b);
      if (hadPicks) {
        resetRound();
      }
    }
  }, [lcu.champSelectActive]);

  const handleSkipBan = () => {
    if (!activeSlot || activeSlot.type !== 'ban') return;
    const bans = [...getTeamBans(activeSlot.team)];
    bans[activeSlot.index] = SKIP_BAN;
    setTeamBans(activeSlot.team, bans);
    advanceBanSlot(activeSlot.team, activeSlot.index);
  };

  const advanceBanSlot = (team: 1 | 2, index: number) => {
    // Use latest state by reading from the setter callbacks
    // Build snapshot of what bans look like AFTER current assignment
    const currentT1 = [...team1Bans];
    const currentT2 = [...team2Bans];
    if (team === 1) currentT1[index] = 'filled';
    else currentT2[index] = 'filled';

    // Check T1 next empty
    const nextT1 = currentT1.findIndex((b) => !b);
    // Check T2 next empty
    const nextT2 = currentT2.findIndex((b) => !b);

    if (nextT1 >= 0) { setActiveSlot({ type: 'ban', team: 1, index: nextT1 }); return; }
    if (nextT2 >= 0) { setActiveSlot({ type: 'ban', team: 2, index: nextT2 }); return; }

    // All bans done, switch to pick phase
    setPhase('pick');
    const firstInDraft = draftOrder.find((id) => !picks[id]);
    setActiveSlot(firstInDraft ? { type: 'pick', playerId: firstInDraft } : null);
  };

  const advancePickSlot = (currentPlayerId: number) => {
    // Follow draft order: find next unpicked player after current in draft sequence
    const currentDraftIdx = draftOrder.indexOf(currentPlayerId);
    for (let i = 1; i < draftOrder.length; i++) {
      const nextId = draftOrder[(currentDraftIdx + i) % draftOrder.length];
      if (!picks[nextId] && nextId !== currentPlayerId) {
        setActiveSlot({ type: 'pick', playerId: nextId });
        return;
      }
    }
    setActiveSlot(null);
  };

  const allPicked = [...team1PlayerIds, ...team2PlayerIds].every((id) => picks[id]);
  const allLocked = [...team1PlayerIds, ...team2PlayerIds].every((id) => lockedPicks.has(id));
  const canConfirm = allPicked && allLocked;

  // Swap
  const [swapFirst, setSwapFirst] = useState<number | null>(null);
  const swapMode = swapFirst !== null;

  const handleSwapClick = (pid: number) => {
    if (swapFirst === null) {
      setSwapFirst(pid);
    } else {
      if (swapFirst !== pid) {
        setPicks((prev) => ({ ...prev, [swapFirst]: prev[pid], [pid]: prev[swapFirst] }));
      }
      setSwapFirst(null);
    }
  };

  const lockPick = (playerId: number) => {
    if (!picks[playerId]) return;
    setLockedPicks((prev) => new Set(prev).add(playerId));
    // If this is my pick, lock in on LoL client too
    if (lcu.connected && playerId === userId) {
      const numId = champIdToNumeric.get(picks[playerId]);
      if (numId) lcu.lockInChampion(numId);
    }
    advancePickSlot(playerId);
  };

  const unlockPick = (playerId: number) => {
    setLockedPicks((prev) => { const n = new Set(prev); n.delete(playerId); return n; });
  };

  // Apply comp recommendation
  const applyComp = (comp: RecommendedComp) => {
    const newPicks = { ...picks };
    for (const a of comp.assignments) { newPicks[a.playerId] = a.championId; }
    setPicks(newPicks);
  };

  const handleConfirm = () => {
    const banResult: Record<1 | 2, string[]> = {
      1: team1Bans.filter((b) => b && b !== SKIP_BAN),
      2: team2Bans.filter((b) => b && b !== SKIP_BAN),
    };
    onConfirm({ bans: banResult, picks });
  };

  // Grid champions filtered
  const gridChampions = useMemo(() => {
    let list = champions.filter((c) => !fierlessBans.includes(c.id));
    if (search) {
      list = list.filter((c) => c.nameKo.includes(search) || c.id.toLowerCase().includes(search.toLowerCase()));
    }
    const tierOrder: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };
    const profOrder: Record<string, number> = { 'S': 0, '상': 1, '중': 2, '하': 3, '없음': 4 };
    const isDisabled = (c: Champion) => allBannedIds.has(c.id) || pickedIds.has(c.id);

    const mode = sortMode === 'auto' ? (phase === 'pick' ? 'proficiency' : 'tier') : sortMode;

    list.sort((a, b) => {
      const dA = isDisabled(a) ? 1 : 0;
      const dB = isDisabled(b) ? 1 : 0;
      if (dA !== dB) return dA - dB;

      if (mode === 'name') return a.nameKo.localeCompare(b.nameKo, 'ko');
      if (mode === 'winrate') return b.aramWinrate - a.aramWinrate;
      if (mode === 'proficiency' && activeSlot?.type === 'pick') {
        // Use merged proficiencies (manual + estimated)
        const profMap = mergedProficiencies[activeSlot.playerId] ?? new Map();
        const pA = profOrder[profMap.get(a.id) ?? '없음'] ?? 3;
        const pB = profOrder[profMap.get(b.id) ?? '없음'] ?? 3;
        if (pA !== pB) return pA - pB;
      }
      if (mode === 'tier' && activeSlot?.type === 'ban') {
        // In ban phase, sort by opponent proficiency (highest threat first)
        const opponentIds = activeSlot.team === 1 ? team2PlayerIds : team1PlayerIds;
        const bestProfA = Math.min(...opponentIds.map((pid) => profOrder[(mergedProficiencies[pid] ?? new Map()).get(a.id) ?? '없음'] ?? 3));
        const bestProfB = Math.min(...opponentIds.map((pid) => profOrder[(mergedProficiencies[pid] ?? new Map()).get(b.id) ?? '없음'] ?? 3));
        if (bestProfA !== bestProfB) return bestProfA - bestProfB;
      }
      return (tierOrder[a.aramTier] ?? 3) - (tierOrder[b.aramTier] ?? 3);
    });
    return list;
  }, [champions, fierlessBans, search, allBannedIds, pickedIds, activeSlot, mergedProficiencies, phase, team1PlayerIds, team2PlayerIds]);

  // --- RENDER ---
  const renderTeamPanel = (team: 1 | 2) => {
    const playerIds = team === 1 ? team1PlayerIds : team2PlayerIds;
    const bans = getTeamBans(team);
    const banRecs = team === 1 ? team1BanRecs : team2BanRecs;
    const compRecs = getCompRecs(playerIds, team);
    const teamColor = team === 1 ? 'blue' : 'red';
    const bgClass = team === 1 ? 'bg-blue-950/20 border-blue-900/40' : 'bg-red-950/20 border-red-900/40';

    return (
      <div className={`w-[360px] shrink-0 rounded-lg border ${bgClass} p-3 space-y-3 overflow-y-auto max-h-[calc(100vh-180px)]`}>
        {/* Team Header */}
        <h3 className={`text-center font-bold text-${teamColor}-400`}>Team {team}</h3>

        {/* Ban Slots */}
        <div>
          <div className="text-xs text-lol-gold-light/50 mb-1.5">밴 ({bans.filter((b) => b && b !== SKIP_BAN).length})</div>
          <div className="flex gap-1.5 flex-wrap">
            {bans.map((banId, idx) => {
              const isActive = activeSlot?.type === 'ban' && activeSlot.team === team && activeSlot.index === idx;
              const champ = banId && banId !== SKIP_BAN ? champions.find((c) => c.id === banId) : null;
              const isSkipped = banId === SKIP_BAN;
              return (
                <div
                  key={idx}
                  onClick={() => {
                    if (isSkipped || champ) {
                      const newBans = [...bans]; newBans[idx] = '';
                      setTeamBans(team, newBans);
                    }
                    setActiveSlot({ type: 'ban', team, index: idx });
                    setPhase('ban');
                  }}
                  className={`cursor-pointer w-10 h-10 rounded border-2 flex items-center justify-center transition-all ${
                    isActive ? 'border-lol-gold shadow-[0_0_8px_rgba(200,155,60,0.5)]'
                    : champ ? 'border-red-800/60'
                    : isSkipped ? 'border-gray-700 bg-gray-800/30'
                    : 'border-dashed border-gray-600 bg-lol-dark/30'
                  }`}
                >
                  {champ ? <img src={champ.imageUrl} className="w-full h-full rounded opacity-50 grayscale" />
                   : isSkipped ? <span className="text-[10px] text-gray-500">없음</span>
                   : <span className="text-gray-600 text-lg">+</span>}
                </div>
              );
            })}
          </div>
          {phase === 'ban' && activeSlot?.type === 'ban' && activeSlot.team === team && (
            <button onClick={handleSkipBan} className="cursor-pointer text-[10px] text-gray-500 hover:text-gray-400 mt-1">
              밴 없음
            </button>
          )}
        </div>

        {/* Ban Recommendations — per opponent player */}
        {phase === 'ban' && Object.keys(banRecs).length > 0 && (
          <div>
            <div className="text-xs text-lol-gold-light/50 mb-1.5">추천 밴 (상대 플레이어별)</div>
            <div className="space-y-1.5">
              {(team === 1 ? team2PlayerIds : team1PlayerIds).map((oppId) => {
                const recs = banRecs[oppId];
                if (!recs || recs.length === 0) return null;
                const canClick = activeSlot?.type === 'ban' && activeSlot.team === team;
                return (
                  <div key={oppId} className="flex items-center gap-1.5">
                    <span className="text-[10px] text-lol-gold-light/40 shrink-0 w-8 truncate">{getPlayerName(oppId)}</span>
                    <div className="flex gap-1 overflow-x-auto">
                      {recs.map((rec) => {
                        const champ = champions.find((c) => c.id === rec.championId);
                        if (!champ) return null;
                        const isBanned = allBannedIds.has(champ.id);
                        return (
                          <ChampionWithHover key={rec.championId} champion={champ} wrStats={wrStats}
                            allPlayers={players} proficiencies={proficiencies} estimatedMap={estimatedMap}
                            highlightPlayerIds={[oppId]} disabled={isBanned}>
                            <div
                              title={rec.reason ? `${champ.nameKo}: ${rec.reason}` : champ.nameKo}
                              onClick={() => canClick && !isBanned && handleChampionSelect(rec.championId)}
                              className={`shrink-0 ${canClick && !isBanned ? 'cursor-pointer hover:opacity-100' : ''} ${isBanned ? 'opacity-20' : 'opacity-70'}`}>
                              <ChampionIcon champion={champ} size="sm" disabled={isBanned} />
                            </div>
                          </ChampionWithHover>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Comp Recommendations */}
        {compRecs.length > 0 && (
          <div>
            <div className="text-xs text-lol-gold-light/50 mb-1">추천 조합 ({compRecs.length})</div>
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
              {compRecs.map((comp, i) => (
                <div key={i} onClick={() => applyComp(comp)}
                  className="cursor-pointer p-1.5 rounded border border-lol-border hover:border-lol-gold/50 bg-lol-dark/30 transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-lol-gold">{comp.archetypeName}</span>
                    <div className="flex items-center gap-1.5">
                      {comp.estimatedWinrate != null && (
                        <span className={`text-[10px] font-mono ${comp.estimatedWinrate >= 55 ? 'text-prof-high' : comp.estimatedWinrate >= 45 ? 'text-lol-gold' : 'text-prof-low'}`}>
                          {Math.round(comp.estimatedWinrate)}%
                        </span>
                      )}
                      <span className="text-[10px] text-lol-gold-light/50 font-mono">{Math.round(comp.score * 100)}</span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {comp.assignments.map((a) => {
                      const c = champions.find((ch) => ch.id === a.championId);
                      return c ? <ChampionIcon key={a.playerId} champion={c} size="sm" /> : null;
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Counter Picks — show when opponent has picks */}
        {phase === 'pick' && (() => {
          const oppPicks = team === 1 ? team2Picks : team1Picks;
          if (oppPicks.length === 0) return null;
          // Determine opponent comp archetype for counter suggestion
          const oppRoles = oppPicks.map((cid) => champions.find((c) => c.id === cid)?.aramRole).filter(Boolean);
          const pokeCount = oppRoles.filter((r) => r === 'poke').length;
          const engageCount = oppRoles.filter((r) => r === 'engage' || r === 'tank').length;
          const sustainCount = oppRoles.filter((r) => r === 'sustain' || r === 'utility').length;
          let counterType = '밸런스';
          let counterTip = '';
          if (pokeCount >= 2) { counterType = '인게이지'; counterTip = '상대 포크 다수 → 인게이지로 카운터'; }
          else if (engageCount >= 2) { counterType = '서스테인'; counterTip = '상대 인게이지 다수 → 서스테인으로 카운터'; }
          else if (sustainCount >= 2) { counterType = '포크'; counterTip = '상대 서스테인 다수 → 포크로 카운터'; }
          else { counterTip = '상대 밸런스 조합 → 유연한 대응 추천'; }
          return (
            <div className="p-2 bg-lol-dark/40 rounded border border-lol-border/50">
              <div className="text-[10px] text-lol-gold-light/50 mb-1">상대 카운터</div>
              <div className="flex flex-wrap gap-1 mb-1.5">
                {oppPicks.map((cid) => {
                  const c = champions.find((ch) => ch.id === cid);
                  return c ? <ChampionIcon key={cid} champion={c} size="sm" /> : null;
                })}
              </div>
              <div className="text-[10px]">
                <span className="text-lol-gold font-medium">{counterType}</span>
                <span className="text-lol-gold-light/40 ml-1">{counterTip}</span>
              </div>
            </div>
          );
        })()}

        {/* Player Rows */}
        <div className="space-y-2">
          {playerIds.map((pid) => {
            const isActive = activeSlot?.type === 'pick' && activeSlot.playerId === pid;
            const isLocked = lockedPicks.has(pid);
            const pickedChamp = picks[pid] ? champions.find((c) => c.id === picks[pid]) : null;
            const recs = getPlayerRecs(pid);
            const pStats = wrStats?.playerOverallStats[pid];
            // Player's stats with picked champion
            const champStat = pickedChamp && wrStats
              ? wrStats.playerChampStats.find((s) => s.playerId === pid && s.championId === pickedChamp.id)
              : null;

            return (
              <div key={pid}
                onClick={() => {
                  if (!isLocked) { setActiveSlot({ type: 'pick', playerId: pid }); setPhase('pick'); }
                }}
                className={`p-2 rounded border transition-all ${
                  swapFirst === pid ? 'border-purple-500 bg-purple-950/30 ring-1 ring-purple-500/50'
                  : isLocked ? 'border-prof-high/50 bg-prof-high/5'
                  : isActive ? 'border-lol-gold bg-lol-gold/10 cursor-pointer'
                  : 'border-lol-border/50 hover:border-lol-gold/30 cursor-pointer'
                }`}>
                {/* Player header with stats */}
                <div className="flex items-center gap-2 mb-1">
                  {pickedChamp ? (
                    <ChampionIcon champion={pickedChamp} size="md" selected={isActive && !isLocked} />
                  ) : (
                    <div className={`w-12 h-12 rounded border-2 border-dashed flex items-center justify-center ${isActive ? 'border-lol-gold' : 'border-gray-600'}`}>
                      <span className="text-gray-500 text-sm">?</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-lol-gold-light font-medium truncate">{getPlayerName(pid)}</span>
                      {isLocked && <span className="text-[10px] text-prof-high">LOCKED</span>}
                    </div>
                    <div className="flex items-center gap-2 text-[10px]">
                      {pStats && pStats.totalPicks > 0 && (
                        <>
                          <span className={`font-mono ${pStats.winrate >= 55 ? 'text-prof-high' : pStats.winrate >= 45 ? 'text-lol-gold-light/60' : 'text-prof-low'}`}>
                            {Math.round(pStats.winrate)}%
                          </span>
                          <span className="text-lol-gold-light/40">
                            {pStats.wins}W {pStats.losses}L
                          </span>
                          <span className="text-lol-gold-light/30">({pStats.totalPicks}게임)</span>
                        </>
                      )}
                      {pickedChamp && champStat && (
                        <span className="text-lol-gold-light/50">
                          | {pickedChamp.nameKo} {champStat.wins}W{champStat.losses}L
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Lock-in + Swap buttons */}
                  <div className="flex gap-1 shrink-0">
                    {pickedChamp && !isLocked && (
                      <button
                        onClick={(e) => { e.stopPropagation(); lockPick(pid); }}
                        className="cursor-pointer px-2 py-1 text-[10px] rounded bg-prof-high/20 text-prof-high border border-prof-high/40 hover:bg-prof-high/30 transition-colors"
                      >
                        락인
                      </button>
                    )}
                    {isLocked && (
                      <button
                        onClick={(e) => { e.stopPropagation(); unlockPick(pid); }}
                        className="cursor-pointer px-2 py-1 text-[10px] rounded bg-lol-gray text-lol-gold-light/50 border border-lol-border hover:text-lol-gold-light transition-colors"
                      >
                        해제
                      </button>
                    )}
                    {/* Swap button */}
                    {pickedChamp && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSwapClick(pid);
                        }}
                        className={`cursor-pointer px-2 py-1 text-[10px] rounded border transition-colors ${
                          swapFirst === pid
                            ? 'bg-purple-900/50 text-purple-300 border-purple-600 ring-1 ring-purple-500/50'
                            : 'bg-lol-gray text-lol-gold-light/40 border-lol-border hover:text-purple-300 hover:border-purple-600'
                        }`}
                        title={swapFirst === pid ? '스왑 대상을 선택하세요' : swapFirst ? '이 플레이어와 스왑' : '스왑'}
                      >
                        {swapFirst === pid ? '...' : '↔'}
                      </button>
                    )}
                  </div>
                </div>
                {/* Top champions with pick rate bars */}
                {!isLocked && (
                  <div className="flex flex-wrap gap-0.5 mt-1">
                    {recs.map((c) => {
                      const cs = wrStats?.playerChampStats.find((s) => s.playerId === pid && s.championId === c.id);
                      const isUnavailable = pickedIds.has(c.id) && picks[pid] !== c.id;
                      return (
                        <ChampionWithHover key={c.id} champion={c} wrStats={wrStats}
                          allPlayers={players} proficiencies={proficiencies} estimatedMap={estimatedMap}
                          highlightPlayerIds={team1PlayerIds.includes(pid) ? team2PlayerIds : team1PlayerIds}
                          disabled={isUnavailable}>
                          <div
                            onClick={(e) => { e.stopPropagation(); if (!isLocked) setPicks((prev) => ({ ...prev, [pid]: c.id })); }}
                            className="cursor-pointer relative">
                            <ChampionIcon champion={c} size="base"
                              selected={picks[pid] === c.id}
                              disabled={isUnavailable} />
                            {cs && (cs.wins + cs.losses > 0) && (
                              <div className={`absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[8px] font-mono font-bold px-0.5 rounded bg-lol-dark/80 ${
                                cs.winrate >= 60 ? 'text-prof-high' : cs.winrate >= 40 ? 'text-lol-gold-light/70' : 'text-prof-low'
                              }`}>
                                {Math.round(cs.winrate)}%
                              </div>
                            )}
                          </div>
                        </ChampionWithHover>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Phase indicator + LCU bridge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="text-lol-gold hover:text-lol-gold-light cursor-pointer">&larr;</button>
          <button onClick={() => { if (confirm('이번 라운드의 밴/픽을 초기화하시겠습니까?')) resetRound(); }}
            className="cursor-pointer px-2 py-1 rounded text-[10px] border border-lol-border text-lol-gold-light/40 hover:text-lol-gold-light hover:border-lol-gold/50 transition-colors">
            리셋
          </button>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setPhase('ban'); const idx = team1Bans.findIndex((b) => !b); if (idx >= 0) setActiveSlot({ type: 'ban', team: 1, index: idx }); }}
            className={`cursor-pointer px-3 py-1 rounded text-sm font-medium transition-colors ${phase === 'ban' ? 'bg-red-900/50 text-red-300 border border-red-700' : 'bg-lol-gray text-lol-gold-light/60 border border-lol-border'}`}>
            밴
          </button>
          <button onClick={() => { setPhase('pick'); const first = [...team1PlayerIds, ...team2PlayerIds].find((id) => !picks[id]); if (first) setActiveSlot({ type: 'pick', playerId: first }); }}
            className={`cursor-pointer px-3 py-1 rounded text-sm font-medium transition-colors ${phase === 'pick' ? 'bg-lol-gold/30 text-lol-gold border border-lol-gold/50' : 'bg-lol-gray text-lol-gold-light/60 border border-lol-border'}`}>
            픽
          </button>
        </div>
        <Button onClick={handleConfirm} disabled={!canConfirm || swapMode}>
          {!allPicked ? '픽 미완료' : !allLocked ? `락인 대기 (${lockedPicks.size}/${team1PlayerIds.length + team2PlayerIds.length})` : '게임 시작!'}
        </Button>
      </div>

      {/* Fierless Banner */}
      {fierlessChampions.length > 0 && (
        <div className="p-2 bg-lol-gray/50 rounded border border-lol-border">
          <div className="text-[10px] text-lol-gold-light/40 mb-1 text-center">피어리스 밴 ({fierlessChampions.length})</div>
          <div className="flex flex-wrap gap-1 justify-center">
            {fierlessChampions.map((c) => (
              <div key={c.id} className="w-7 h-7 rounded overflow-hidden opacity-30 grayscale" title={c.nameKo}>
                <img src={c.imageUrl} className="w-full h-full" loading="lazy" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Team Composition Summary: [T1 summary] [win bar] [T2 summary] */}
      {(() => {
        const traitDefs = [
          { label: 'CC', tags: ['aoe_cc', 'knockup', 'pull'], color: 'text-yellow-300 bg-yellow-900/70' },
          { label: '포크', tags: ['poke_long', 'poke_mid'], color: 'text-blue-300 bg-blue-900/70' },
          { label: '힐', tags: ['heal'], color: 'text-green-300 bg-green-900/70' },
          { label: '쉴드', tags: ['shield'], color: 'text-cyan-300 bg-cyan-900/70' },
          { label: '치감', tags: ['anti_heal'], color: 'text-red-300 bg-red-900/70' },
          { label: '탱킹', tags: ['diving'], color: 'text-amber-300 bg-amber-900/70' },
          { label: '탱파', tags: ['tank_shred'], color: 'text-red-300 bg-red-900/70' },
          { label: '버스트', tags: ['burst'], color: 'text-orange-300 bg-orange-900/70' },
        ];

        const getTeamData = (playerIds: number[]) => {
          const pickedChamps = playerIds.map((pid) => picks[pid]).filter(Boolean)
            .map((id) => champions.find((c) => c.id === id)).filter(Boolean);
          let ap = 0, ad = 0, hybrid = 0;
          for (const c of pickedChamps) {
            if (c!.damageType === 'AP') ap++;
            else if (c!.damageType === 'AD') ad++;
            else hybrid++;
          }
          const total = ap + ad + hybrid;
          const apPct = total > 0 ? ((ap + hybrid * 0.5) / total) * 100 : 50;
          const tagCounts = new Map<string, number>();
          for (const c of pickedChamps) {
            const traits = championTraits[c!.id];
            if (traits) for (const t of traits.mechanics) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
          }
          const avgWr = pickedChamps.length > 0
            ? pickedChamps.reduce((s, c) => s + c!.aramWinrate, 0) / pickedChamps.length : 50;
          return { apPct, adPct: 100 - apPct, tagCounts, avgWr, count: pickedChamps.length };
        };

        const anyPicks = Object.keys(picks).length > 0;
        if (!anyPicks) return null;

        const t1 = getTeamData(team1PlayerIds);
        const t2 = getTeamData(team2PlayerIds);
        const wrTotal = t1.avgWr + t2.avgWr;
        const t1Pct = wrTotal > 0 ? Math.round((t1.avgWr / wrTotal) * 100) : 50;
        const t2Pct = 100 - t1Pct;
        const t1Winning = t1Pct >= t2Pct;

        const renderSummary = (data: ReturnType<typeof getTeamData>, team: 1 | 2) => {
          if (data.count === 0) return <div className="w-[360px] shrink-0 text-center text-xs text-lol-gold-light/20 py-2">픽 대기중</div>;
          const teamColor = team === 1 ? 'blue' : 'red';
          return (
            <div className="w-[360px] shrink-0 space-y-1.5">
              <div className={`text-xs text-${teamColor}-400 font-bold text-center`}>Team {team}</div>
              <div>
                <div className="flex justify-between text-[10px] text-lol-gold-light/50 mb-0.5">
                  <span>AP {Math.round(data.apPct)}%</span>
                  <span>AD {Math.round(data.adPct)}%</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden flex bg-lol-dark/50">
                  <div className="bg-blue-500/70 transition-all" style={{ width: `${data.apPct}%` }} />
                  <div className="bg-red-500/70 transition-all" style={{ width: `${data.adPct}%` }} />
                </div>
              </div>
              <div className="flex flex-wrap gap-1 justify-center">
                {traitDefs.map((t) => {
                  const present = t.tags.some((tag) => data.tagCounts.has(tag));
                  return (
                    <span key={t.label} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${present ? t.color : 'text-gray-600 bg-lol-dark/40 line-through'}`}>
                      {t.label}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        };

        return (
          <div className="flex items-start gap-3">
            {renderSummary(t1, 1)}
            {/* Win probability — centered between the two team summaries */}
            <div className="flex-1 min-w-0 flex flex-col items-center justify-center pt-4">
              <div className="w-full max-w-[280px]">
                <div className="flex justify-between items-center text-xs mb-1">
                  <span className={`font-bold font-mono ${t1Winning ? 'text-green-400' : 'text-blue-400/60'}`}>
                    {t1Pct}%
                  </span>
                  <span className="text-lol-gold-light/30 text-[10px]">승리 예측</span>
                  <span className={`font-bold font-mono ${!t1Winning ? 'text-green-400' : 'text-red-400/60'}`}>
                    {t2Pct}%
                  </span>
                </div>
                <div className="h-2.5 rounded-full overflow-hidden flex bg-lol-dark/50">
                  <div className={`${t1Winning ? 'bg-green-500/80' : 'bg-blue-500/40'} transition-all`} style={{ width: `${t1Pct}%` }} />
                  <div className={`${!t1Winning ? 'bg-green-500/80' : 'bg-red-500/40'} transition-all`} style={{ width: `${t2Pct}%` }} />
                </div>
              </div>
            </div>
            {renderSummary(t2, 2)}
          </div>
        );
      })()}

      {/* Main 3-column layout */}
      <div className="flex gap-3">
        {/* Team 1 */}
        {renderTeamPanel(1)}

        {/* Center: Champion Grid */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && search && activeSlot) {
                    const first = gridChampions.find((c) => !allBannedIds.has(c.id) && !pickedIds.has(c.id));
                    if (first) { handleChampionSelect(first.id); setSearch(''); }
                  }
                }}
                placeholder="검색 후 Enter로 즉시 선택..."
                className="w-full bg-lol-blue border border-lol-border rounded px-3 py-1.5 pr-8 text-sm text-lol-gold-light placeholder:text-lol-gold-light/30 focus:outline-none focus:border-lol-gold"
                autoFocus
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-lol-gold-light/40 hover:text-lol-gold-light cursor-pointer text-sm"
                >
                  &times;
                </button>
              )}
            </div>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as any)}
              className="bg-lol-blue border border-lol-border rounded px-2 py-1.5 text-xs text-lol-gold-light cursor-pointer"
            >
              <option value="auto">자동 정렬</option>
              <option value="tier">티어순</option>
              <option value="name">이름순</option>
              <option value="winrate">승률순</option>
            </select>
            {/* Skip ban is now in the champion grid as an X card */}
          </div>
          <div className="text-xs text-center space-y-1">
            <div className="text-lol-gold-light/40">
              {activeSlot
                ? activeSlot.type === 'ban'
                  ? `Team ${activeSlot.team} 밴 선택 중`
                  : `${getPlayerName(activeSlot.playerId)} 챔피언 선택 중`
                : '슬롯을 클릭하세요'}
            </div>
            {phase === 'pick' && (
              <div className="flex items-center justify-center gap-1 text-[10px]">
                <span className="text-lol-gold-light/30">드래프트:</span>
                {draftOrder.map((pid, i) => {
                  const isPicked = !!picks[pid];
                  const isCurrent = activeSlot?.type === 'pick' && activeSlot.playerId === pid;
                  const isT1 = team1PlayerIds.includes(pid);
                  return (
                    <span key={i} className={`px-1 rounded ${
                      isCurrent ? 'bg-lol-gold text-lol-dark font-bold'
                      : isPicked ? 'text-lol-gold-light/20 line-through'
                      : isT1 ? 'text-blue-400' : 'text-red-400'
                    }`}>
                      {getPlayerName(pid).slice(0, 2)}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          <div className="grid grid-cols-6 sm:grid-cols-7 md:grid-cols-9 lg:grid-cols-11 gap-px max-h-[calc(100vh-320px)] overflow-y-auto">
            {/* Skip Ban card — shown first in ban phase */}
            {phase === 'ban' && activeSlot?.type === 'ban' && (
              <div
                onClick={handleSkipBan}
                className="cursor-pointer w-full aspect-square rounded border-2 border-dashed border-gray-600 bg-gray-800/40 flex flex-col items-center justify-center hover:border-gray-400 hover:bg-gray-700/40 transition-colors"
                title="밴 없음"
              >
                <span className="text-gray-400 text-lg font-bold">✕</span>
                <span className="text-[8px] text-gray-500">밴 없음</span>
              </div>
            )}
            {gridChampions.map((champ) => {
              const isBanned = allBannedIds.has(champ.id);
              const isPicked = pickedIds.has(champ.id);
              const disabled = isBanned || isPicked;
              const profLevel = activeSlot?.type === 'pick'
                ? mergedProficiencies[activeSlot.playerId]?.get(champ.id) : undefined;

              // Opponent winrate for this champion
              const opponentIds = activeSlot?.type === 'ban'
                ? (activeSlot.team === 1 ? team2PlayerIds : team1PlayerIds)
                : (activeSlot?.type === 'pick'
                  ? (team1PlayerIds.includes(activeSlot.playerId) ? team2PlayerIds : team1PlayerIds)
                  : []);
              let oppWr: string | null = null;
              let oppTooltipParts: string[] = [];
              if (wrStats && opponentIds.length > 0) {
                const oppStats = wrStats.playerChampStats.filter(
                  (s) => s.championId === champ.id && opponentIds.includes(s.playerId)
                );
                if (oppStats.length > 0) {
                  const totalW = oppStats.reduce((a, s) => a + s.wins, 0);
                  const totalL = oppStats.reduce((a, s) => a + s.losses, 0);
                  if (totalW + totalL > 0) {
                    oppWr = `${Math.round((totalW / (totalW + totalL)) * 100)}%`;
                  }
                  oppTooltipParts = oppStats.map((s) => {
                    const name = getPlayerName(s.playerId);
                    return `${name}: ${s.wins}승 ${s.losses}패 (${Math.round(s.winrate)}%)`;
                  });
                }
                // Also show proficiency info in tooltip
                for (const oid of opponentIds) {
                  const prof = proficiencies[oid]?.get(champ.id);
                  if (prof && prof !== '없음' && !oppStats.some((s) => s.playerId === oid)) {
                    oppTooltipParts.push(`${getPlayerName(oid)}: 숙련도 ${prof}`);
                  }
                }
              }

              return (
                <ChampionWithHover
                  key={champ.id}
                  champion={champ}
                  wrStats={wrStats}
                  allPlayers={players}
                  proficiencies={proficiencies}
                  estimatedMap={estimatedMap}
                  highlightPlayerIds={opponentIds}
                  disabled={disabled}
                >
                  <div
                    onClick={() => !disabled && handleChampionSelect(champ.id)}
                    className={`flex flex-col items-center gap-0.5 p-0.5 rounded border transition-colors ${
                      disabled
                        ? 'border-transparent opacity-20 cursor-not-allowed'
                        : 'border-lol-border hover:border-lol-gold cursor-pointer bg-lol-blue/50'
                    }`}
                  >
                    <div className="w-11 h-11 rounded overflow-hidden">
                      <img src={champ.imageUrl} className={`w-full h-full ${disabled ? 'grayscale' : ''}`} loading="lazy" />
                    </div>
                    <span className="text-[9px] text-lol-gold-light/60 text-center leading-tight truncate w-full">
                      {champ.nameKo}
                    </span>
                    {profLevel && profLevel !== '없음' && (
                      <ProficiencyBadge level={profLevel} size="sm" />
                    )}
                    {oppWr && !disabled && (
                      <span className={`text-[9px] font-mono ${
                        parseInt(oppWr) >= 60 ? 'text-prof-low' : parseInt(oppWr) >= 40 ? 'text-lol-gold-light/50' : 'text-prof-high'
                      }`}>
                        vs {oppWr}
                      </span>
                    )}
                  </div>
                </ChampionWithHover>
              );
            })}
          </div>
        </div>

        {/* Team 2 */}
        {renderTeamPanel(2)}
      </div>
    </div>
  );
}
