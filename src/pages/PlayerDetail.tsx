import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { db, type Player, type ProficiencyLevel, getPlayerProficiencies, setProficiency } from '@/lib/db';
import { useChampions } from '@/hooks/useChampions';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ProficiencyBadge, TierBadge, RoleBadge } from '@/components/ui/Badge';
import { ChampionIcon } from '@/components/champions/ChampionIcon';
import { ARAM_ROLE_LABELS, type AramRole, type AramTier } from '@/data/aram-champion-meta';

const LEVELS: ProficiencyLevel[] = ['S', '상', '중', '하', '없음'];

export function PlayerDetail() {
  const { id } = useParams<{ id: string }>();
  const { champions } = useChampions();
  const [player, setPlayer] = useState<Player | null>(null);
  const [proficiencies, setProficiencies] = useState<Map<string, ProficiencyLevel>>(new Map());
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<AramRole | ''>('');
  const [tierFilter, setTierFilter] = useState<AramTier | ''>('');
  const [profFilter, setProfFilter] = useState<ProficiencyLevel | ''>('');

  useEffect(() => {
    if (!id) return;
    const playerId = parseInt(id);
    db.players.get(playerId).then((p) => setPlayer(p ?? null));
    getPlayerProficiencies(playerId).then(setProficiencies);
  }, [id]);

  const handleSetProficiency = async (championId: string, level: ProficiencyLevel) => {
    if (!id) return;
    const playerId = parseInt(id);
    await setProficiency(playerId, championId, level);
    setProficiencies(new Map(proficiencies.set(championId, level)));
  };

  const cycleProficiency = (championId: string) => {
    const current = proficiencies.get(championId) ?? '없음';
    const idx = LEVELS.indexOf(current);
    const next = LEVELS[(idx + 1) % LEVELS.length];
    handleSetProficiency(championId, next);
  };

  const filteredChampions = useMemo(() => {
    return champions.filter((c) => {
      if (search && !c.nameKo.includes(search) && !c.id.toLowerCase().includes(search.toLowerCase())) return false;
      if (roleFilter && c.aramRole !== roleFilter) return false;
      if (tierFilter && c.aramTier !== tierFilter) return false;
      if (profFilter) {
        const level = proficiencies.get(c.id) ?? '없음';
        if (level !== profFilter) return false;
      }
      return true;
    });
  }, [champions, search, roleFilter, tierFilter, profFilter, proficiencies]);

  const stats = useMemo(() => {
    const counts: Record<ProficiencyLevel, number> = { 'S': 0, '상': 0, '중': 0, '하': 0, '없음': 0 };
    for (const c of champions) {
      const level = proficiencies.get(c.id) ?? '없음';
      counts[level]++;
    }
    return counts;
  }, [champions, proficiencies]);

  if (!player) {
    return <div className="text-center py-8 text-lol-gold-light/60">선수를 찾을 수 없습니다.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/players" className="text-lol-gold hover:text-lol-gold-light">&larr;</Link>
        <h1 className="text-2xl font-bold text-lol-gold">{player.name} 숙련도</h1>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-4 gap-3">
        {LEVELS.map((level) => (
          <button
            key={level}
            onClick={() => setProfFilter(profFilter === level ? '' : level)}
            className={`cursor-pointer p-3 rounded border text-center transition-colors ${
              profFilter === level ? 'border-lol-gold bg-lol-gold/10' : 'border-lol-border bg-lol-gray hover:border-lol-gold/50'
            }`}
          >
            <ProficiencyBadge level={level} />
            <div className="text-xl font-bold mt-1">{stats[level]}</div>
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
            className="bg-lol-blue border border-lol-border rounded px-3 py-1.5 text-sm text-lol-gold-light placeholder:text-lol-gold-light/30 focus:outline-none focus:border-lol-gold"
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as AramRole | '')}
            className="bg-lol-blue border border-lol-border rounded px-3 py-1.5 text-sm text-lol-gold-light cursor-pointer"
          >
            <option value="">전체 역할</option>
            {Object.entries(ARAM_ROLE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
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
          {(search || roleFilter || tierFilter || profFilter) && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setRoleFilter(''); setTierFilter(''); setProfFilter(''); }}>
              필터 초기화
            </Button>
          )}
        </div>
      </Card>

      {/* Champion Grid */}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
        {filteredChampions.map((champ) => {
          const level = proficiencies.get(champ.id) ?? '없음';
          return (
            <div
              key={champ.id}
              className="flex flex-col items-center gap-1.5 p-2 bg-lol-gray rounded border border-lol-border hover:border-lol-gold/50 transition-colors"
            >
              <ChampionIcon champion={champ} onClick={() => cycleProficiency(champ.id)} />
              <span className="text-xs text-lol-gold-light/80 text-center leading-tight">
                {champ.nameKo}
              </span>
              <div className="flex items-center gap-1">
                <TierBadge tier={champ.aramTier} />
                <RoleBadge role={champ.aramRole} />
              </div>
              <ProficiencyBadge
                level={level}
                size="sm"
                onClick={() => cycleProficiency(champ.id)}
              />
            </div>
          );
        })}
      </div>

      {filteredChampions.length === 0 && (
        <p className="text-center text-lol-gold-light/50 py-8">
          필터 조건에 맞는 챔피언이 없습니다.
        </p>
      )}
    </div>
  );
}
