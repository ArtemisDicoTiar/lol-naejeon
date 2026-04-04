import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSession } from '@/hooks/useSession';
import { usePlayers } from '@/hooks/usePlayers';
import { useChampions } from '@/hooks/useChampions';
import { useLcuContext } from '@/App';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { BanPickScreen } from '@/components/session/BanPickScreen';
import { getPlayerProficiencies, type ProficiencyLevel } from '@/lib/db';

type Step = 'setup' | 'banpick';

export function NewGame() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const keepTeams = searchParams.get('keepTeams') === 'true';
  const fromLcu = searchParams.get('fromLcu') === 'true';

  const { session, fierlessBans, lastGameTeams, addGame } = useSession();
  const { players } = usePlayers();
  const { champions } = useChampions();
  const lcu = useLcuContext();

  const [step, setStep] = useState<Step>((keepTeams && lastGameTeams) || fromLcu ? 'banpick' : 'setup');
  const [format, setFormat] = useState<'3v3' | '3v4'>(lastGameTeams?.format ?? '3v4');
  const [sittingOut, setSittingOut] = useState<number | null>(null); // 3v3에서 빠지는 플레이어
  const [teamAssignments, setTeamAssignments] = useState<Record<number, 1 | 2>>({});
  const [proficiencies, setProficiencies] = useState<Record<number, Map<string, ProficiencyLevel>>>({});

  const allPlayerIds = players.map((p) => p.id!);
  const selectedPlayerIds = format === '3v4'
    ? allPlayerIds
    : allPlayerIds.filter((id) => id !== sittingOut);
  const totalPlayers = format === '3v3' ? 6 : 7;
  const team1Size = 3;
  const team2Size = format === '3v3' ? 3 : 4;

  // Pre-fill from last game if keepTeams
  useEffect(() => {
    if (keepTeams && lastGameTeams) {
      const assignments: Record<number, 1 | 2> = {};
      lastGameTeams.team1.forEach((id) => { assignments[id] = 1; });
      lastGameTeams.team2.forEach((id) => { assignments[id] = 2; });
      setTeamAssignments(assignments);
      setFormat(lastGameTeams.format);
      // If 3v3, figure out who sat out
      if (lastGameTeams.format === '3v3') {
        const played = new Set([...lastGameTeams.team1, ...lastGameTeams.team2]);
        const sat = allPlayerIds.find((id) => !played.has(id));
        if (sat) setSittingOut(sat);
      }
    }
  }, [keepTeams, lastGameTeams]);

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

    const totalLcu = t1Aliases.length + t2Aliases.length;
    const detectedFormat: '3v3' | '3v4' = totalLcu >= 7 ? '3v4' : '3v3';
    setFormat(detectedFormat);
    setTeamAssignments(newAssignments);

    if (detectedFormat === '3v3' && allPlayerIds.length > 0) {
      const sitting = allPlayerIds.find(id => !matched.has(id));
      if (sitting) setSittingOut(sitting);
    }

    const t1Count = Object.values(newAssignments).filter(t => t === 1).length;
    const t2Count = Object.values(newAssignments).filter(t => t === 2).length;
    if (t1Count >= 1 && t2Count >= 1 && step !== 'banpick') {
      setStep('banpick');
    }
  }, [playerNameToId, teamAssignments, allPlayerIds, step]);

  // Auto-detect teams from LOBBY (before champ select even starts)
  useEffect(() => {
    if (!lcu.connected || !lcu.lobbyState) return;
    const t1Aliases = lcu.lobbyState.team1.map(m => m.alias).filter(Boolean) as string[];
    const t2Aliases = lcu.lobbyState.team2.map(m => m.alias).filter(Boolean) as string[];
    applyTeamsFromAliases(t1Aliases, t2Aliases);
  }, [lcu.connected, lcu.lobbyState, applyTeamsFromAliases]);

  // Auto-detect teams from champ select (cellId-based, more accurate)
  useEffect(() => {
    if (!lcu.connected || !lcu.champSelectActive || !lcu.lastState) return;
    const state = lcu.lastState;
    const t1Aliases = state.team1Picks.map(p => p.alias).filter(Boolean) as string[];
    const t2Aliases = state.team2Picks.map(p => p.alias).filter(Boolean) as string[];
    applyTeamsFromAliases(t1Aliases, t2Aliases);
  }, [lcu.connected, lcu.champSelectActive, lcu.lastState, applyTeamsFromAliases]);

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

  const handleFormatChange = (f: '3v3' | '3v4') => {
    setFormat(f);
    setSittingOut(null);
    setTeamAssignments({});
  };

  const assignTeam = (playerId: number, team: 1 | 2) => {
    const current1 = Object.entries(teamAssignments).filter(([, t]) => t === 1).length;
    const current2 = Object.entries(teamAssignments).filter(([, t]) => t === 2).length;
    if (team === 1 && current1 >= team1Size && teamAssignments[playerId] !== 1) return;
    if (team === 2 && current2 >= team2Size && teamAssignments[playerId] !== 2) return;
    setTeamAssignments((prev) => ({ ...prev, [playerId]: team }));
  };

  const autoBalance = () => {
    const ids = [...selectedPlayerIds];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const assignments: Record<number, 1 | 2> = {};
    ids.forEach((id, idx) => { assignments[id] = idx < team1Size ? 1 : 2; });
    setTeamAssignments(assignments);
  };

  const allTeamsAssigned =
    Object.values(teamAssignments).filter((t) => t === 1).length === team1Size &&
    Object.values(teamAssignments).filter((t) => t === 2).length === team2Size;

  const getPlayerName = (id: number) => players.find((p) => p.id === id)?.name ?? '';

  const team1PlayerIds = selectedPlayerIds.filter((id) => teamAssignments[id] === 1);
  const team2PlayerIds = selectedPlayerIds.filter((id) => teamAssignments[id] === 2);

  const handleBanPickConfirm = async (result: { bans: Record<1 | 2, string[]>; picks: Record<number, string> }) => {
    const picks = Object.entries(result.picks).map(([playerId, championId]) => ({
      playerId: parseInt(playerId),
      championId,
      team: teamAssignments[parseInt(playerId)],
    }));
    const bans = [
      ...result.bans[1].map((cid) => ({ championId: cid, team: 1 as const })),
      ...result.bans[2].map((cid) => ({ championId: cid, team: 2 as const })),
    ];
    await addGame(format, picks, bans);
    navigate('/session');
  };

  if (!session) {
    return (
      <div className="text-center py-16 text-lol-gold-light/60">
        <p>활성 세션이 없습니다.</p>
        <Button className="mt-4" onClick={() => navigate('/')}>대시보드로</Button>
      </div>
    );
  }

  // --- BanPick screen (full width) ---
  if (step === 'banpick') {
    return (
      <BanPickScreen
        format={format}
        team1PlayerIds={team1PlayerIds}
        team2PlayerIds={team2PlayerIds}
        players={players}
        champions={champions}
        fierlessBans={fierlessBans}
        proficiencies={proficiencies}
        onConfirm={handleBanPickConfirm}
        onBack={() => setStep('setup')}
        onReorderTeams={(newT1, newT2) => {
          const newAssignments: Record<number, 1 | 2> = {};
          newT1.forEach(id => { newAssignments[id] = 1; });
          newT2.forEach(id => { newAssignments[id] = 2; });
          setTeamAssignments(newAssignments);
        }}
      />
    );
  }

  // --- Setup step ---
  const unassigned = selectedPlayerIds.filter((id) => !teamAssignments[id]);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/session')} className="text-lol-gold hover:text-lol-gold-light cursor-pointer">&larr;</button>
        <h1 className="text-2xl font-bold text-lol-gold">새 게임 설정</h1>
      </div>

      {/* Format */}
      <Card title="형식 선택">
        <div className="flex gap-4">
          {(['3v3', '3v4'] as const).map((f) => (
            <button key={f}
              onClick={() => handleFormatChange(f)}
              className={`cursor-pointer flex-1 p-4 rounded border-2 text-center text-lg font-bold transition-colors ${
                format === f ? 'border-lol-gold bg-lol-gold/20 text-lol-gold' : 'border-lol-border bg-lol-blue text-lol-gold-light/60 hover:border-lol-gold/50'
              }`}>
              {f}
              <div className="text-xs font-normal mt-1 opacity-60">
                {f === '3v4' ? '7명 전원 참여' : '1명 제외'}
              </div>
            </button>
          ))}
        </div>
      </Card>

      {/* 3v3: pick who sits out */}
      {format === '3v3' && (
        <Card title="빠지는 플레이어 선택">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {players.map((p) => (
              <button key={p.id}
                onClick={() => { setSittingOut(sittingOut === p.id! ? null : p.id!); setTeamAssignments({}); }}
                className={`cursor-pointer p-3 rounded border text-left transition-colors ${
                  sittingOut === p.id!
                    ? 'border-red-600 bg-red-950/30 text-red-300'
                    : 'border-lol-border bg-lol-blue text-lol-gold-light/70 hover:border-lol-gold/50'
                }`}>
                <div className="font-medium">
                  {p.name} {sittingOut === p.id! && '(제외)'}
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Teams */}
      {selectedPlayerIds.length === totalPlayers && (
        <Card title="팀 편성">
          <div className="flex justify-end mb-3">
            <Button variant="secondary" size="sm" onClick={autoBalance}>랜덤 배정</Button>
          </div>

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

          <div className="grid grid-cols-2 gap-6">
            {([1, 2] as const).map((teamNum) => {
              const teamSize = teamNum === 1 ? team1Size : team2Size;
              const teamPlayerIds = selectedPlayerIds.filter((id) => teamAssignments[id] === teamNum);
              const isFull = teamPlayerIds.length >= teamSize;
              return (
                <div key={teamNum} className="space-y-2">
                  <h3 className={`font-medium text-center ${isFull ? 'text-prof-high' : 'text-lol-gold'}`}>
                    Team {teamNum} ({teamPlayerIds.length}/{teamSize}) {isFull && '\u2713'}
                  </h3>
                  <div className={`space-y-1 min-h-[80px] p-2 rounded border-2 transition-colors ${
                    isFull ? (teamNum === 1 ? 'border-blue-700/50 bg-blue-950/20' : 'border-red-700/50 bg-red-950/20') : 'border-lol-border border-dashed bg-lol-blue'
                  }`}>
                    {teamPlayerIds.map((id) => (
                      <div key={id} className="p-2 bg-lol-gray rounded text-sm text-lol-gold-light flex justify-between items-center">
                        <span>{getPlayerName(id)}</span>
                        <div className="flex gap-1">
                          <button onClick={() => assignTeam(id, teamNum === 1 ? 2 : 1)} className="text-xs text-lol-gold-light/50 hover:text-lol-gold cursor-pointer px-1">&harr;</button>
                          <button onClick={() => setTeamAssignments((prev) => { const n = { ...prev }; delete n[id]; return n; })} className="text-xs text-red-400/60 hover:text-red-400 cursor-pointer px-1">&times;</button>
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
