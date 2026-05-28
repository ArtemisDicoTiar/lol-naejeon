import { useState } from 'react';
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend, ResponsiveContainer, Tooltip } from 'recharts';
import type { FullStats } from '@/lib/stats';
import { Card } from '@/components/ui/Card';

const COLORS = ['#c89b3c', '#3b82f6', '#ef4444', '#22c55e', '#a855f7', '#f97316', '#06b6d4'];

export function PlayerRoleRadar({
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
  const [internalSelectedIds, setInternalSelectedIds] = useState<number[]>(
    stats.players.slice(0, 2).map((p) => p.id!)
  );
  const selectedIds = controlledSelectedIds ?? internalSelectedIds;

  const togglePlayer = (id: number) => {
    if (onTogglePlayer) {
      onTogglePlayer(id);
      return;
    }
    setInternalSelectedIds((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]);
  };

  const firstPlayerId = stats.players[0]?.id;
  const axes = firstPlayerId ? stats.roleRadarData[firstPlayerId]?.map((d) => d.axis) ?? [] : [];
  const chartData = axes.map((axis) => {
    const entry: Record<string, string | number> = { axis };
    for (const pid of selectedIds) {
      const rd = stats.roleRadarData[pid];
      const point = rd?.find((d) => d.axis === axis);
      const name = stats.players.find((p) => p.id === pid)?.name ?? '';
      entry[name] = Math.round(point?.value ?? 0);
    }
    return entry;
  });

  return (
    <Card title="플레이어 역할별 승률 레이더">
      {!compact && <p className="text-xs text-lol-gold-light/40 mb-3">각 역할(포크/인게이지/...)로 플레이한 챔프의 승률입니다. 픽 수가 0이면 0%로 표시됩니다.</p>}
      {!hideSelector && <div className="flex flex-wrap gap-2 mb-4">
        {stats.players.map((p, i) => (
          <button key={p.id} onClick={() => togglePlayer(p.id!)}
            className={`cursor-pointer rounded border transition-colors ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-1 text-sm'} ${
              selectedIds.includes(p.id!)
                ? 'border-lol-gold bg-lol-gold/20 text-lol-gold'
                : 'border-lol-border text-lol-gold-light/50 hover:border-lol-gold/50'
            }`}
            style={selectedIds.includes(p.id!) ? { borderColor: COLORS[i % COLORS.length], color: COLORS[i % COLORS.length] } : {}}>
            {p.name}
          </button>
        ))}
      </div>}

      {selectedIds.length === 0 ? (
        <p className="text-center py-8 text-lol-gold-light/50">플레이어를 선택하세요</p>
      ) : (
        <ResponsiveContainer width="100%" height={compact ? 310 : 400}>
          <RadarChart data={chartData} cx="50%" cy="50%" outerRadius={compact ? '67%' : '75%'}>
            <PolarGrid stroke="#463714" />
            <PolarAngleAxis dataKey="axis" tick={{ fill: '#f0e6d2', fontSize: compact ? 10 : 12 }} />
            <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: '#f0e6d280', fontSize: 10 }} />
            {selectedIds.map((pid) => {
              const name = stats.players.find((p) => p.id === pid)?.name ?? '';
              const pIdx = stats.players.findIndex((p) => p.id === pid);
              return (
                <Radar key={pid} name={name} dataKey={name}
                  stroke={COLORS[pIdx % COLORS.length]} fill={COLORS[pIdx % COLORS.length]}
                  fillOpacity={0.15} strokeWidth={2} />
              );
            })}
            <Tooltip contentStyle={{ backgroundColor: '#1e2328', border: '1px solid #463714', color: '#f0e6d2', fontSize: 12 }} />
            <Legend wrapperStyle={{ color: '#f0e6d2', fontSize: 12 }} />
          </RadarChart>
        </ResponsiveContainer>
      )}

      {/* Pick counts table */}
      {!compact && selectedIds.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-lol-gold-light/50 border-b border-lol-border">
                <th className="text-left py-1.5 px-2">플레이어</th>
                {axes.map((a) => (
                  <th key={a} className="text-right py-1.5 px-2">{a}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {selectedIds.map((pid) => {
                const name = stats.players.find((p) => p.id === pid)?.name ?? '';
                const rd = stats.roleRadarData[pid] ?? [];
                return (
                  <tr key={pid} className="border-b border-lol-border/20">
                    <td className="py-1.5 px-2 text-lol-gold-light">{name}</td>
                    {rd.map((d) => (
                      <td key={d.axis} className="py-1.5 px-2 text-right font-mono text-lol-gold-light/70">
                        {d.picks > 0 ? `${Math.round(d.value)}% (${d.picks})` : '-'}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
