import { useState } from 'react';
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend, ResponsiveContainer } from 'recharts';
import type { FullStats } from '@/lib/stats';
import { Card } from '@/components/ui/Card';

const COLORS = ['#c89b3c', '#3b82f6', '#ef4444', '#22c55e', '#a855f7', '#f97316', '#06b6d4'];

export function PlayerRadar({ stats }: { stats: FullStats }) {
  const [selectedIds, setSelectedIds] = useState<number[]>(
    stats.players.slice(0, 2).map((p) => p.id!)
  );

  const togglePlayer = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  // Merge radar data for selected players
  const axes = stats.radarData[stats.players[0]?.id!]?.map((d) => d.axis) ?? [];
  const chartData = axes.map((axis) => {
    const entry: Record<string, string | number> = { axis };
    for (const pid of selectedIds) {
      const rd = stats.radarData[pid];
      const point = rd?.find((d) => d.axis === axis);
      const name = stats.players.find((p) => p.id === pid)?.name ?? '';
      entry[name] = Math.round(point?.value ?? 0);
    }
    return entry;
  });

  return (
    <Card title="플레이어 능력치 (레이더 차트)">
      {/* Player selector */}
      <div className="flex flex-wrap gap-2 mb-4">
        {stats.players.map((p, i) => (
          <button key={p.id} onClick={() => togglePlayer(p.id!)}
            className={`cursor-pointer px-3 py-1 rounded text-sm border transition-colors ${
              selectedIds.includes(p.id!)
                ? 'border-lol-gold bg-lol-gold/20 text-lol-gold'
                : 'border-lol-border text-lol-gold-light/50 hover:border-lol-gold/50'
            }`}
            style={selectedIds.includes(p.id!) ? { borderColor: COLORS[i % COLORS.length], color: COLORS[i % COLORS.length] } : {}}>
            {p.name}
          </button>
        ))}
      </div>

      {selectedIds.length === 0 ? (
        <p className="text-center py-8 text-lol-gold-light/50">플레이어를 선택하세요</p>
      ) : (
        <ResponsiveContainer width="100%" height={400}>
          <RadarChart data={chartData} cx="50%" cy="50%" outerRadius="75%">
            <PolarGrid stroke="#463714" />
            <PolarAngleAxis dataKey="axis" tick={{ fill: '#f0e6d2', fontSize: 12 }} />
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
            <Legend wrapperStyle={{ color: '#f0e6d2', fontSize: 12 }} />
          </RadarChart>
        </ResponsiveContainer>
      )}

      {/* Formula descriptions */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-2 text-[10px] text-lol-gold-light/40">
        <div className="p-1.5 bg-lol-blue/30 rounded">
          <span className="text-lol-gold-light/60 font-medium">승률</span> = 전체 승수 / 전체 게임수 × 100
        </div>
        <div className="p-1.5 bg-lol-blue/30 rounded">
          <span className="text-lol-gold-light/60 font-medium">포크</span> = 포크챔프 픽비율 × 해당 승률 × 200
        </div>
        <div className="p-1.5 bg-lol-blue/30 rounded">
          <span className="text-lol-gold-light/60 font-medium">인게이지</span> = 인게이지/탱크 픽비율 × 해당 승률 × 200
        </div>
        <div className="p-1.5 bg-lol-blue/30 rounded">
          <span className="text-lol-gold-light/60 font-medium">서스테인</span> = 서스테인/유틸 픽비율 × 해당 승률 × 200
        </div>
        <div className="p-1.5 bg-lol-blue/30 rounded">
          <span className="text-lol-gold-light/60 font-medium">챔피언 폭</span> = 고유 챔프 수 / 20 × 100
        </div>
        <div className="p-1.5 bg-lol-blue/30 rounded">
          <span className="text-lol-gold-light/60 font-medium">캐리력</span> = S/상/중 챔프 승수 / S/상/중 챔프 게임수 × 100
        </div>
      </div>
    </Card>
  );
}
