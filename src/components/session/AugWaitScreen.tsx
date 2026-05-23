import { useState, useEffect, useRef, useMemo } from 'react';
import type { Champion, Player, ProficiencyLevel } from '@/lib/db';
import { Button } from '@/components/ui/Button';
import { ChampionIcon } from '@/components/champions/ChampionIcon';
import { ChampionWithHover } from '@/components/champions/ChampionWithHover';
import { ProficiencyBadge } from '@/components/ui/Badge';
import { useLcuContext, useIdentityContext } from '@/App';
import { computeWinrateStats, type WinrateStats } from '@/lib/recommendation/winrate';
import { estimatePlayerProficiencies, type EstimatedProficiency } from '@/lib/recommendation/proficiency-estimator';

interface AugWaitScreenProps {
  team1PlayerIds: number[];
  team2PlayerIds: number[];
  players: Player[];
  champions: Champion[];
  proficiencies: Record<number, Map<string, ProficiencyLevel>>;
  onConfirm: (result: { bans: Record<1 | 2, string[]>; picks: Record<number, string> }) => void;
  onBack: () => void;
}

const PROF_SCORE: Record<string, number> = { S: 5, '상': 3, '중': 2, '하': 1 };
const TIER_SCORE: Record<string, number> = { S: 2.5, A: 2, B: 1.5, C: 1, D: 0.5 };

export function AugWaitScreen({
  team1PlayerIds,
  team2PlayerIds,
  players,
  champions,
  proficiencies,
  onConfirm,
  onBack,
}: AugWaitScreenProps) {
  const lcu = useLcuContext();
  const { userId } = useIdentityContext();
  const [wrStats, setWrStats] = useState<WinrateStats | null>(null);
  const [manualPicks, setManualPicks] = useState<Record<number, string>>({});
  const [activePlayerId, setActivePlayerId] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => { computeWinrateStats('augmented').then(setWrStats); }, []);

  // numeric champId → string id (from Data Dragon)
  const [champKeyMap, setChampKeyMap] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    fetch('https://ddragon.leagueoflegends.com/api/versions.json')
      .then(r => r.json())
      .then(versions => fetch(`https://ddragon.leagueoflegends.com/cdn/${versions[0]}/data/ko_KR/champion.json`))
      .then(r => r.json())
      .then(data => {
        const map = new Map<number, string>();
        for (const [, champ] of Object.entries(data.data as Record<string, any>)) {
          map.set(parseInt(champ.key), champ.id as string);
        }
        setChampKeyMap(map);
      })
      .catch(() => {});
  }, []);

  const champMap = useMemo(() => new Map(champions.map(c => [c.id, c])), [champions]);
  const champByNormId = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of champions) {
      map.set(c.id.toLowerCase(), c.id);
      map.set(c.id.replace(/[^a-zA-Z]/g, '').toLowerCase(), c.id);
    }
    return map;
  }, [champions]);

  const playerByAlias = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of players) map.set(p.name, p.id!);
    return map;
  }, [players]);

  // Which team is "ours" (the user's team)
  const myTeamIds = useMemo(() =>
    team1PlayerIds.includes(userId ?? -1) ? team1PlayerIds : team2PlayerIds,
  [team1PlayerIds, team2PlayerIds, userId]);
  const oppTeamIds = useMemo(() =>
    team1PlayerIds.includes(userId ?? -1) ? team2PlayerIds : team1PlayerIds,
  [team1PlayerIds, team2PlayerIds, userId]);
  const myTeamNum: 1 | 2 = team1PlayerIds.includes(userId ?? -1) ? 1 : 2;

  // Merged proficiencies (manual + estimated)
  const mergedProficiencies = useMemo<Record<number, Map<string, ProficiencyLevel>>>(() => {
    if (!wrStats) return proficiencies;
    const aramWrMap = new Map(champions.map(c => [c.id, c.aramWinrate]));
    const allIds = [...team1PlayerIds, ...team2PlayerIds];
    const merged = { ...proficiencies };
    for (const pid of allIds) {
      const manual = proficiencies[pid] ?? new Map();
      const estimates = estimatePlayerProficiencies(pid, manual, champions.map(c => c.id), aramWrMap, wrStats);
      if (estimates.size > 0) {
        const m = new Map(manual);
        for (const [champId, est] of estimates) {
          if (!m.has(champId) || m.get(champId) === '없음') m.set(champId, est.level);
        }
        merged[pid] = m;
      }
    }
    return merged;
  }, [wrStats, proficiencies, champions, team1PlayerIds, team2PlayerIds]);

  // Estimated proficiencies map (for display)
  const estimatedMap = useMemo(() => {
    if (!wrStats) return new Map<string, Map<string, EstimatedProficiency>>();
    const aramWrMap = new Map(champions.map(c => [c.id, c.aramWinrate]));
    const result = new Map<string, Map<string, EstimatedProficiency>>();
    for (const pid of [...team1PlayerIds, ...team2PlayerIds]) {
      result.set(String(pid), estimatePlayerProficiencies(pid, proficiencies[pid] ?? new Map(), champions.map(c => c.id), aramWrMap, wrStats));
    }
    return result;
  }, [wrStats, proficiencies, champions, team1PlayerIds, team2PlayerIds]);

  // Picks from LCU (numeric → string)
  const lcuPicks = useMemo(() => {
    if (!lcu.lastState || champKeyMap.size === 0) return {};
    const out: Record<number, string> = {};
    const allPicks = [
      ...lcu.lastState.team1Picks,
      ...lcu.lastState.team2Picks,
    ];
    for (const pick of allPicks) {
      if (!pick.champId || pick.champId <= 0) continue;
      const champId = champKeyMap.get(pick.champId);
      if (!champId) continue;
      if (pick.alias && playerByAlias.has(pick.alias)) {
        out[playerByAlias.get(pick.alias)!] = champId;
      }
    }
    return out;
  }, [lcu.lastState, champKeyMap, playerByAlias]);

  // Bench (team pool) — numeric IDs from LCU, converted to string
  const benchChampIds = useMemo(() => {
    const bench = lcu.lastState?.benchChampions ?? [];
    return bench.map(id => champKeyMap.get(id)).filter(Boolean) as string[];
  }, [lcu.lastState?.benchChampions, champKeyMap]);

  // Top N recommendations for a player from a given champion list
  const getRecs = (pid: number, fromChamps: Champion[], count = 4): Champion[] => {
    const profMap = mergedProficiencies[pid] ?? new Map();
    return fromChamps
      .map(c => ({
        c,
        score: (PROF_SCORE[profMap.get(c.id) ?? '없음'] ?? 0) * (TIER_SCORE[c.aramTier] ?? 1),
      }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, count)
      .map(x => x.c);
  };

  // Auto-confirm when liveGamePlayers arrives
  const confirmedRef = useRef(false);
  useEffect(() => {
    if (!lcu.liveGamePlayers || !lcu.gameStartedAt) return;
    if (confirmedRef.current) return;
    const { team1, team2 } = lcu.liveGamePlayers;
    const picks: Record<number, string> = {};
    for (const lp of [...team1, ...team2]) {
      const pid = lp.alias ? playerByAlias.get(lp.alias) : undefined;
      if (!pid) continue;
      const champId =
        champByNormId.get(lp.championId.toLowerCase()) ??
        champByNormId.get(lp.championId.replace(/[^a-zA-Z]/g, '').toLowerCase());
      if (champId) picks[pid] = champId;
    }
    if (Object.keys(picks).length > 0) {
      confirmedRef.current = true;
      onConfirm({ bans: { 1: [], 2: [] }, picks });
    }
  }, [lcu.liveGamePlayers, lcu.gameStartedAt, playerByAlias, champByNormId, onConfirm]);

  const handleManualConfirm = () => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    onConfirm({ bans: { 1: [], 2: [] }, picks: currentPicks });
  };

  const getPlayer = (id: number) => players.find(p => p.id === id);
  const isLcuConnected = lcu.connected;
  const isGameStarted = !!lcu.gameStartedAt;
  const isInChampSelect = lcu.champSelectActive;
  const lcuPhase = lcu.lastState?.phase?.toUpperCase() ?? '';

  // Source of truth for picks depends on LCU connection
  const currentPicks = isLcuConnected ? lcuPicks : manualPicks;
  const pickedCount = Object.keys(currentPicks).length;
  const totalPlayers = team1PlayerIds.length + team2PlayerIds.length;
  const allPickedIds = new Set(Object.values(currentPicks));

  // Pool: LCU bench when connected, ALL champions when manual
  const benchChamps = isLcuConnected
    ? (benchChampIds.map(id => champMap.get(id)).filter(Boolean) as Champion[])
    : champions.filter(c => !allPickedIds.has(c.id));

  // Filtered pool for manual mode search
  const searchLower = search.toLowerCase();
  const displayPool = search
    ? benchChamps.filter(c => c.nameKo.includes(search) || c.id.toLowerCase().includes(searchLower))
    : benchChamps;

  const handleManualPickChampion = (champId: string) => {
    if (!activePlayerId) return;
    setManualPicks(prev => ({ ...prev, [activePlayerId]: champId }));
    // Auto-advance to next unpicked player in draft order
    const allIds = [...team1PlayerIds, ...team2PlayerIds];
    const nextUnpicked = allIds.find(pid => pid !== activePlayerId && !manualPicks[pid]);
    setActivePlayerId(nextUnpicked ?? null);
    setSearch('');
  };

  // ── player row renderer ──────────────────────────────────────────────
  const renderPlayerRow = (pid: number, showRecs: boolean) => {
    const player = getPlayer(pid);
    const champId = currentPicks[pid];
    const champ = champId ? champMap.get(champId) : undefined;
    const profMap = mergedProficiencies[pid] ?? new Map();
    const profLevel = champId ? profMap.get(champId) : undefined;
    const isMe = pid === userId;
    const isActive = !isLcuConnected && activePlayerId === pid;

    const poolRecs = showRecs && benchChamps.length > 0
      ? getRecs(pid, benchChamps, 3) : [];

    return (
      <div key={pid}
        onClick={() => !isLcuConnected && setActivePlayerId(pid)}
        className={`p-2 rounded transition-colors ${
          isActive
            ? 'bg-lol-gold/20 border-2 border-lol-gold cursor-pointer'
            : isMe
            ? 'bg-lol-gold/10 border border-lol-gold/30'
            : 'bg-lol-dark/30'
        } ${!isLcuConnected ? 'cursor-pointer hover:bg-lol-blue/40' : ''}`}>
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 flex-shrink-0">
            {champ
              ? <ChampionIcon champion={champ} size="base" />
              : <div className={`w-10 h-10 rounded border-2 border-dashed flex items-center justify-center ${
                  isActive ? 'border-lol-gold' : 'border-lol-border/40'
                }`}>
                  <span className={`text-lg ${isActive ? 'text-lol-gold' : 'text-lol-gold-light/30'}`}>
                    {isActive ? '↓' : '?'}
                  </span>
                </div>
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={`text-sm font-medium ${isActive ? 'text-lol-gold font-bold' : isMe ? 'text-lol-gold' : 'text-lol-gold-light'} truncate`}>
                {player?.name ?? `#${pid}`}
                {isMe && <span className="ml-1 text-[10px] text-lol-gold/60">(나)</span>}
                {isActive && <span className="ml-1 text-[10px] text-lol-gold">← 선택 중</span>}
              </span>
              {profLevel && profLevel !== '없음' && (
                <ProficiencyBadge level={profLevel} size="sm"
                  estimated={!!(proficiencies[pid]?.get(champId!) === '없음' || !proficiencies[pid]?.get(champId!))} />
              )}
            </div>
            {champ
              ? <div className="text-xs text-lol-gold-light/60">{champ.nameKo}</div>
              : <div className="text-xs text-lol-gold-light/30">
                  {isActive ? '아래 챔피언을 클릭해서 배정' : '선택 전'}
                </div>
            }
          </div>
          {!isLcuConnected && champ && (
            <button
              onClick={(e) => { e.stopPropagation(); setManualPicks(p => { const n = {...p}; delete n[pid]; return n; }); }}
              className="text-lol-gold-light/30 hover:text-lol-gold-light text-sm cursor-pointer px-1">×</button>
          )}
        </div>
        {showRecs && poolRecs.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1 pl-12">
            <span className="text-[9px] text-lol-gold-light/40 mr-0.5">추천풀</span>
            {poolRecs.map((rc, i) => {
              const rcProf = profMap.get(rc.id);
              return (
                <ChampionWithHover key={rc.id} champion={rc} wrStats={wrStats}
                  allPlayers={players} proficiencies={mergedProficiencies}
                  estimatedMap={estimatedMap}>
                  <div
                    onClick={(e) => { e.stopPropagation(); if (!isLcuConnected && activePlayerId) handleManualPickChampion(rc.id); }}
                    className={`relative ${!isLcuConnected && activePlayerId ? 'cursor-pointer hover:opacity-80' : 'cursor-default'} ${i === 0 ? 'ring-1 ring-lol-gold rounded' : ''}`}>
                    <ChampionIcon champion={rc} size="sm" />
                    {rcProf && rcProf !== '없음' && (
                      <span className="absolute -top-1 -right-1 text-[7px] bg-lol-dark/90 text-lol-gold rounded px-0.5">
                        {rcProf}
                      </span>
                    )}
                  </div>
                </ChampionWithHover>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="text-lol-gold hover:text-lol-gold-light cursor-pointer">&larr;</button>
          <span className="px-3 py-1 rounded border border-purple-400/60 bg-purple-900/30 text-purple-300 text-sm font-medium">
            증바람
          </span>
          {isLcuConnected ? (
            <span className={`text-xs px-2 py-0.5 rounded border ${
              isGameStarted ? 'border-green-700/50 text-green-300'
              : isInChampSelect ? 'border-lol-gold/50 text-lol-gold'
              : 'border-lol-border text-lol-gold-light/40'
            }`}>
              {isGameStarted ? '게임 중' : isInChampSelect ? `챔셀 ${lcuPhase}` : '클라 대기 중'}
            </span>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded border border-yellow-700/50 text-yellow-400">
              수동 입력 모드
            </span>
          )}
        </div>
        <Button
          onClick={handleManualConfirm}
          disabled={pickedCount === 0}
          variant={pickedCount === totalPlayers ? 'primary' : 'secondary'}>
          픽 확정 ({pickedCount}/{totalPlayers})
        </Button>
      </div>

      {/* ── Team pool / full champion grid ─────────────────────────── */}
      <div className="p-3 rounded-lg border border-purple-800/50 bg-purple-900/10 space-y-2">
        <div className="flex items-center gap-2">
          <div className="text-xs text-purple-300/70 font-medium">
            {isLcuConnected
              ? `우리 팀 풀 ${benchChamps.length > 0 ? `(${benchChamps.length}개)` : '— 챔셀 시작 후 표시'}`
              : `전체 챔피언 (${benchChamps.length}개) — 플레이어 선택 후 클릭으로 배정`}
          </div>
          {!isLcuConnected && (
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="챔피언 검색..."
              className="flex-1 bg-lol-blue border border-lol-border rounded px-2 py-1 text-xs text-lol-gold-light placeholder:text-lol-gold-light/30 focus:outline-none focus:border-lol-gold"
            />
          )}
        </div>

        {isLcuConnected && benchChamps.length === 0 ? (
          <p className="text-center text-[11px] text-lol-gold-light/30 py-1">
            LCU에서 풀 데이터를 기다리는 중...
          </p>
        ) : (
          <div className={`flex flex-wrap gap-2 ${!isLcuConnected ? 'max-h-56 overflow-y-auto' : ''}`}>
            {displayPool.map(c => {
              const bestPid = myTeamIds.reduce<number | null>((best, pid) => {
                const s = (PROF_SCORE[mergedProficiencies[pid]?.get(c.id) ?? '없음'] ?? 0);
                const bs = best ? (PROF_SCORE[mergedProficiencies[best]?.get(c.id) ?? '없음'] ?? 0) : -1;
                return s > bs ? pid : best;
              }, null);
              const bestPlayer = bestPid && (PROF_SCORE[mergedProficiencies[bestPid]?.get(c.id) ?? '없음'] ?? 0) > 0
                ? getPlayer(bestPid) : undefined;
              return (
                <ChampionWithHover key={c.id} champion={c} wrStats={wrStats}
                  allPlayers={players} proficiencies={mergedProficiencies}
                  estimatedMap={estimatedMap} highlightPlayerIds={myTeamIds}>
                  <div
                    onClick={() => !isLcuConnected && activePlayerId && handleManualPickChampion(c.id)}
                    className={`flex flex-col items-center gap-0.5 rounded p-0.5 transition-colors ${
                      !isLcuConnected && activePlayerId
                        ? 'cursor-pointer hover:bg-lol-gold/20 hover:ring-1 hover:ring-lol-gold'
                        : 'cursor-default'
                    }`}>
                    <ChampionIcon champion={c} size="base" />
                    <span className="text-[9px] text-lol-gold-light/60">{c.nameKo}</span>
                    {bestPlayer && (
                      <span className="text-[8px] text-lol-gold/60 bg-lol-gold/10 px-1 rounded">
                        {bestPlayer.name}
                      </span>
                    )}
                  </div>
                </ChampionWithHover>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Main two-column layout ─────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        {/* Our team */}
        <div className={`rounded-lg border p-3 space-y-2 ${
          myTeamNum === 1 ? 'border-blue-800/50 bg-blue-950/20' : 'border-red-800/50 bg-red-950/20'
        }`}>
          <h3 className={`text-center font-bold text-sm ${myTeamNum === 1 ? 'text-blue-400' : 'text-red-400'}`}>
            우리 팀 (Team {myTeamNum})
          </h3>
          {myTeamIds.map(pid => renderPlayerRow(pid, true))}
        </div>

        {/* Opponent team */}
        <div className={`rounded-lg border p-3 space-y-2 ${
          myTeamNum === 1 ? 'border-red-800/40 bg-red-950/10' : 'border-blue-800/40 bg-blue-950/10'
        }`}>
          <h3 className={`text-center font-bold text-sm ${myTeamNum === 1 ? 'text-red-400/70' : 'text-blue-400/70'}`}>
            상대 팀 (Team {myTeamNum === 1 ? 2 : 1})
          </h3>
          {oppTeamIds.map(pid => renderPlayerRow(pid, false))}
        </div>
      </div>

      {/* Auto status */}
      {lcu.liveGamePlayers && (
        <p className="text-center text-xs text-green-400/70">
          ✓ 라이브 픽 데이터 수신 — 자동 기록 처리 중...
        </p>
      )}
      {isGameStarted && !lcu.liveGamePlayers && (
        <p className="text-center text-xs text-lol-gold/60 animate-pulse">
          게임 시작됨 — 픽 정보 수신 중 (5-15초)...
        </p>
      )}
    </div>
  );
}
