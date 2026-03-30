import { useState, useMemo } from 'react';
import { useChampions } from '@/hooks/useChampions';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TierBadge, RoleBadge } from '@/components/ui/Badge';
import { ChampionIcon } from '@/components/champions/ChampionIcon';
import { ARAM_ROLE_LABELS, type AramRole, type AramTier } from '@/data/aram-champion-meta';

export function Champions() {
  const { champions, syncing, sync } = useChampions();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<AramRole | ''>('');
  const [tierFilter, setTierFilter] = useState<AramTier | ''>('');

  const filtered = useMemo(() => {
    return champions.filter((c) => {
      if (search && !c.nameKo.includes(search) && !c.id.toLowerCase().includes(search.toLowerCase())) return false;
      if (roleFilter && c.aramRole !== roleFilter) return false;
      if (tierFilter && c.aramTier !== tierFilter) return false;
      return true;
    });
  }, [champions, search, roleFilter, tierFilter]);

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of champions) {
      counts[c.aramRole] = (counts[c.aramRole] ?? 0) + 1;
    }
    return counts;
  }, [champions]);

  const handleSync = async () => {
    const result = await sync();
    alert(`동기화 완료: ${result.added}개 추가, ${result.updated}개 업데이트`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-lol-gold">챔피언 목록</h1>
        <Button variant="secondary" onClick={handleSync} disabled={syncing}>
          {syncing ? '동기화 중...' : '데이터 동기화'}
        </Button>
      </div>

      {/* Role Stats */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(ARAM_ROLE_LABELS).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setRoleFilter(roleFilter === key ? '' : key as AramRole)}
            className={`cursor-pointer px-3 py-1.5 rounded border text-sm transition-colors ${
              roleFilter === key
                ? 'border-lol-gold bg-lol-gold/20 text-lol-gold'
                : 'border-lol-border bg-lol-gray text-lol-gold-light/70 hover:border-lol-gold/50'
            }`}
          >
            {label} ({roleCounts[key] ?? 0})
          </button>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <div className="flex flex-wrap gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="챔피언 검색..."
            className="bg-lol-blue border border-lol-border rounded px-3 py-1.5 text-sm text-lol-gold-light placeholder:text-lol-gold-light/30 focus:outline-none focus:border-lol-gold flex-1 min-w-[200px]"
          />
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value as AramTier | '')}
            className="bg-lol-blue border border-lol-border rounded px-3 py-1.5 text-sm text-lol-gold-light cursor-pointer"
          >
            <option value="">전체 티어</option>
            {(['S', 'A', 'B', 'C', 'D'] as AramTier[]).map((t) => (
              <option key={t} value={t}>{t} 티어</option>
            ))}
          </select>
          <span className="text-sm text-lol-gold-light/50 self-center">
            {filtered.length}개 챔피언
          </span>
        </div>
      </Card>

      {/* Champion Grid */}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
        {filtered.map((champ) => (
          <div
            key={champ.id}
            className="flex flex-col items-center gap-1.5 p-2 bg-lol-gray rounded border border-lol-border hover:border-lol-gold/50 transition-colors"
          >
            <ChampionIcon champion={champ} />
            <span className="text-xs text-lol-gold-light/80 text-center leading-tight">
              {champ.nameKo}
            </span>
            <div className="flex items-center gap-1">
              <TierBadge tier={champ.aramTier} />
              <RoleBadge role={champ.aramRole} />
            </div>
            <span className="text-xs text-lol-gold-light/50">
              {champ.damageType} | {champ.aramWinrate}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
