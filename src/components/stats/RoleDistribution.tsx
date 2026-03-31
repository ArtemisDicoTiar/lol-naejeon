import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import type { FullStats } from '@/lib/stats';
import { Card } from '@/components/ui/Card';

const ROLE_COLORS: Record<string, string> = {
  poke: '#3b82f6', engage: '#ef4444', sustain: '#22c55e',
  dps: '#f97316', tank: '#8b5cf6', utility: '#06b6d4',
};

export function RoleDistribution({ stats }: { stats: FullStats }) {
  const pieData = stats.roleDist.all.map((r) => ({
    name: r.roleKo, value: r.count, fill: ROLE_COLORS[r.role] ?? '#888',
  }));

  const barData = stats.roleDist.all.map((r) => ({
    name: r.roleKo,
    '승률': Math.round(r.winrate),
    '픽 수': r.count,
    fill: ROLE_COLORS[r.role] ?? '#888',
  }));

  if (pieData.length === 0) return null;

  return (
    <Card title="역할별 분포 및 승률">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Pie Chart */}
        <div>
          <div className="text-xs text-lol-gold-light/50 mb-2 text-center">픽 분포</div>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={90}
                dataKey="value" label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                labelLine={{ stroke: '#f0e6d240' }} fontSize={11} fill="#888">
                {pieData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: '#1e2328', border: '1px solid #463714', color: '#f0e6d2', fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Bar Chart - winrate by role */}
        <div>
          <div className="text-xs text-lol-gold-light/50 mb-2 text-center">역할별 승률</div>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={barData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#463714" />
              <XAxis dataKey="name" tick={{ fill: '#f0e6d2', fontSize: 10 }} />
              <YAxis tick={{ fill: '#f0e6d280', fontSize: 10 }} domain={[0, 100]} />
              <Tooltip contentStyle={{ backgroundColor: '#1e2328', border: '1px solid #463714', color: '#f0e6d2', fontSize: 12 }} />
              <Bar dataKey="승률" radius={[4, 4, 0, 0]}>
                {barData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  );
}
