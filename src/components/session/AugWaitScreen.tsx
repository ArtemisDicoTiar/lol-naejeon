import { useState, useEffect, useRef, useMemo } from 'react';
import type { Champion, Player } from '@/lib/db';
import { Button } from '@/components/ui/Button';
import { ChampionIcon } from '@/components/champions/ChampionIcon';
import { useLcuContext } from '@/App';

interface AugWaitScreenProps {
  team1PlayerIds: number[];
  team2PlayerIds: number[];
  players: Player[];
  champions: Champion[];
  onConfirm: (result: { bans: Record<1 | 2, string[]>; picks: Record<number, string> }) => void;
  onBack: () => void;
}

export function AugWaitScreen({
  team1PlayerIds,
  team2PlayerIds,
  players,
  champions,
  onConfirm,
  onBack,
}: AugWaitScreenProps) {
  const lcu = useLcuContext();

  // numeric champId → string id (same as BanPickScreen)
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

  // alias/name → playerId
  const playerByAlias = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of players) map.set(p.name, p.id!);
    return map;
  }, [players]);

  // championId normalization — lowercase no-special-chars → canonical id
  const champByNormId = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of champions) {
      map.set(c.id.toLowerCase(), c.id);
      map.set(c.id.replace(/[^a-zA-Z]/g, '').toLowerCase(), c.id);
    }
    return map;
  }, [champions]);

  // chamionMap for display
  const champMap = useMemo(() => new Map(champions.map(c => [c.id, c])), [champions]);

  // Picks extracted from lcu.lastState (numeric → string)
  const lcuPicks = useMemo(() => {
    if (!lcu.lastState || champKeyMap.size === 0) return {};
    const out: Record<number, string> = {};
    const allPicks = [
      ...lcu.lastState.team1Picks.map(p => ({ ...p, team: 1 as const })),
      ...lcu.lastState.team2Picks.map(p => ({ ...p, team: 2 as const })),
    ];
    const playerNameToId = new Map<string, number>();
    for (const id of [...team1PlayerIds, ...team2PlayerIds]) {
      const name = players.find(p => p.id === id)?.name ?? '';
      if (name) playerNameToId.set(name, id);
    }
    for (const pick of allPicks) {
      if (!pick.champId || pick.champId <= 0) continue;
      const champId = champKeyMap.get(pick.champId);
      if (!champId) continue;
      if (pick.alias && playerNameToId.has(pick.alias)) {
        out[playerNameToId.get(pick.alias)!] = champId;
      }
    }
    return out;
  }, [lcu.lastState, champKeyMap, team1PlayerIds, team2PlayerIds, players]);

  // Auto-confirm when liveGamePlayers arrives after game start
  const confirmedRef = useRef(false);
  useEffect(() => {
    if (!lcu.liveGamePlayers || !lcu.gameStartedAt) return;
    if (confirmedRef.current) return;

    const { team1, team2 } = lcu.liveGamePlayers;
    const picks: Record<number, string> = {};

    const resolve = (livePlayers: typeof team1) => {
      for (const lp of livePlayers) {
        const pid = lp.alias ? playerByAlias.get(lp.alias) : undefined;
        if (!pid) continue;
        const champId =
          champByNormId.get(lp.championId.toLowerCase()) ??
          champByNormId.get(lp.championId.replace(/[^a-zA-Z]/g, '').toLowerCase());
        if (champId) picks[pid] = champId;
      }
    };

    resolve(team1);
    resolve(team2);

    if (Object.keys(picks).length > 0) {
      confirmedRef.current = true;
      onConfirm({ bans: { 1: [], 2: [] }, picks });
    }
  }, [lcu.liveGamePlayers, lcu.gameStartedAt, playerByAlias, champByNormId, onConfirm]);

  // Manual fallback confirm using lcuPicks collected so far
  const handleManualConfirm = () => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    onConfirm({ bans: { 1: [], 2: [] }, picks: lcuPicks });
  };

  const getPlayer = (id: number) => players.find(p => p.id === id);

  const renderTeamPanel = (teamIds: number[], teamNum: 1 | 2) => {
    const color = teamNum === 1 ? 'blue' : 'red';
    const borderColor = teamNum === 1 ? 'border-blue-900/40 bg-blue-950/20' : 'border-red-900/40 bg-red-950/20';
    return (
      <div className={`flex-1 rounded-lg border ${borderColor} p-4 space-y-3`}>
        <h3 className={`text-center font-bold text-${color}-400`}>Team {teamNum}</h3>
        {teamIds.map(pid => {
          const player = getPlayer(pid);
          const champId = lcuPicks[pid];
          const champ = champId ? champMap.get(champId) : undefined;
          return (
            <div key={pid} className="flex items-center gap-3 p-2 rounded bg-lol-dark/30">
              <div className="w-10 h-10 flex-shrink-0">
                {champ
                  ? <ChampionIcon champion={champ} size="base" />
                  : <div className="w-10 h-10 rounded border-2 border-dashed border-lol-border/40 flex items-center justify-center">
                      <span className="text-lol-gold-light/30 text-lg">?</span>
                    </div>
                }
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-lol-gold-light truncate">
                  {player?.name ?? `플레이어 ${pid}`}
                </div>
                {champ
                  ? <div className="text-xs text-lol-gold-light/60">{champ.nameKo}</div>
                  : <div className="text-xs text-lol-gold-light/30">대기 중...</div>
                }
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const pickedCount = Object.keys(lcuPicks).length;
  const totalPlayers = team1PlayerIds.length + team2PlayerIds.length;
  const allPicked = pickedCount >= totalPlayers && totalPlayers > 0;

  const lcuPhase = lcu.lastState?.phase?.toUpperCase() ?? '';
  const isInChampSelect = lcu.champSelectActive;
  const isGameStarted = !!lcu.gameStartedAt;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="text-lol-gold hover:text-lol-gold-light cursor-pointer">&larr;</button>
          <span className="px-3 py-1 rounded border border-purple-400/60 bg-purple-900/30 text-purple-300 text-sm font-medium">
            증바람
          </span>
        </div>
        <Button
          onClick={handleManualConfirm}
          variant="secondary"
          disabled={pickedCount === 0}
          title={pickedCount === 0 ? 'LCU에서 픽 데이터를 받은 후 사용 가능' : '현재 기록된 픽으로 수동 확정'}
        >
          수동 확정 ({pickedCount}/{totalPlayers})
        </Button>
      </div>

      {/* Status banner */}
      <div className={`p-3 rounded-lg border text-center text-sm space-y-1 ${
        isGameStarted
          ? 'border-green-700/50 bg-green-900/20 text-green-300'
          : isInChampSelect
          ? 'border-lol-gold/50 bg-lol-gold/10 text-lol-gold'
          : 'border-lol-border bg-lol-gray text-lol-gold-light/60'
      }`}>
        {isGameStarted ? (
          <>
            <div className="font-medium">🎮 게임 시작됨 — 픽 정보 수신 대기 중...</div>
            <div className="text-xs opacity-70">브릿지가 라이브 픽 데이터를 가져오고 있습니다 (5-15초)</div>
          </>
        ) : isInChampSelect ? (
          <>
            <div className="font-medium">⚡ 챔피언 셀렉트 진행 중</div>
            <div className="text-xs opacity-70">
              {lcuPhase && lcuPhase !== 'UNKNOWN' ? `페이즈: ${lcuPhase}` : ''}
              {' '}게임이 시작되면 자동으로 픽이 기록됩니다.
            </div>
          </>
        ) : (
          <>
            <div className="font-medium">🔌 챔피언 셀렉트 대기 중</div>
            <div className="text-xs opacity-70">게임 클라이언트에서 증바람 챔피언 선택을 시작해주세요.</div>
          </>
        )}
        {lcu.liveGamePlayers && (
          <div className="text-xs text-green-300/70 mt-1">
            ✓ 라이브 픽 데이터 수신 완료 — 자동 기록 처리 중...
          </div>
        )}
      </div>

      {/* Team panels */}
      <div className="flex gap-4">
        {renderTeamPanel(team1PlayerIds, 1)}
        {renderTeamPanel(team2PlayerIds, 2)}
      </div>

      {/* Progress */}
      <div className="text-center text-xs text-lol-gold-light/40">
        {allPicked
          ? '✓ 모든 플레이어 픽 확인 — 게임 시작 대기 중'
          : `픽 확인: ${pickedCount} / ${totalPlayers}`}
      </div>
    </div>
  );
}
