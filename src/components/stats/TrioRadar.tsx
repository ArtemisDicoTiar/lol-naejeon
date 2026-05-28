import { useMemo, useState } from 'react';
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import type { FullStats, PlayerEogSummaryEntry } from '@/lib/stats';
import { Card } from '@/components/ui/Card';

const TEAM_COLORS = {
  teamA: '#3b82f6',
  teamB: '#ef4444',
};

const ROLE_KEYS = ['poke', 'engage', 'dps', 'tank'];

interface TrioMetrics {
  totalGames: number;
  winrate: number;
  roleBalance: number;
  damage: number;
  frontline: number;
  cc: number;
  goldEfficiency: number;
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function playerNames(stats: FullStats, ids: number[]) {
  return ids
    .map((id) => stats.players.find((player) => player.id === id)?.name)
    .filter(Boolean)
    .join(' · ');
}

function computeTrioMetrics(stats: FullStats, ids: number[]): TrioMetrics | null {
  if (ids.length !== 3) return null;
  const selectedSet = new Set(ids);
  const selectedSynergy = stats.trioPlayerSynergy.find((entry) =>
    entry.playerIds.every((id) => selectedSet.has(id)),
  );
  const totalGames = selectedSynergy ? selectedSynergy.sameTeamWins + selectedSynergy.sameTeamLosses : 0;

  const selectedEog = stats.playerEogSummary.filter((entry) => selectedSet.has(entry.playerId));
  const avg = (selector: (entry: PlayerEogSummaryEntry) => number) => {
    if (selectedEog.length === 0) return 0;
    return selectedEog.reduce((sum, entry) => sum + selector(entry), 0) / selectedEog.length;
  };

  const roleTotals = new Map<string, number>();
  for (const playerId of ids) {
    for (const rolePoint of stats.roleRadarData[playerId] ?? []) {
      roleTotals.set(rolePoint.role, (roleTotals.get(rolePoint.role) ?? 0) + rolePoint.picks);
    }
  }
  const coveredRoles = ROLE_KEYS.filter((role) => (roleTotals.get(role) ?? 0) > 0).length;

  return {
    totalGames,
    winrate: selectedSynergy?.winrate ?? 0,
    roleBalance: (coveredRoles / ROLE_KEYS.length) * 100,
    damage: avg((entry) => entry.avgDamageDealtToChampions),
    frontline: avg((entry) => entry.avgFrontlineContribution),
    cc: avg((entry) => entry.avgTimeCCingOthers),
    goldEfficiency: avg((entry) => entry.avgGoldEfficiency),
  };
}

function formatRaw(axis: string, value: number) {
  if (axis === '조합 승률' || axis === '역할 밸런스') return `${Math.round(value)}%`;
  if (axis === 'CC') return `${Math.round(value)}초`;
  if (axis === '골드 효율') return value.toFixed(2);
  return Math.round(value).toLocaleString('ko-KR');
}

export function TrioRadar({ stats, chartHeight = 390 }: { stats: FullStats; chartHeight?: number }) {
  const defaultTeamA = stats.trioPlayerSynergy[0]?.playerIds ?? stats.players.slice(0, 3).map((player) => player.id!);
  const defaultTeamB = stats.trioPlayerSynergy[1]?.playerIds
    ?? stats.players
      .filter((player) => !defaultTeamA.includes(player.id!))
      .slice(0, 3)
      .map((player) => player.id!);

  const [teamAIds, setTeamAIds] = useState<number[]>(defaultTeamA);
  const [teamBIds, setTeamBIds] = useState<number[]>(defaultTeamB);
  const teamASet = useMemo(() => new Set(teamAIds), [teamAIds]);
  const teamBSet = useMemo(() => new Set(teamBIds), [teamBIds]);

  const teamAMetrics = useMemo(() => computeTrioMetrics(stats, teamAIds), [stats, teamAIds]);
  const teamBMetrics = useMemo(() => computeTrioMetrics(stats, teamBIds), [stats, teamBIds]);

  const chartData = useMemo(() => {
    if (!teamAMetrics || !teamBMetrics) return [];
    const rows = [
      { axis: '조합 승률', teamA: teamAMetrics.winrate, teamB: teamBMetrics.winrate },
      { axis: '역할 밸런스', teamA: teamAMetrics.roleBalance, teamB: teamBMetrics.roleBalance },
      { axis: '딜 압박', teamA: teamAMetrics.damage, teamB: teamBMetrics.damage },
      { axis: '전방', teamA: teamAMetrics.frontline, teamB: teamBMetrics.frontline },
      { axis: 'CC', teamA: teamAMetrics.cc, teamB: teamBMetrics.cc },
      { axis: '골드 효율', teamA: teamAMetrics.goldEfficiency, teamB: teamBMetrics.goldEfficiency },
    ];

    return rows.map((row) => {
      const maxValue = row.axis === '조합 승률' || row.axis === '역할 밸런스'
        ? 100
        : Math.max(row.teamA, row.teamB, 1);
      return {
        axis: row.axis,
        teamA: clampScore((row.teamA / maxValue) * 100),
        teamB: clampScore((row.teamB / maxValue) * 100),
        teamARaw: formatRaw(row.axis, row.teamA),
        teamBRaw: formatRaw(row.axis, row.teamB),
      };
    });
  }, [teamAMetrics, teamBMetrics]);

  const togglePlayer = (team: 'teamA' | 'teamB', playerId: number) => {
    if (team === 'teamA') {
      if (teamASet.has(playerId)) {
        setTeamAIds((prev) => prev.filter((id) => id !== playerId));
        return;
      }
      setTeamAIds((prev) => {
        if (prev.includes(playerId)) return prev;
        return prev.length >= 3 ? [prev[1], prev[2], playerId] : [...prev, playerId];
      });
      return;
    }
    if (teamBSet.has(playerId)) {
      setTeamBIds((prev) => prev.filter((id) => id !== playerId));
      return;
    }
    setTeamBIds((prev) => {
      if (prev.includes(playerId)) return prev;
      return prev.length >= 3 ? [prev[1], prev[2], playerId] : [...prev, playerId];
    });
  };

  const renderTeamSelector = (team: 'teamA' | 'teamB', title: string, selectedSet: Set<number>) => (
    <div className="rounded border border-lol-border/60 bg-lol-dark/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className={`text-sm font-medium ${team === 'teamA' ? 'text-blue-300' : 'text-red-300'}`}>{title}</div>
        <div className="text-[11px] text-lol-gold-light/45">{selectedSet.size}/3</div>
      </div>
      <div className="flex flex-wrap gap-2">
        {stats.players.map((player) => {
          const playerId = player.id!;
          const selected = selectedSet.has(playerId);
          return (
            <button
              key={playerId}
              onClick={() => togglePlayer(team, playerId)}
              className={`px-3 py-1 rounded text-sm border transition-colors ${
                selected
                  ? team === 'teamA'
                    ? 'cursor-pointer border-blue-400 bg-blue-950/40 text-blue-300'
                    : 'cursor-pointer border-red-400 bg-red-950/40 text-red-300'
                  : 'cursor-pointer border-lol-border text-lol-gold-light/50 hover:border-lol-gold/50'
              }`}
            >
              {player.name}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <Card title="3인팀 비교 레이더">
      <p className="mb-4 text-sm text-lol-gold-light/55">
        3명씩 두 팀을 선택해서 조합 승률, 역할 밸런스, 평균 전투 성향을 비교합니다.
      </p>

      <div className="grid gap-3 md:grid-cols-2 mb-4">
        {renderTeamSelector('teamA', 'Team A', teamASet)}
        {renderTeamSelector('teamB', 'Team B', teamBSet)}
      </div>

      {teamAIds.length !== 3 || teamBIds.length !== 3 ? (
        <p className="text-center py-8 text-lol-gold-light/50">각 팀에 플레이어 3명씩 선택하세요.</p>
      ) : !teamAMetrics || !teamBMetrics ? (
        <p className="text-center py-8 text-lol-gold-light/50">계산할 수 있는 조합 데이터가 없습니다.</p>
      ) : (
        <div>
          <div className="mb-3 grid gap-2 text-sm md:grid-cols-2">
            <div className="rounded bg-blue-950/20 border border-blue-700/30 px-3 py-2 text-blue-200">
              Team A · {playerNames(stats, teamAIds)} · 같은 팀 {teamAMetrics.totalGames}판
            </div>
            <div className="rounded bg-red-950/20 border border-red-700/30 px-3 py-2 text-red-200">
              Team B · {playerNames(stats, teamBIds)} · 같은 팀 {teamBMetrics.totalGames}판
            </div>
          </div>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <RadarChart data={chartData} cx="50%" cy="50%" outerRadius="74%">
              <PolarGrid stroke="#463714" />
              <PolarAngleAxis dataKey="axis" tick={{ fill: '#f0e6d2', fontSize: 12 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: '#f0e6d280', fontSize: 10 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#091428', border: '1px solid #463714', borderRadius: 8, color: '#f0e6d2' }}
                formatter={(_value, name, item) => {
                  const payload = item.payload as { teamARaw?: string; teamBRaw?: string };
                  return [name === 'Team A' ? payload.teamARaw : payload.teamBRaw, String(name)];
                }}
              />
              <Radar name="Team A" dataKey="teamA" stroke={TEAM_COLORS.teamA} fill={TEAM_COLORS.teamA} fillOpacity={0.16} strokeWidth={2} />
              <Radar name="Team B" dataKey="teamB" stroke={TEAM_COLORS.teamB} fill={TEAM_COLORS.teamB} fillOpacity={0.16} strokeWidth={2} />
              <Legend wrapperStyle={{ color: '#f0e6d2', fontSize: 12 }} />
            </RadarChart>
          </ResponsiveContainer>
          <div className="mt-3 text-[11px] text-lol-gold-light/40">
            조합 승률과 역할 밸런스는 절대값, 전투 지표는 두 팀 중 높은 값을 100으로 정규화했습니다.
          </div>
        </div>
      )}
    </Card>
  );
}
