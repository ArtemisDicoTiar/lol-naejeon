import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from '@/components/ui/Card';
import type { FullStats, PlayerWinrateTrendPoint } from '@/lib/stats';

const COLORS = ['#c89b3c', '#60a5fa', '#f87171', '#34d399', '#c084fc', '#fb923c', '#22d3ee', '#f472b6'];

type ChartRow = {
  key: string;
  playedAtMs: number;
  label: string;
  gameNumber: number;
} & Record<string, number | string | PlayerWinrateTrendPoint | undefined>;

interface PlayerWinrateTrendChartProps {
  stats: FullStats;
  selectedIds: number[];
}

export function PlayerWinrateTrendChart({ stats, selectedIds }: PlayerWinrateTrendChartProps) {
  const selectedPlayers = selectedIds
    .map((id) => stats.players.find((player) => player.id === id))
    .filter((player): player is NonNullable<typeof player> => !!player);

  const chartData = useMemo(() => {
    const rows = new Map<string, ChartRow>();

    selectedPlayers.forEach((player) => {
      const points = stats.playerWinrateTrend[player.id!] ?? [];
      points.forEach((point) => {
        const key = `${point.playedAtMs}:${point.gameId}`;
        const row = rows.get(key) ?? {
          key,
          playedAtMs: point.playedAtMs,
          label: point.playedAtLabel,
          gameNumber: point.gameNumber,
        };
        row[`p_${player.id}`] = point.winrate;
        row[`p_${player.id}_meta`] = point;
        rows.set(key, row);
      });
    });

    return [...rows.values()].sort((a, b) => {
      if (a.playedAtMs !== b.playedAtMs) return a.playedAtMs - b.playedAtMs;
      return a.gameNumber - b.gameNumber;
    });
  }, [selectedPlayers, stats.playerWinrateTrend]);

  const visiblePlayers = selectedPlayers.filter((player) => (stats.playerWinrateTrend[player.id!] ?? []).length > 0);

  return (
    <Card title="플레이어별 승률 추이">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-lol-gold-light/50">
          선택된 선수들의 경기 시점별 최근 5경기 승률입니다. X축은 경기 날짜 기준입니다.
        </p>
        <div className="text-[11px] text-lol-gold-light/40">
          {visiblePlayers.length}명 비교
        </div>
      </div>

      {visiblePlayers.length === 0 || chartData.length === 0 ? (
        <p className="py-6 text-center text-sm text-lol-gold-light/45">
          선택된 선수에게 승패가 기록된 경기가 없습니다.
        </p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-2 text-[10px] text-lol-gold-light/55">
            {visiblePlayers.map((player, index) => (
              <span key={player.id} className="inline-flex items-center gap-1">
                <span className="h-0.5 w-4 rounded" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                {player.name}
              </span>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#463714" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: '#f0e6d280', fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: '#463714' }}
                minTickGap={18}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: '#f0e6d280', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `${value}%`}
              />
              <Tooltip
                cursor={false}
                contentStyle={{ backgroundColor: '#091428', border: '1px solid #463714', borderRadius: 8, color: '#f0e6d2' }}
                labelStyle={{ color: '#c89b3c' }}
                formatter={(value, name, item) => {
                  const dataKey = String(item.dataKey);
                  const point = item.payload?.[`${dataKey}_meta`] as PlayerWinrateTrendPoint | undefined;
                  const detail = point
                    ? `최근 ${point.windowSize}경기 ${point.wins}승 ${point.losses}패`
                    : '최근 5경기';
                  return [`${Number(value).toFixed(1)}% · ${detail}`, String(name)];
                }}
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as ChartRow | undefined;
                  return row ? `${row.label} · G${row.gameNumber}` : '';
                }}
              />
              {visiblePlayers.map((player, index) => (
                <Line
                  key={player.id}
                  type="monotone"
                  dataKey={`p_${player.id}`}
                  name={player.name}
                  stroke={COLORS[index % COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </Card>
  );
}
