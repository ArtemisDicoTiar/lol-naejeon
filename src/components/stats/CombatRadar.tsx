import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend, ResponsiveContainer, Tooltip } from 'recharts';
import { Card } from '@/components/ui/Card';

export interface CombatRadarMetrics {
  damage: number;
  frontline: number;
  heal: number;
  cc: number;
  kda: number;
  goldEfficiency: number;
}

export interface CombatRadarSeries {
  key: string;
  label: string;
  color: string;
  metrics: CombatRadarMetrics;
}

const AXES: Array<{ key: keyof CombatRadarMetrics; label: string }> = [
  { key: 'damage', label: '딜량' },
  { key: 'frontline', label: '전방 기여' },
  { key: 'heal', label: '힐량' },
  { key: 'cc', label: 'CC' },
  { key: 'kda', label: 'KDA 관여' },
  { key: 'goldEfficiency', label: '골드 효율' },
];

function formatMetricValue(axis: keyof CombatRadarMetrics, value: number) {
  if (axis === 'cc') return `${Math.round(value).toLocaleString('ko-KR')}초`;
  if (axis === 'kda' || axis === 'goldEfficiency') return value.toFixed(2);
  return Math.round(value).toLocaleString('ko-KR');
}

export function CombatRadar({
  title,
  description,
  series,
  emptyMessage = '전투 지표가 아직 없습니다.',
  chartHeight = 380,
}: {
  title: string;
  description?: string;
  series: CombatRadarSeries[];
  emptyMessage?: string;
  chartHeight?: number;
}) {
  const activeSeries = series.filter((entry) => Object.values(entry.metrics).some((value) => value > 0));

  if (activeSeries.length === 0) {
    return (
      <Card title={title}>
        <p className="text-sm text-lol-gold-light/50">{emptyMessage}</p>
      </Card>
    );
  }

  const chartData = AXES.map((axis) => {
    const axisMax = Math.max(...activeSeries.map((entry) => entry.metrics[axis.key]), 1);
    const row: Record<string, number | string> = {
      axis: axis.label,
      axisKey: axis.key,
      axisMax,
    };
    for (const entry of activeSeries) {
      row[entry.key] = Math.round((entry.metrics[axis.key] / axisMax) * 100);
      row[`${entry.key}Raw`] = entry.metrics[axis.key];
    }
    return row;
  });

  return (
    <Card title={title}>
      {description && <p className="mb-4 text-sm text-lol-gold-light/55">{description}</p>}
      <ResponsiveContainer width="100%" height={chartHeight}>
        <RadarChart data={chartData} cx="50%" cy="50%" outerRadius="74%">
          <PolarGrid stroke="#463714" />
          <PolarAngleAxis dataKey="axis" tick={{ fill: '#f0e6d2', fontSize: 12 }} />
          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: '#f0e6d280', fontSize: 10 }} />
          <Tooltip
            contentStyle={{ backgroundColor: '#091428', border: '1px solid #463714', borderRadius: 8, color: '#f0e6d2' }}
            formatter={(value, _name, item) => {
              const payload = item.payload as Record<string, string | number>;
              const axisKey = String(payload.axisKey) as keyof CombatRadarMetrics;
              const rawKey = String(item.dataKey).endsWith('Raw') ? String(item.dataKey) : `${String(item.dataKey)}Raw`;
              const rawValue = Number(payload[rawKey] ?? value ?? 0);
              return [formatMetricValue(axisKey, rawValue), String(item.name)];
            }}
          />
          {activeSeries.map((entry) => (
            <Radar
              key={entry.key}
              name={entry.label}
              dataKey={entry.key}
              stroke={entry.color}
              fill={entry.color}
              fillOpacity={0.16}
              strokeWidth={2}
            />
          ))}
          <Legend wrapperStyle={{ color: '#f0e6d2', fontSize: 12 }} />
        </RadarChart>
      </ResponsiveContainer>
      <div className="mt-3 text-[11px] text-lol-gold-light/40">
        각 축은 현재 비교 대상 중 가장 높은 평균값을 100으로 정규화했습니다.
      </div>
    </Card>
  );
}
