import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { db, type Player, type ProficiencyLevel, getPlayerProficiencies, setProficiency } from '@/lib/db';
import { useChampions } from '@/hooks/useChampions';
import { Button } from '@/components/ui/Button';
import { EmptyState, FilterBar, PageHeader, StatusPill } from '@/components/ui/Page';
import { ProficiencyBadge, TierBadge, RoleBadge } from '@/components/ui/Badge';
import { ChampionIcon } from '@/components/champions/ChampionIcon';
import { ARAM_ROLE_LABELS, type AramRole, type AramTier } from '@/data/aram-champion-meta';
import { computeWinrateStats, type WinrateStats } from '@/lib/recommendation/winrate';
import { estimatePlayerProficiencies, type EstimatedProficiency } from '@/lib/recommendation/proficiency-estimator';

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
  const [wrStats, setWrStats] = useState<WinrateStats | null>(null);
  const [applyMsg, setApplyMsg] = useState('');

  useEffect(() => {
    if (!id) return;
    const playerId = parseInt(id);
    db.players.get(playerId).then((p) => setPlayer(p ?? null));
    getPlayerProficiencies(playerId).then(setProficiencies);
  }, [id]);

  useEffect(() => { computeWinrateStats().then(setWrStats); }, []);

  // Auto-estimated proficiencies from game history (only for champs where
  // manual is '없음' or unset). Keyed by championId.
  const estimates = useMemo<Map<string, EstimatedProficiency>>(() => {
    if (!id || !wrStats || champions.length === 0) return new Map();
    const playerId = parseInt(id);
    const aramWrMap = new Map(champions.map((c) => [c.id, c.aramWinrate]));
    return estimatePlayerProficiencies(playerId, proficiencies, champions.map((c) => c.id), aramWrMap, wrStats);
  }, [id, wrStats, champions, proficiencies]);

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

  // Bulk-apply: write high-confidence estimates → manual proficiencies. Only
  // touches champs where the user has not already set a level.
  const applyAllEstimates = async () => {
    if (!id) return;
    const playerId = parseInt(id);
    const toApply: Array<[string, ProficiencyLevel]> = [];
    for (const [champId, est] of estimates) {
      if (est.confidence === 'low') continue; // skip 1-game estimates
      const existing = proficiencies.get(champId);
      if (existing && existing !== '없음') continue;
      toApply.push([champId, est.level]);
    }
    if (toApply.length === 0) {
      setApplyMsg('적용할 자동 추정이 없습니다 (이미 모두 수동 설정됨).');
      return;
    }
    if (!confirm(`${toApply.length}개 챔피언에 자동 추정 숙련도를 일괄 적용하시겠습니까? 수동으로 설정된 항목은 건드리지 않습니다.`)) return;
    for (const [champId, level] of toApply) {
      await setProficiency(playerId, champId, level);
    }
    const fresh = await getPlayerProficiencies(playerId);
    setProficiencies(fresh);
    setApplyMsg(`${toApply.length}개 챔피언에 자동 추정 숙련도 적용 완료.`);
  };

  // Effective level for filter/stats: manual takes priority, estimate fills
  // when manual is unset or '없음'.
  const effectiveLevel = (champId: string): ProficiencyLevel => {
    const manual = proficiencies.get(champId);
    if (manual && manual !== '없음') return manual;
    const est = estimates.get(champId);
    if (est) return est.level;
    return '없음';
  };

  const filteredChampions = useMemo(() => {
    return champions.filter((c) => {
      if (search && !c.nameKo.includes(search) && !c.id.toLowerCase().includes(search.toLowerCase())) return false;
      if (roleFilter && c.aramRole !== roleFilter) return false;
      if (tierFilter && c.aramTier !== tierFilter) return false;
      if (profFilter) {
        if (effectiveLevel(c.id) !== profFilter) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [champions, search, roleFilter, tierFilter, profFilter, proficiencies, estimates]);

  const stats = useMemo(() => {
    const counts: Record<ProficiencyLevel, number> = { 'S': 0, '상': 0, '중': 0, '하': 0, '없음': 0 };
    for (const c of champions) counts[effectiveLevel(c.id)]++;
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [champions, proficiencies, estimates]);

  const pendingEstimateCount = useMemo(() => {
    let n = 0;
    for (const [champId, est] of estimates) {
      if (est.confidence === 'low') continue;
      const m = proficiencies.get(champId);
      if (!m || m === '없음') n++;
    }
    return n;
  }, [estimates, proficiencies]);

  if (!player) {
    return (
      <EmptyState
        title="선수를 찾을 수 없습니다."
        action={<Link to="/players"><Button>선수 목록으로</Button></Link>}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Player Proficiency"
        title={`${player.name} 숙련도`}
        description="수동 숙련도와 게임 기록 기반 자동 추정값을 같이 관리합니다."
        meta={(
          <>
            <StatusPill tone="gold">{champions.length}개 챔피언</StatusPill>
            {pendingEstimateCount > 0 && <StatusPill tone="blue">자동 추정 {pendingEstimateCount}개</StatusPill>}
          </>
        )}
        actions={(
          <>
            <Link to="/players"><Button variant="ghost">선수 목록</Button></Link>
            {pendingEstimateCount > 0 && (
          <Button variant="secondary" size="sm" onClick={applyAllEstimates}>
            자동 추정 {pendingEstimateCount}개 일괄 적용
          </Button>
            )}
          </>
        )}
      />

      {applyMsg && (
        <StatusPill tone="gold" className="rounded-lg px-3 py-2">{applyMsg}</StatusPill>
      )}

      <div className="text-xs text-lol-gold-light/40">
        점선 (~상) 뱃지는 게임 기록 기반 자동 추정. 클릭하면 수동으로 고정합니다.
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
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
      <FilterBar summary={`${filteredChampions.length}개 표시`}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="챔피언 검색..."
          className="min-w-[180px] rounded border border-lol-border bg-lol-blue px-3 py-1.5 text-sm text-lol-gold-light placeholder:text-lol-gold-light/30 focus:outline-none focus:border-lol-gold"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as AramRole | '')}
          className="rounded border border-lol-border bg-lol-blue px-3 py-1.5 text-sm text-lol-gold-light cursor-pointer"
        >
          <option value="">전체 역할</option>
          {Object.entries(ARAM_ROLE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value as AramTier | '')}
          className="rounded border border-lol-border bg-lol-blue px-3 py-1.5 text-sm text-lol-gold-light cursor-pointer"
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
      </FilterBar>

      {/* Champion Grid */}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
        {filteredChampions.map((champ) => {
          const manual = proficiencies.get(champ.id);
          const est = estimates.get(champ.id);
          const displayLevel = (manual && manual !== '없음') ? manual : (est?.level ?? '없음');
          const isEstimated = (!manual || manual === '없음') && !!est;
          return (
            <div
              key={champ.id}
              className="flex flex-col items-center gap-1.5 p-2 bg-lol-gray rounded border border-lol-border hover:border-lol-gold/50 transition-colors"
              title={isEstimated && est ? `자동 추정: ${est.reason}` : undefined}
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
                level={displayLevel}
                size="sm"
                estimated={isEstimated}
                onClick={() => cycleProficiency(champ.id)}
              />
            </div>
          );
        })}
      </div>

      {filteredChampions.length === 0 && (
        <EmptyState title="필터 조건에 맞는 챔피언이 없습니다." />
      )}
    </div>
  );
}
