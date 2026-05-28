import { useMemo, useState } from 'react';
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend, ResponsiveContainer, Tooltip } from 'recharts';
import type { FullStats, PlayerEogSummaryEntry } from '@/lib/stats';
import { Card } from '@/components/ui/Card';

const COLORS = ['#c89b3c', '#3b82f6', '#ef4444', '#22c55e', '#a855f7', '#f97316', '#06b6d4'];

interface StyleMetrics {
  carry: number;
  stability: number;
  skirmish: number;
  frontline: number;
  goldEfficiency: number;
  cc: number;
}

const AXES: Array<{ key: keyof StyleMetrics; label: string; help: string }> = [
  { key: 'carry', label: '캐리력', help: '딜량 × KDA 관여' },
  { key: 'stability', label: '안정성', help: 'KDA 관여와 골드효율을 데스 평균으로 보정' },
  { key: 'skirmish', label: '교전 기여', help: '딜량 + CC 시간 가중치' },
  { key: 'frontline', label: '전방 기여', help: '받은 피해 + 경감 피해' },
  { key: 'goldEfficiency', label: '골드 효율', help: '골드당 챔피언 피해' },
  { key: 'cc', label: 'CC 기여', help: '평균 CC 시간' },
];

function buildMetrics(summary: PlayerEogSummaryEntry): StyleMetrics {
  return {
    carry: summary.avgDamageDealtToChampions * summary.avgKdaParticipation,
    stability: (summary.avgKdaParticipation * summary.avgGoldEfficiency) / Math.max(summary.avgDeaths, 1),
    skirmish: summary.avgDamageDealtToChampions + summary.avgTimeCCingOthers * 500,
    frontline: summary.avgFrontlineContribution,
    goldEfficiency: summary.avgGoldEfficiency,
    cc: summary.avgTimeCCingOthers,
  };
}

function formatRawValue(axis: keyof StyleMetrics, value: number) {
  if (axis === 'goldEfficiency' || axis === 'stability') return value.toFixed(2);
  if (axis === 'cc') return `${Math.round(value).toLocaleString('ko-KR')}초`;
  return Math.round(value).toLocaleString('ko-KR');
}

export function PlayerStyleRadar({
  stats,
  compact = false,
  selectedIds: controlledSelectedIds,
  onTogglePlayer,
  hideSelector = false,
}: {
  stats: FullStats;
  compact?: boolean;
  selectedIds?: number[];
  onTogglePlayer?: (playerId: number) => void;
  hideSelector?: boolean;
}) {
  const playerIdsWithData = useMemo(
    () => new Set(stats.playerEogSummary.map((entry) => entry.playerId)),
    [stats.playerEogSummary],
  );
  const defaultSelectedIds = useMemo(
    () => stats.players.map((player) => player.id!).filter((id) => playerIdsWithData.has(id)).slice(0, 3),
    [playerIdsWithData, stats.players],
  );
  const [internalSelectedIds, setInternalSelectedIds] = useState<number[]>(defaultSelectedIds);
  const selectedIds = controlledSelectedIds ?? internalSelectedIds;
  const resolvedSelectedIds = useMemo(() => {
    const valid = selectedIds.filter((id) => playerIdsWithData.has(id));
    if (valid.length > 0) return valid;
    return controlledSelectedIds ? [] : defaultSelectedIds;
  }, [controlledSelectedIds, defaultSelectedIds, playerIdsWithData, selectedIds]);

  const summariesByPlayerId = useMemo(
    () => new Map(stats.playerEogSummary.map((entry) => [entry.playerId, entry])),
    [stats.playerEogSummary],
  );

  const selectedSummaries = resolvedSelectedIds
    .map((playerId) => summariesByPlayerId.get(playerId))
    .filter((entry): entry is PlayerEogSummaryEntry => !!entry);

  const chartData = AXES.map((axis) => {
    const rawValues = selectedSummaries.map((summary) => buildMetrics(summary)[axis.key]);
    const maxValue = Math.max(...rawValues, 1);
    const row: Record<string, string | number> = {
      axis: axis.label,
      axisKey: axis.key,
    };
    for (const summary of selectedSummaries) {
      const player = stats.players.find((entry) => entry.id === summary.playerId);
      if (!player) continue;
      const raw = buildMetrics(summary)[axis.key];
      row[player.name] = Math.round((raw / maxValue) * 100);
      row[`${player.name}Raw`] = raw;
    }
    return row;
  });

  const togglePlayer = (playerId: number) => {
    if (!playerIdsWithData.has(playerId)) return;
    if (onTogglePlayer) {
      onTogglePlayer(playerId);
      return;
    }
    setInternalSelectedIds((prev) => prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId]);
  };

  return (
    <Card title="플레이스타일 레이더">
      {!compact && <p className="mb-4 text-sm text-lol-gold-light/55">
        종료 후 통계가 수집된 게임 기준으로 실제 전투 성향을 비교합니다. 각 축은 선택한 플레이어 중 최고값을 100으로 정규화합니다.
      </p>}
      {!hideSelector && <div className="flex flex-wrap gap-2 mb-4">
        {stats.players.map((player, index) => {
          const playerId = player.id!;
          const selected = resolvedSelectedIds.includes(playerId);
          const hasData = playerIdsWithData.has(playerId);
          return (
            <button
              key={playerId}
              disabled={!hasData}
              onClick={() => togglePlayer(playerId)}
              title={hasData ? undefined : '이 모드에서 수집된 종료 후 통계가 없습니다.'}
              className={`rounded border transition-colors ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-1 text-sm'} ${
                !hasData
                  ? 'cursor-not-allowed border-lol-border/50 text-lol-gold-light/25 bg-lol-dark/20'
                  : selected
                    ? 'cursor-pointer border-lol-gold bg-lol-gold/20 text-lol-gold'
                    : 'cursor-pointer border-lol-border text-lol-gold-light/50 hover:border-lol-gold/50'
              }`}
              style={selected ? { borderColor: COLORS[index % COLORS.length], color: COLORS[index % COLORS.length] } : {}}
            >
              {player.name}
            </button>
          );
        })}
      </div>}

      {selectedSummaries.length === 0 ? (
        <p className="text-center py-8 text-lol-gold-light/50">비교할 플레이어를 선택하세요.</p>
      ) : (
        <ResponsiveContainer width="100%" height={compact ? 310 : 400}>
          <RadarChart data={chartData} cx="50%" cy="50%" outerRadius={compact ? '67%' : '74%'}>
            <PolarGrid stroke="#463714" />
            <PolarAngleAxis dataKey="axis" tick={{ fill: '#f0e6d2', fontSize: compact ? 10 : 12 }} />
            <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: '#f0e6d280', fontSize: 10 }} />
            <Tooltip
              contentStyle={{ backgroundColor: '#091428', border: '1px solid #463714', borderRadius: 8, color: '#f0e6d2' }}
              formatter={(value, name, item) => {
                const payload = item.payload as Record<string, string | number>;
                const axisKey = String(payload.axisKey) as keyof StyleMetrics;
                const rawValue = Number(payload[`${String(name)}Raw`] ?? value ?? 0);
                return [formatRawValue(axisKey, rawValue), String(name)];
              }}
            />
            {selectedSummaries.map((summary) => {
              const playerIndex = stats.players.findIndex((entry) => entry.id === summary.playerId);
              const player = stats.players[playerIndex];
              if (!player) return null;
              return (
                <Radar
                  key={summary.playerId}
                  name={player.name}
                  dataKey={player.name}
                  stroke={COLORS[playerIndex % COLORS.length]}
                  fill={COLORS[playerIndex % COLORS.length]}
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
              );
            })}
            <Legend wrapperStyle={{ color: '#f0e6d2', fontSize: 12 }} />
          </RadarChart>
        </ResponsiveContainer>
      )}

      {!compact && <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-2 text-[10px] text-lol-gold-light/40">
        {AXES.map((axis) => (
          <div key={axis.key} className="p-1.5 bg-lol-blue/30 rounded">
            <span className="text-lol-gold-light/60 font-medium">{axis.label}</span> = {axis.help}
          </div>
        ))}
      </div>}
    </Card>
  );
}
