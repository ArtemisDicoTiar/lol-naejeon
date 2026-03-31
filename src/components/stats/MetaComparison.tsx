import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { FullStats } from '@/lib/stats';
import { Card } from '@/components/ui/Card';

export function MetaComparison({ stats }: { stats: FullStats }) {
  // Top 10 most picked champions, compare internal vs ARAM winrate
  const data = stats.champCompare
    .filter((c) => c.internalPicks >= 1)
    .sort((a, b) => b.internalPicks - a.internalPicks)
    .slice(0, 12)
    .map((c) => ({
      name: c.nameKo,
      '내전 승률': Math.round(c.internalWinrate),
      'ARAM 메타': c.aramWinrate,
      diff: Math.round(c.diff),
    }));

  if (data.length === 0) return null;

  return (
    <Card title="내전 승률 vs ARAM 메타 승률 (상위 픽)">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#463714" />
          <XAxis dataKey="name" tick={{ fill: '#f0e6d2', fontSize: 10 }} angle={-30} textAnchor="end" height={60} />
          <YAxis tick={{ fill: '#f0e6d280', fontSize: 10 }} domain={[0, 100]} />
          <Tooltip contentStyle={{ backgroundColor: '#1e2328', border: '1px solid #463714', color: '#f0e6d2', fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12, color: '#f0e6d2' }} />
          <Bar dataKey="내전 승률" fill="#c89b3c" radius={[2, 2, 0, 0]} />
          <Bar dataKey="ARAM 메타" fill="#4a90d9" radius={[2, 2, 0, 0]} opacity={0.6} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}
