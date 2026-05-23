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
    onConfirm({ bans: { 1: [], 2: [] }, picks: lcuPicks });
  };

  const getPlayer = (id: number) => players.find(p => p.id === id);
  const pickedCount = Object.keys(lcuPicks).length;
  const totalPlayers = team1PlayerIds.length + team2PlayerIds.length;
  const isGameStarted = !!lcu.gameStartedAt;
  const isInChampSelect = lcu.champSelectActive;
  const lcuPhase = lcu.lastState?.phase?.toUpperCase() ?? '';

  const benchChamps = benchChampIds.map(id => champMap.get(id)).filter(Boolean) as Champion[];

  // ── player row renderer ──────────────────────────────────────────────
  const renderPlayerRow = (pid: number, showRecs: boolean) => {
    const player = getPlayer(pid);
    const champId = lcuPicks[pid];
    const champ = champId ? champMap.get(champId) : undefined;
    const profMap = mergedProficiencies[pid] ?? new Map();
    const profLevel = champId ? profMap.get(champId) : undefined;
    const isMe = pid === userId;

    // Pool recs for this player (only when showRecs and bench available)
    const poolRecs = showRecs && benchChamps.length > 0
      ? getRecs(pid, benchChamps, 3)
      : [];

    return (
      <div key={pid} className={`p-2 rounded ${isMe ? 'bg-lol-gold/10 border border-lol-gold/30' : 'bg-lol-dark/30'}`}>
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 flex-shrink-0">
            {champ
              ? <ChampionIcon champion={champ} size="base" />
              : <div className="w-10 h-10 rounded border-2 border-dashed border-lol-border/40 flex items-center justify-center">
                  <span className="text-lol-gold-light/30 text-lg">?</span>
                </div>
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={`text-sm font-medium ${isMe ? 'text-lol-gold' : 'text-lol-gold-light'} truncate`}>
                {player?.name ?? `#${pid}`}
                {isMe && <span className="ml-1 text-[10px] text-lol-gold/60">(나)</span>}
              </span>
              {profLevel && profLevel !== '없음' && (
                <ProficiencyBadge level={profLevel} size="sm"
                  estimated={!!(proficiencies[pid]?.get(champId!) === '없음' || !proficiencies[pid]?.get(champId!))} />
              )}
            </div>
            {champ
              ? <div className="text-xs text-lol-gold-light/60">{champ.nameKo}</div>
              : <div className="text-xs text-lol-gold-light/30">선택 중...</div>
            }
          </div>
        </div>
        {/* Pool recommendations for this player */}
        {showRecs && poolRecs.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1 pl-12">
            <span className="text-[9px] text-lol-gold-light/40 mr-0.5">추천풀</span>
            {poolRecs.map((rc, i) => {
              const rcProf = profMap.get(rc.id);
              return (
                <ChampionWithHover key={rc.id} champion={rc} wrStats={wrStats}
                  allPlayers={players} proficiencies={mergedProficiencies}
                  estimatedMap={estimatedMap}>
                  <div className={`relative cursor-default ${i === 0 ? 'ring-1 ring-lol-gold rounded' : ''}`}>
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
          <span className={`text-xs px-2 py-0.5 rounded border ${
            isGameStarted ? 'border-green-700/50 text-green-300'
            : isInChampSelect ? 'border-lol-gold/50 text-lol-gold'
            : 'border-lol-border text-lol-gold-light/40'
          }`}>
            {isGameStarted ? '게임 중' : isInChampSelect
              ? `챔셀 ${lcuPhase}` : '대기 중'}
          </span>
        </div>
        <Button onClick={handleManualConfirm} variant="secondary" disabled={pickedCount === 0}>
          수동 확정 ({pickedCount}/{totalPlayers})
        </Button>
      </div>

      {/* ── Team pool (center) ─────────────────────────────────────── */}
      <div className="p-3 rounded-lg border border-purple-800/50 bg-purple-900/10">
        <div className="text-xs text-purple-300/70 mb-2 text-center font-medium">
          우리 팀 풀 {benchChamps.length > 0 ? `(${benchChamps.length}개)` : '— 챔셀 시작 후 표시됩니다'}
        </div>
        {benchChamps.length > 0 ? (
          <div className="flex flex-wrap gap-2 justify-center">
            {benchChamps.map(c => (
              <ChampionWithHover key={c.id} champion={c} wrStats={wrStats}
                allPlayers={players} proficiencies={mergedProficiencies}
                estimatedMap={estimatedMap} highlightPlayerIds={myTeamIds}>
                <div className="flex flex-col items-center gap-0.5">
                  <ChampionIcon champion={c} size="base" />
                  <span className="text-[9px] text-lol-gold-light/60">{c.nameKo}</span>
                  {/* Show best player for this champ */}
                  {(() => {
                    const best = getRecs(myTeamIds[0], [c], 1)[0]
                      ? myTeamIds[0]
                      : myTeamIds.find(pid => getRecs(pid, [c], 1).length > 0);
                    const bestPlayer = best ? getPlayer(best) : undefined;
                    return bestPlayer ? (
                      <span className="text-[8px] text-lol-gold/60 bg-lol-gold/10 px-1 rounded">
                        {bestPlayer.name}
                      </span>
                    ) : null;
                  })()}
                </div>
              </ChampionWithHover>
            ))}
          </div>
        ) : (
          <p className="text-center text-[11px] text-lol-gold-light/30 py-1">
            LCU에서 풀 데이터를 기다리는 중...
          </p>
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
