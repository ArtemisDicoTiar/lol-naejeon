import { useState, useMemo, useEffect } from 'react';
import type { Champion, Player, ProficiencyLevel } from '@/lib/db';
import type { RecommendedComp } from '@/lib/recommendation/types';
import { generateRecommendations, generatePerPlayerBanRecs, getPlayerTopChampions } from '@/lib/recommendation/engine';
import { computeWinrateStats, estimateCompWinrate, type WinrateStats } from '@/lib/recommendation/winrate';
import { ChampionIcon } from '@/components/champions/ChampionIcon';
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

  // Ban state: each slot can be a champion id, SKIP_BAN, or empty string
  const [team1Bans, setTeam1Bans] = useState<string[]>(Array(team1Size).fill(''));
  const [team2Bans, setTeam2Bans] = useState<string[]>(Array(team2Size).fill(''));
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [activeSlot, setActiveSlot] = useState<ActiveSlot>({ type: 'ban', team: 1, index: 0 });
  const [search, setSearch] = useState('');
  const [phase, setPhase] = useState<'ban' | 'pick'>('ban');
  const [wrStats, setWrStats] = useState<WinrateStats | null>(null);

  useEffect(() => { computeWinrateStats().then(setWrStats); }, []);

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

  const team1BanRecs = useMemo(() => generatePerPlayerBanRecs({
    opponentPlayerIds: team2PlayerIds,
    opponentPlayerNames: Object.fromEntries(players.map((p) => [p.id!, p.name])),
    proficiencies, allChampions: champions, alreadyBanned: alreadyBannedAll,
  }), [team2PlayerIds, players, proficiencies, champions, alreadyBannedAll]);

  const team2BanRecs = useMemo(() => generatePerPlayerBanRecs({
    opponentPlayerIds: team1PlayerIds,
    opponentPlayerNames: Object.fromEntries(players.map((p) => [p.id!, p.name])),
    proficiencies, allChampions: champions, alreadyBanned: alreadyBannedAll,
  }), [team1PlayerIds, players, proficiencies, champions, alreadyBannedAll]);

  // Comp recommendations
  const getCompRecs = (teamPlayerIds: number[]) => {
    const teamPlayerObjs = teamPlayerIds.map((id) => players.find((p) => p.id === id)).filter(Boolean) as Player[];
    if (teamPlayerObjs.length < 3) return [];
    const recs = generateRecommendations({
      teamPlayers: teamPlayerObjs,
      bannedChampions: [...Array.from(allBannedIds), ...Object.values(picks)],
      allChampions: champions, proficiencies, format,
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
    return getPlayerTopChampions(playerId, profMap, availableChampions.filter((c) => !pickedIds.has(c.id) || picks[playerId] === c.id), 5);
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
    const allPlayerIds = [...team1PlayerIds, ...team2PlayerIds];
    const firstUnpicked = allPlayerIds.find((id) => !picks[id]);
    setActiveSlot(firstUnpicked ? { type: 'pick', playerId: firstUnpicked } : null);
  };

  const advancePickSlot = (currentPlayerId: number) => {
    const allPlayerIds = [...team1PlayerIds, ...team2PlayerIds];
    const currentIdx = allPlayerIds.indexOf(currentPlayerId);
    for (let i = 1; i < allPlayerIds.length; i++) {
      const nextId = allPlayerIds[(currentIdx + i) % allPlayerIds.length];
      if (!picks[nextId] || nextId === currentPlayerId) continue;
    }
    // Find first unpicked after current
    const remaining = allPlayerIds.filter((id) => id !== currentPlayerId && !picks[id]);
    setActiveSlot(remaining.length > 0 ? { type: 'pick', playerId: remaining[0] } : null);
  };

  const allPicked = [...team1PlayerIds, ...team2PlayerIds].every((id) => picks[id]);
  const canConfirm = allPicked;

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
    // Sort: available first, then by tier
    const tierOrder: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };
    const isDisabled = (c: Champion) => allBannedIds.has(c.id) || pickedIds.has(c.id);
    list.sort((a, b) => {
      const dA = isDisabled(a) ? 1 : 0;
      const dB = isDisabled(b) ? 1 : 0;
      if (dA !== dB) return dA - dB;
      // If picking, sort by proficiency for active player
      if (activeSlot?.type === 'pick') {
        const profMap = proficiencies[activeSlot.playerId] ?? new Map();
        const profOrder: Record<string, number> = { '상': 0, '중': 1, '하': 2, '없음': 3 };
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
    const compRecs = getCompRecs(playerIds);
    const teamColor = team === 1 ? 'blue' : 'red';
    const bgClass = team === 1 ? 'bg-blue-950/20 border-blue-900/40' : 'bg-red-950/20 border-red-900/40';

    return (
      <div className={`w-[320px] shrink-0 rounded-lg border ${bgClass} p-3 space-y-3 overflow-y-auto max-h-[calc(100vh-180px)]`}>
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
            <div className="space-y-2">
              {(team === 1 ? team2PlayerIds : team1PlayerIds).map((oppId) => {
                const recs = banRecs[oppId];
                if (!recs || recs.length === 0) return null;
                const canClick = activeSlot?.type === 'ban' && activeSlot.team === team;
                return (
                  <div key={oppId}>
                    <div className="text-[10px] text-lol-gold-light/40 mb-0.5">{getPlayerName(oppId)}</div>
                    <div className="flex gap-1">
                      {recs.map((rec) => {
                        const champ = champions.find((c) => c.id === rec.championId);
                        if (!champ) return null;
                        const isBanned = allBannedIds.has(champ.id);
                        return (
                          <div key={rec.championId}
                            onClick={() => canClick && !isBanned && handleChampionSelect(rec.championId)}
                            className={`${canClick && !isBanned ? 'cursor-pointer hover:opacity-100' : ''} ${isBanned ? 'opacity-20' : 'opacity-70'}`}
                            title={champ.nameKo}>
                            <ChampionIcon champion={champ} size="sm" disabled={isBanned} />
                          </div>
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

        {/* Player Rows */}
        <div className="space-y-2">
          {playerIds.map((pid) => {
            const isActive = activeSlot?.type === 'pick' && activeSlot.playerId === pid;
            const pickedChamp = picks[pid] ? champions.find((c) => c.id === picks[pid]) : null;
            const recs = getPlayerRecs(pid);
            return (
              <div key={pid}
                onClick={() => { setActiveSlot({ type: 'pick', playerId: pid }); setPhase('pick'); }}
                className={`cursor-pointer p-2 rounded border transition-all ${
                  isActive ? 'border-lol-gold bg-lol-gold/10' : 'border-lol-border/50 hover:border-lol-gold/30'
                }`}>
                <div className="flex items-center gap-2 mb-1.5">
                  {pickedChamp ? (
                    <ChampionIcon champion={pickedChamp} size="sm" selected={isActive} />
                  ) : (
                    <div className={`w-8 h-8 rounded border-2 border-dashed flex items-center justify-center ${isActive ? 'border-lol-gold' : 'border-gray-600'}`}>
                      <span className="text-gray-500 text-xs">?</span>
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm text-lol-gold-light font-medium truncate">{getPlayerName(pid)}</div>
                    {pickedChamp && <div className="text-[10px] text-lol-gold-light/50">{pickedChamp.nameKo}</div>}
                  </div>
                </div>
                {/* 7 recommendations */}
                <div className="flex flex-wrap gap-1">
                  {recs.map((c) => (
                    <div key={c.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPicks((prev) => ({ ...prev, [pid]: c.id }));
                      }}
                      className="cursor-pointer"
                      title={c.nameKo}>
                      <ChampionIcon champion={c} size="sm"
                        selected={picks[pid] === c.id}
                        disabled={pickedIds.has(c.id) && picks[pid] !== c.id} />
                    </div>
                  ))}
                </div>
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
        <Button onClick={handleConfirm} disabled={!canConfirm}>게임 시작!</Button>
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

      {/* Main 3-column layout */}
      <div className="flex gap-3">
        {/* Team 1 */}
        {renderTeamPanel(1)}

        {/* Center: Champion Grid */}
        <div className="flex-1 min-w-0 space-y-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="챔피언 검색..."
            className="w-full bg-lol-blue border border-lol-border rounded px-3 py-1.5 text-sm text-lol-gold-light placeholder:text-lol-gold-light/30 focus:outline-none focus:border-lol-gold"
          />
          <div className="text-xs text-lol-gold-light/40 text-center">
            {activeSlot
              ? activeSlot.type === 'ban'
                ? `Team ${activeSlot.team} 밴 선택 중`
                : `${getPlayerName(activeSlot.playerId)} 챔피언 선택 중`
              : '슬롯을 클릭하세요'}
          </div>
          <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-1 max-h-[calc(100vh-320px)] overflow-y-auto">
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

              const tooltip = [
                champ.nameKo,
                `ARAM ${champ.aramTier}티어 ${champ.aramWinrate}%`,
                ...oppTooltipParts,
              ].join('\n');

              return (
                <div
                  key={champ.id}
                  onClick={() => !disabled && handleChampionSelect(champ.id)}
                  title={tooltip}
                  className={`group relative flex flex-col items-center gap-0.5 p-1 rounded border transition-colors ${
                    disabled
                      ? 'border-transparent opacity-20 cursor-not-allowed'
                      : 'border-lol-border hover:border-lol-gold cursor-pointer bg-lol-blue/50'
                  }`}
                >
                  <div className="w-9 h-9 rounded overflow-hidden">
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
