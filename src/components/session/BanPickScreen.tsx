import { useState, useMemo, useEffect } from 'react';
import type { Champion, Player, ProficiencyLevel } from '@/lib/db';
import type { RecommendedComp } from '@/lib/recommendation/types';
import { generateRecommendations, generatePerPlayerBanRecs, getPlayerTopChampions } from '@/lib/recommendation/engine';
import { computeWinrateStats, estimateCompWinrate, type WinrateStats } from '@/lib/recommendation/winrate';
import { loadSynergyCounterData, type SynergyCounterData } from '@/lib/recommendation/data-loader';
import { championTraits } from '@/data/champion-tags';
import { ChampionIcon } from '@/components/champions/ChampionIcon';
import { ChampionWithHover } from '@/components/champions/ChampionWithHover';
import { ProficiencyBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

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
}

type ActiveSlot =
  | { type: 'ban'; team: 1 | 2; index: number }
  | { type: 'pick'; playerId: number }
  | null;

const SKIP_BAN = '__SKIP__';

export function BanPickScreen({
  format, team1PlayerIds, team2PlayerIds, players, champions,
  fierlessBans, proficiencies, onConfirm, onBack,
}: BanPickScreenProps) {
  const team1Size = team1PlayerIds.length;
  const team2Size = team2PlayerIds.length;

  // Ban state: each team bans as many as the OPPONENT team's player count
  const [team1Bans, setTeam1Bans] = useState<string[]>(Array(team2Size).fill(''));
  const [team2Bans, setTeam2Bans] = useState<string[]>(Array(team1Size).fill(''));
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [activeSlot, setActiveSlot] = useState<ActiveSlot>({ type: 'ban', team: 1, index: 0 });
  const [search, setSearch] = useState('');
  const [phase, setPhase] = useState<'ban' | 'pick'>('ban');
  const [lockedPicks, setLockedPicks] = useState<Set<number>>(new Set());
  const [sortMode, setSortMode] = useState<'auto' | 'name' | 'tier' | 'winrate'>('auto');
  const [wrStats, setWrStats] = useState<WinrateStats | null>(null);
  const [matchData, setMatchData] = useState<SynergyCounterData | null>(null);

  useEffect(() => { computeWinrateStats().then(setWrStats); }, []);
  useEffect(() => { loadSynergyCounterData().then(setMatchData); }, []);

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
    for (const pid of team1PlayerIds) { if (proficiencies[pid]) m[pid] = proficiencies[pid]; }
    return m;
  }, [team1PlayerIds, proficiencies]);
  const team2OurProfs = useMemo(() => {
    const m: Record<number, Map<string, any>> = {};
    for (const pid of team2PlayerIds) { if (proficiencies[pid]) m[pid] = proficiencies[pid]; }
    return m;
  }, [team2PlayerIds, proficiencies]);

  const team1BanRecs = useMemo(() => generatePerPlayerBanRecs({
    opponentPlayerIds: team2PlayerIds,
    opponentPlayerNames: Object.fromEntries(players.map((p) => [p.id!, p.name])),
    proficiencies, allChampions: champions, alreadyBanned: alreadyBannedAll,
    ourTeamProficiencies: team1OurProfs,
  }), [team2PlayerIds, players, proficiencies, champions, alreadyBannedAll, team1OurProfs]);

  const team2BanRecs = useMemo(() => generatePerPlayerBanRecs({
    opponentPlayerIds: team1PlayerIds,
    opponentPlayerNames: Object.fromEntries(players.map((p) => [p.id!, p.name])),
    proficiencies, allChampions: champions, alreadyBanned: alreadyBannedAll,
    ourTeamProficiencies: team2OurProfs,
  }), [team1PlayerIds, players, proficiencies, champions, alreadyBannedAll, team2OurProfs]);

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
    if (teamPlayerObjs.length < 3) return [];
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
      allChampions: champions, proficiencies, format,
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
    const profMap = proficiencies[playerId] ?? new Map();
    return getPlayerTopChampions(playerId, profMap, availableChampions.filter((c) => !pickedIds.has(c.id) || picks[playerId] === c.id), 7);
  };

  // Handle champion click from grid
  const handleChampionSelect = (champId: string) => {
    if (!activeSlot) return;
    if (activeSlot.type === 'ban') {
      const bans = [...getTeamBans(activeSlot.team)];
      bans[activeSlot.index] = champId;
      setTeamBans(activeSlot.team, bans);
      advanceBanSlot(activeSlot.team, activeSlot.index);
    } else {
      setPicks((prev) => ({ ...prev, [activeSlot.playerId]: champId }));
      advancePickSlot(activeSlot.playerId);
    }
  };

  const handleSkipBan = () => {
    if (!activeSlot || activeSlot.type !== 'ban') return;
    const bans = [...getTeamBans(activeSlot.team)];
    bans[activeSlot.index] = SKIP_BAN;
    setTeamBans(activeSlot.team, bans);
    advanceBanSlot(activeSlot.team, activeSlot.index);
  };

  const advanceBanSlot = (team: 1 | 2, index: number) => {
    // Find next empty ban slot
    const allBans = team === 1 ? [...team1Bans] : [...team2Bans];
    allBans[index] = 'filled'; // mark current
    const otherBans = team === 1 ? team2Bans : team1Bans;
    const otherTeam = team === 1 ? 2 : 1;

    // Check same team next slot
    const nextSame = allBans.findIndex((b, i) => i > index && !b);
    if (nextSame >= 0) { setActiveSlot({ type: 'ban', team, index: nextSame }); return; }

    // Check other team
    const nextOther = otherBans.findIndex((b) => !b);
    if (nextOther >= 0) { setActiveSlot({ type: 'ban', team: otherTeam as 1 | 2, index: nextOther }); return; }

    // Check same team from start
    const nextFromStart = allBans.findIndex((b) => !b);
    if (nextFromStart >= 0) { setActiveSlot({ type: 'ban', team, index: nextFromStart }); return; }

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
    const profOrder: Record<string, number> = { '상': 0, '중': 1, '하': 2, '없음': 3 };
    const isDisabled = (c: Champion) => allBannedIds.has(c.id) || pickedIds.has(c.id);

    const mode = sortMode === 'auto' ? (phase === 'pick' ? 'proficiency' : 'tier') : sortMode;

    list.sort((a, b) => {
      const dA = isDisabled(a) ? 1 : 0;
      const dB = isDisabled(b) ? 1 : 0;
      if (dA !== dB) return dA - dB;

      if (mode === 'name') return a.nameKo.localeCompare(b.nameKo, 'ko');
      if (mode === 'winrate') return b.aramWinrate - a.aramWinrate;
      if (mode === 'proficiency' && activeSlot?.type === 'pick') {
        const profMap = proficiencies[activeSlot.playerId] ?? new Map();
        const pA = profOrder[profMap.get(a.id) ?? '없음'] ?? 3;
        const pB = profOrder[profMap.get(b.id) ?? '없음'] ?? 3;
        if (pA !== pB) return pA - pB;
      }
      return (tierOrder[a.aramTier] ?? 3) - (tierOrder[b.aramTier] ?? 3);
    });
    return list;
  }, [champions, fierlessBans, search, allBannedIds, pickedIds, activeSlot, proficiencies]);

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
                            allPlayers={players} proficiencies={proficiencies}
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
        {phase === 'pick' && compRecs.length > 0 && (
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
                          allPlayers={players} proficiencies={proficiencies}
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
      {/* Phase indicator */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-lol-gold hover:text-lol-gold-light cursor-pointer">&larr; 돌아가기</button>
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

      {/* Team Composition Summary — both teams side by side */}
      {(() => {
        const renderTeamSummary = (teamPlayerIds: number[], team: 1 | 2) => {
          const teamPicks = teamPlayerIds.map((pid) => picks[pid]).filter(Boolean);
          const teamChamps = teamPicks.map((id) => champions.find((c) => c.id === id)).filter(Boolean);
          if (teamChamps.length === 0) return <div className="flex-1 text-center text-[10px] text-lol-gold-light/20">픽 대기중</div>;

          let ap = 0, ad = 0, hybrid = 0;
          for (const c of teamChamps) {
            if (c!.damageType === 'AP') ap++;
            else if (c!.damageType === 'AD') ad++;
            else hybrid++;
          }
          const total = ap + ad + hybrid;
          const apPct = total > 0 ? ((ap + hybrid * 0.5) / total) * 100 : 50;
          const adPct = 100 - apPct;

          const tagCounts = new Map<string, number>();
          for (const c of teamChamps) {
            const traits = championTraits[c!.id];
            if (!traits) continue;
            for (const t of traits.mechanics) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
          }

          const traitDisplay = [
            { label: 'CC', present: tagCounts.has('aoe_cc') || tagCounts.has('knockup') || tagCounts.has('pull'), color: 'text-yellow-300 bg-yellow-800/60' },
            { label: '포크', present: tagCounts.has('poke_long') || tagCounts.has('poke_mid'), color: 'text-blue-300 bg-blue-800/60' },
            { label: '힐', present: tagCounts.has('heal'), color: 'text-green-300 bg-green-800/60' },
            { label: '쉴드', present: tagCounts.has('shield'), color: 'text-cyan-300 bg-cyan-800/60' },
            { label: '치감', present: tagCounts.has('anti_heal'), color: 'text-red-300 bg-red-800/60' },
            { label: '탱킹', present: tagCounts.has('diving'), color: 'text-amber-300 bg-amber-800/60' },
            { label: '탱파', present: tagCounts.has('tank_shred'), color: 'text-red-300 bg-red-800/60' },
            { label: '버스트', present: tagCounts.has('burst'), color: 'text-orange-300 bg-orange-800/60' },
          ];

          const teamColor = team === 1 ? 'blue' : 'red';
          return (
            <div className="flex-1 space-y-1">
              <div className={`text-[10px] text-${teamColor}-400 font-medium text-center`}>Team {team}</div>
              <div>
                <div className="flex justify-between text-[8px] text-lol-gold-light/40 mb-0.5">
                  <span>AP {Math.round(apPct)}%</span>
                  <span>AD {Math.round(adPct)}%</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden flex bg-lol-dark/50">
                  <div className="bg-blue-500/70 transition-all" style={{ width: `${apPct}%` }} />
                  <div className="bg-red-500/70 transition-all" style={{ width: `${adPct}%` }} />
                </div>
              </div>
              <div className="flex flex-wrap gap-0.5 justify-center">
                {traitDisplay.map((t) => (
                  <span key={t.label} className={`text-[8px] px-1 py-0.5 rounded ${t.present ? t.color : 'text-gray-600 bg-lol-dark/30 line-through'}`}>
                    {t.label}
                  </span>
                ))}
              </div>
            </div>
          );
        };

        const anyPicks = Object.keys(picks).length > 0;
        if (!anyPicks) return null;

        return (
          <div className="flex gap-4 p-2 bg-lol-gray/30 rounded border border-lol-border/30">
            {renderTeamSummary(team1PlayerIds, 1)}
            <div className="w-px bg-lol-border/30" />
            {renderTeamSummary(team2PlayerIds, 2)}
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
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="챔피언 검색..."
              className="flex-1 bg-lol-blue border border-lol-border rounded px-3 py-1.5 text-sm text-lol-gold-light placeholder:text-lol-gold-light/30 focus:outline-none focus:border-lol-gold"
            />
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
                ? proficiencies[activeSlot.playerId]?.get(champ.id) : undefined;

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
