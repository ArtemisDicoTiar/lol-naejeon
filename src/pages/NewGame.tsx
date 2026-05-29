import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSession } from '@/hooks/useSession';
import { usePlayers } from '@/hooks/usePlayers';
import { useChampions } from '@/hooks/useChampions';
import { useLcuContext } from '@/App';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState, PageHeader, StatusPill } from '@/components/ui/Page';
import { BanPickScreen } from '@/components/session/BanPickScreen';
import { AugWaitScreen } from '@/components/session/AugWaitScreen';
import { getPlayerProficiencies, GAME_MODE_LABELS, type ProficiencyLevel, type GameMode } from '@/lib/db';
import { computeFullStats, type FullStats } from '@/lib/stats';

type Step = 'setup' | 'banpick';

interface BalanceRecommendation {
  team1: number[];
  team2: number[];
  team1Score: number;
  team2Score: number;
  diff: number;
  reason: string;
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [[]];
  if (size > items.length) return [];
  const out: T[][] = [];
  const walk = (start: number, picked: T[]) => {
    if (picked.length === size) {
      out.push([...picked]);
      return;
    }
    for (let index = start; index <= items.length - (size - picked.length); index++) {
      picked.push(items[index]);
      walk(index + 1, picked);
      picked.pop();
    }
  };
  walk(0, []);
  return out;
}

function average(values: number[]) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function getPlayerPower(stats: FullStats, playerId: number) {
  const overall = stats.wrStats.playerOverallStats[playerId];
  const ability = average((stats.radarData[playerId] ?? []).map((point) => point.value));
  const role = average((stats.roleRadarData[playerId] ?? []).filter((point) => point.picks > 0).map((point) => point.value));
  const eog = stats.playerEogSummary.find((entry) => entry.playerId === playerId);
  const eogScore = eog
    ? average([
      (eog.avgDamageDealtToChampions / Math.max(stats.eogOverview.avgDamageDealtToChampions, 1)) * 50,
      (eog.avgFrontlineContribution / Math.max(stats.eogOverview.avgFrontlineContribution, 1)) * 50,
      (eog.avgTimeCCingOthers / Math.max(stats.eogOverview.avgTimeCCingOthers, 1)) * 50,
      (eog.avgGoldEfficiency / Math.max(stats.eogOverview.avgGoldEfficiency, 1)) * 50,
    ])
    : ability;

  return (
    (overall?.winrate ?? 50) * 0.35 +
    ability * 0.30 +
    role * 0.15 +
    eogScore * 0.20
  );
}

function getPairSynergy(stats: FullStats, a: number, b: number) {
  const row = stats.headToHead.find((entry) =>
    (entry.player1Id === a && entry.player2Id === b) || (entry.player1Id === b && entry.player2Id === a),
  );
  if (!row) return 0;
  const games = row.sameTeamWins + row.sameTeamLosses;
  const confidence = Math.min(games / 5, 1);
  return (row.sameTeamWinrate - 50) * confidence;
}

function getTrioSynergy(stats: FullStats, team: number[]) {
  if (team.length < 3) return 0;
  const teamSet = new Set(team);
  const row = stats.trioPlayerSynergy.find((entry) => entry.playerIds.every((id) => teamSet.has(id)));
  if (!row) return 0;
  const games = row.sameTeamWins + row.sameTeamLosses;
  const confidence = Math.min(games / 5, 1);
  return (row.winrate - 50) * confidence;
}

function getTeamScore(stats: FullStats, team: number[]) {
  const base = team.reduce((sum, playerId) => sum + getPlayerPower(stats, playerId), 0);
  let pairBonus = 0;
  for (let i = 0; i < team.length; i++) {
    for (let j = i + 1; j < team.length; j++) {
      pairBonus += getPairSynergy(stats, team[i], team[j]);
    }
  }
  const trioBonus = getTrioSynergy(stats, team);
  return base + pairBonus * 0.25 + trioBonus * 0.35;
}

function findGoldenBalance(stats: FullStats, playerIds: number[]): BalanceRecommendation | null {
  if (playerIds.length < 2) return null;
  const team1Size = Math.ceil(playerIds.length / 2);
  const candidates = combinations(playerIds, team1Size);
  let best: BalanceRecommendation | null = null;

  for (const team1 of candidates) {
    const team1Set = new Set(team1);
    const team2 = playerIds.filter((id) => !team1Set.has(id));
    if (team2.length === 0) continue;
    const team1Score = getTeamScore(stats, team1);
    const team2Score = getTeamScore(stats, team2);
    const diff = Math.abs(team1Score - team2Score);
    const sizePenalty = Math.abs(team1.length - team2.length) * 8;
    const adjustedDiff = diff + sizePenalty;
    if (!best || adjustedDiff < best.diff) {
      best = {
        team1,
        team2,
        team1Score,
        team2Score,
        diff: adjustedDiff,
        reason: `전력차 ${diff.toFixed(1)}점 · ${team1.length}v${team2.length}`,
      };
    }
  }

  return best;
}

export function NewGame() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const keepTeams = searchParams.get('keepTeams') === 'true';
  const fromLcu = searchParams.get('fromLcu') === 'true';

  const { session, fierlessBans, lastGameTeams, addGame } = useSession();
  const { players } = usePlayers();
  const { champions } = useChampions();
  const lcu = useLcuContext();

  const [step, setStep] = useState<Step>((keepTeams && lastGameTeams) ? 'banpick' : 'setup');
  const [format, setFormat] = useState<'3v3' | '3v4'>(lastGameTeams?.format ?? '3v4');
  const [mode, setMode] = useState<GameMode>(lastGameTeams?.mode ?? 'aram');
  const [sittingOut, setSittingOut] = useState<Set<number>>(new Set());
  const [teamAssignments, setTeamAssignments] = useState<Record<number, 1 | 2>>({});
  const [proficiencies, setProficiencies] = useState<Record<number, Map<string, ProficiencyLevel>>>({});
  const [balanceRecommendation, setBalanceRecommendation] = useState<BalanceRecommendation | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const confirmInFlightRef = useRef(false);

  const allPlayerIds = players.map((p) => p.id!);
  const selectedPlayerIds = allPlayerIds.filter((id) => !sittingOut.has(id));
  const team1Size = selectedPlayerIds.filter(id => teamAssignments[id] === 1).length;
  const team2Size = selectedPlayerIds.filter(id => teamAssignments[id] === 2).length;

  // Pre-fill from last game if keepTeams
  useEffect(() => {
    if (keepTeams && lastGameTeams) {
      const timer = window.setTimeout(() => {
        const assignments: Record<number, 1 | 2> = {};
        lastGameTeams.team1.forEach((id) => { assignments[id] = 1; });
        lastGameTeams.team2.forEach((id) => { assignments[id] = 2; });
        setTeamAssignments(assignments);
        setFormat(lastGameTeams.format);
        setBalanceRecommendation(null);
        // Figure out who sat out
        const played = new Set([...lastGameTeams.team1, ...lastGameTeams.team2]);
        const satOut = allPlayerIds.filter((id) => !played.has(id));
        if (satOut.length > 0) setSittingOut(new Set(satOut));
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [allPlayerIds, keepTeams, lastGameTeams]);

  const playerNameToId = useMemo(() => {
    return new Map(players.map(p => [p.name, p.id!]));
  }, [players]);

  // Helper: apply team assignments from alias arrays
  const applyTeamsFromAliases = useCallback((t1Aliases: string[], t2Aliases: string[]) => {
    if (t1Aliases.length === 0 && t2Aliases.length === 0) return;

    const newAssignments: Record<number, 1 | 2> = {};
    const matched = new Set<number>();

    for (const alias of t1Aliases) {
      const pid = playerNameToId.get(alias);
      if (pid) { newAssignments[pid] = 1; matched.add(pid); }
    }
    for (const alias of t2Aliases) {
      const pid = playerNameToId.get(alias);
      if (pid) { newAssignments[pid] = 2; matched.add(pid); }
    }

    if (matched.size === 0) return;

    // Keep existing for unmatched
    for (const [pidStr, team] of Object.entries(teamAssignments)) {
      const pid = parseInt(pidStr);
      if (!matched.has(pid)) newAssignments[pid] = team;
    }

    if (JSON.stringify(newAssignments) === JSON.stringify(teamAssignments)) return;

    // Auto-detect format and sitting out
    const totalLcu = t1Aliases.length + t2Aliases.length;
    const detectedFormat: '3v3' | '3v4' = totalLcu >= 7 ? '3v4' : '3v3';
    setFormat(detectedFormat);
    setTeamAssignments(newAssignments);
    setBalanceRecommendation(null);

    // Anyone not in either team is sitting out
    const satOut = allPlayerIds.filter(id => !matched.has(id));
    setSittingOut(new Set(satOut));

    const t1Count = Object.values(newAssignments).filter(t => t === 1).length;
    const t2Count = Object.values(newAssignments).filter(t => t === 2).length;
    if (t1Count >= 1 && t2Count >= 1 && step !== 'banpick') {
      setStep('banpick');
    }
  }, [playerNameToId, teamAssignments, allPlayerIds, step]);

  // Auto-detect teams from LOBBY (before champ select even starts)
  useEffect(() => {
    if (!lcu.connected || !lcu.lobbyState) return;
    const timer = window.setTimeout(() => {
      const t1Aliases = lcu.lobbyState?.team1.map(m => m.alias).filter(Boolean) as string[] ?? [];
      const t2Aliases = lcu.lobbyState?.team2.map(m => m.alias).filter(Boolean) as string[] ?? [];
      applyTeamsFromAliases(t1Aliases, t2Aliases);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [lcu.connected, lcu.lobbyState, applyTeamsFromAliases]);

  // Auto-detect teams from champ select (cellId-based, more accurate)
  useEffect(() => {
    if (!lcu.connected || !lcu.champSelectActive || !lcu.lastState) return;
    const timer = window.setTimeout(() => {
      const state = lcu.lastState;
      if (!state) return;
      if (fromLcu && state.mode === 'augmented') {
        setMode((prev) => prev === 'augmented' ? prev : 'augmented');
      }
      const t1Aliases = state.team1Picks.map(p => p.alias).filter(Boolean) as string[];
      const t2Aliases = state.team2Picks.map(p => p.alias).filter(Boolean) as string[];
      applyTeamsFromAliases(t1Aliases, t2Aliases);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [lcu.connected, lcu.champSelectActive, lcu.lastState, applyTeamsFromAliases, fromLcu]);

  // Load proficiencies
  useEffect(() => {
    (async () => {
      const profs: Record<number, Map<string, ProficiencyLevel>> = {};
      for (const pid of selectedPlayerIds) {
        profs[pid] = await getPlayerProficiencies(pid);
      }
      setProficiencies(profs);
    })();
  }, [selectedPlayerIds]);

  const toggleSittingOut = (id: number) => {
    setBalanceRecommendation(null);
    setSittingOut(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      // Remove from team assignments if sitting out
      if (next.has(id)) {
        setTeamAssignments(prev => { const n = { ...prev }; delete n[id]; return n; });
      }
      return next;
    });
  };

  const assignTeam = (playerId: number, team: 1 | 2) => {
    setBalanceRecommendation(null);
    setTeamAssignments((prev) => ({ ...prev, [playerId]: team }));
  };

  const autoBalance = () => {
    setBalanceRecommendation(null);
    const ids = [...selectedPlayerIds];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const half = Math.ceil(ids.length / 2);
    const assignments: Record<number, 1 | 2> = {};
    ids.forEach((id, idx) => { assignments[id] = idx < half ? 1 : 2; });
    setTeamAssignments(assignments);
  };

  const recommendGoldenBalance = async () => {
    if (selectedPlayerIds.length < 2) return;
    setBalanceLoading(true);
    try {
      const stats = await computeFullStats(mode);
      const recommendation = findGoldenBalance(stats, selectedPlayerIds);
      if (!recommendation) return;
      const assignments: Record<number, 1 | 2> = {};
      recommendation.team1.forEach((id) => { assignments[id] = 1; });
      recommendation.team2.forEach((id) => { assignments[id] = 2; });
      setTeamAssignments(assignments);
      setFormat(selectedPlayerIds.length >= 7 ? '3v4' : '3v3');
      setBalanceRecommendation(recommendation);
    } finally {
      setBalanceLoading(false);
    }
  };

  const allTeamsAssigned = selectedPlayerIds.length >= 2 &&
    selectedPlayerIds.every(id => teamAssignments[id] === 1 || teamAssignments[id] === 2);

  const getPlayerName = (id: number) => players.find((p) => p.id === id)?.name ?? '';

  const team1PlayerIds = selectedPlayerIds.filter((id) => teamAssignments[id] === 1);
  const team2PlayerIds = selectedPlayerIds.filter((id) => teamAssignments[id] === 2);

  // Stable callback so BanPickScreen's LCU effect doesn't re-fire each render
  const handleReorderTeams = useCallback((newT1: number[], newT2: number[]) => {
    setTeamAssignments(prev => {
      const next: Record<number, 1 | 2> = {};
      newT1.forEach(id => { next[id] = 1; });
      newT2.forEach(id => { next[id] = 2; });
      // No-op if identical to avoid render storms
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length === nextKeys.length && prevKeys.every(k => prev[Number(k)] === next[Number(k)])) {
        return prev;
      }
      return next;
    });
  }, []);

  const handleBanPickConfirm = async (result: { bans: Record<1 | 2, string[]>; picks: Record<number, string> }) => {
    if (confirmInFlightRef.current) return;
    confirmInFlightRef.current = true;
    const picks = Object.entries(result.picks).map(([playerId, championId]) => ({
      playerId: parseInt(playerId),
      championId,
      team: teamAssignments[parseInt(playerId)],
    }));
    const bans = [
      ...result.bans[1].map((cid) => ({ championId: cid, team: 1 as const })),
      ...result.bans[2].map((cid) => ({ championId: cid, team: 2 as const })),
    ];
    const t1c = picks.filter(p => p.team === 1).length;
    const t2c = picks.filter(p => p.team === 2).length;
    const gameFormat = (t1c + t2c >= 7) ? '3v4' : '3v3';
    await addGame(gameFormat, picks, bans, mode);
    navigate('/session', { replace: true });
  };

  if (!session) {
    return (
      <EmptyState
        title="활성 세션이 없습니다."
        description="새 게임을 만들려면 먼저 세션을 시작해야 합니다."
        action={<Button onClick={() => navigate('/')}>대시보드로</Button>}
      />
    );
  }

  // --- BanPick / AugWait screen (full width) ---
  if (step === 'banpick') {
    if (mode === 'augmented') {
      return (
        <AugWaitScreen
          team1PlayerIds={team1PlayerIds}
          team2PlayerIds={team2PlayerIds}
          players={players}
          champions={champions}
          proficiencies={proficiencies}
          onConfirm={handleBanPickConfirm}
          onBack={() => setStep('setup')}
        />
      );
    }
    return (
      <BanPickScreen
        format={format}
        mode={mode}
        team1PlayerIds={team1PlayerIds}
        team2PlayerIds={team2PlayerIds}
        players={players}
        champions={champions}
        fierlessBans={fierlessBans}
        proficiencies={proficiencies}
        onConfirm={handleBanPickConfirm}
        onBack={() => setStep('setup')}
        onReorderTeams={handleReorderTeams}
      />
    );
  }

  // --- Setup step ---
  const unassigned = selectedPlayerIds.filter((id) => !teamAssignments[id]);

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <PageHeader
        eyebrow="New Match"
        title="새 게임 설정"
        description="참가자, 게임 모드, 팀 편성을 정한 뒤 밴픽으로 넘어갑니다."
        meta={(
          <>
            <StatusPill tone="gold">{selectedPlayerIds.length}명 참여</StatusPill>
            <StatusPill tone={mode === 'augmented' ? 'purple' : 'blue'}>{GAME_MODE_LABELS[mode]}</StatusPill>
            {fromLcu && <StatusPill tone="green">클라 감지</StatusPill>}
          </>
        )}
        actions={<Button variant="ghost" onClick={() => navigate('/session')}>세션으로</Button>}
      />

      {/* Game mode: 칼바람 / 증바람 */}
      <Card title="게임 모드">
        <div className="flex gap-2">
          {(['aram', 'augmented'] as GameMode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`flex-1 cursor-pointer p-3 rounded border text-center font-medium transition-colors ${
                mode === m
                  ? (m === 'augmented'
                    ? 'border-purple-400 bg-purple-900/30 text-purple-300'
                    : 'border-lol-gold bg-lol-gold/15 text-lol-gold')
                  : 'border-lol-border bg-lol-gray text-lol-gold-light/50 hover:border-lol-gold/50'
              }`}>
              {GAME_MODE_LABELS[m]}
              <div className="text-[10px] text-lol-gold-light/40 mt-1">
                {m === 'aram' ? '일반 칼바람 나락' : '증강 칼바람 (증바람)'}
              </div>
            </button>
          ))}
        </div>
      </Card>

      {/* Players: select who participates */}
      <Card title={`참가자 선택 (${selectedPlayerIds.length}명 참여)`}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {players.map((p) => {
            const isSitting = sittingOut.has(p.id!);
            return (
              <button key={p.id}
                onClick={() => toggleSittingOut(p.id!)}
                className={`cursor-pointer p-2.5 rounded border text-center text-sm font-medium transition-colors ${
                  isSitting
                    ? 'border-red-800/50 bg-red-950/20 text-red-400/60 line-through'
                    : 'border-lol-gold/50 bg-lol-gold/10 text-lol-gold'
                }`}>
                {p.name}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-lol-gold-light/40 mt-2">클릭하여 제외/참여 토글</p>
      </Card>

      {/* Teams */}
      {selectedPlayerIds.length >= 2 && (
        <Card title={`팀 편성 (${team1Size} vs ${team2Size})`}>
          <div className="flex flex-wrap justify-end gap-2 mb-3">
            <Button variant="primary" size="sm" onClick={recommendGoldenBalance} disabled={balanceLoading}>
              {balanceLoading ? '계산 중...' : '황금 밸런스 추천'}
            </Button>
            <Button variant="secondary" size="sm" onClick={autoBalance}>랜덤 배정</Button>
          </div>

          {balanceRecommendation && (
            <div className="mb-4 rounded border border-lol-gold/30 bg-lol-gold/10 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-lol-gold">추천 조합 적용됨</div>
                  <div className="text-xs text-lol-gold-light/50">{balanceRecommendation.reason}</div>
                </div>
                <div className="flex gap-2 text-xs">
                  <span className="rounded bg-blue-950/40 border border-blue-800/50 px-2 py-1 text-blue-300">
                    T1 {balanceRecommendation.team1Score.toFixed(1)}
                  </span>
                  <span className="rounded bg-red-950/40 border border-red-800/50 px-2 py-1 text-red-300">
                    T2 {balanceRecommendation.team2Score.toFixed(1)}
                  </span>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-lol-gold-light/40">
                승률, 능력치 레이더, 역할별 승률, 종료 후 전투지표, 기존 같은팀 시너지를 섞어 전력차가 가장 작은 조합을 고릅니다.
              </p>
            </div>
          )}

          {unassigned.length > 0 && (
            <div className="mb-4 p-3 bg-lol-dark/50 rounded border border-dashed border-lol-gold/30">
              <div className="text-sm text-lol-gold mb-2">선수를 팀에 배정하세요</div>
              <div className="flex flex-wrap gap-2">
                {unassigned.map((id) => (
                  <div key={id} className="flex items-center gap-1 bg-lol-gray rounded border border-lol-border p-1">
                    <span className="text-sm text-lol-gold-light px-2">{getPlayerName(id)}</span>
                    <button onClick={() => assignTeam(id, 1)} className="cursor-pointer px-2 py-1 text-xs rounded bg-blue-900/40 text-blue-300 border border-blue-800/50 hover:bg-blue-900/70">T1</button>
                    <button onClick={() => assignTeam(id, 2)} className="cursor-pointer px-2 py-1 text-xs rounded bg-red-900/40 text-red-300 border border-red-800/50 hover:bg-red-900/70">T2</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {([1, 2] as const).map((teamNum) => {
              const teamPlayerIds = selectedPlayerIds.filter((id) => teamAssignments[id] === teamNum);
              return (
                <div key={teamNum} className="space-y-2">
                  <h3 className={`font-medium text-center ${teamPlayerIds.length > 0 ? (teamNum === 1 ? 'text-blue-400' : 'text-red-400') : 'text-lol-gold-light/50'}`}>
                    Team {teamNum} ({teamPlayerIds.length}명)
                  </h3>
                  <div className={`space-y-1 min-h-[60px] p-2 rounded border-2 transition-colors ${
                    teamPlayerIds.length > 0
                      ? (teamNum === 1 ? 'border-blue-700/50 bg-blue-950/20' : 'border-red-700/50 bg-red-950/20')
                      : 'border-lol-border border-dashed bg-lol-blue'
                  }`}>
                    {teamPlayerIds.map((id) => (
                      <div key={id} className="p-2 bg-lol-gray rounded text-sm text-lol-gold-light flex justify-between items-center">
                        <span>{getPlayerName(id)}</span>
                        <div className="flex gap-1">
                          <button onClick={() => assignTeam(id, teamNum === 1 ? 2 : 1)} className="text-xs text-lol-gold-light/50 hover:text-lol-gold cursor-pointer px-1">&harr;</button>
                          <button onClick={() => { setBalanceRecommendation(null); setTeamAssignments((prev) => { const n = { ...prev }; delete n[id]; return n; }); }} className="text-xs text-red-400/60 hover:text-red-400 cursor-pointer px-1">&times;</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="flex justify-end">
        <Button onClick={() => setStep('banpick')} disabled={!allTeamsAssigned} size="lg">
          밴픽으로
        </Button>
      </div>
    </div>
  );
}
