import { useEffect, useMemo, useState } from 'react';
import type { Champion } from '@/lib/db';
import type { ChampionEogSummaryEntry, FullStats } from '@/lib/stats';
import { ARAM_ROLE_LABELS, type AramRole } from '@/data/aram-champion-meta';
import { ChampionIcon } from '@/components/champions/ChampionIcon';
import { Card } from '@/components/ui/Card';
import { loadSynergyCounterData, type SynergyCounterData } from '@/lib/recommendation/data-loader';

type SortMode = 'power' | 'meta' | 'internal' | 'synergy' | 'counter' | 'damage';

interface ChampionPowerRow {
  champion: Champion;
  powerScore: number;
  metaScore: number;
  internalScore: number;
  synergyScore: number;
  counterScore: number;
  internalPicks: number;
  internalBans: number;
  internalWinrate: number;
  internalDiff: number;
  presence: number;
  synergyWinrate: number;
  synergyGames: number;
  bestPartnerId?: string;
  bestPartnerWinrate: number;
  counterWinrate: number;
  counterGames: number;
  strongCount: number;
  weakCount: number;
  eog?: ChampionEogSummaryEntry;
  reasons: string[];
}

interface ChampionSynergySummary {
  winrate: number;
  games: number;
  bestPartnerId?: string;
  bestPartnerWinrate: number;
}

const TIER_SCORE: Record<string, number> = {
  S: 100,
  A: 82,
  B: 64,
  C: 44,
  D: 24,
};

const SORT_OPTIONS: Array<{ key: SortMode; label: string }> = [
  { key: 'power', label: '사기지수' },
  { key: 'meta', label: 'ARAM 메타' },
  { key: 'internal', label: '내전 과성능' },
  { key: 'synergy', label: '시너지' },
  { key: 'counter', label: '카운터' },
  { key: 'damage', label: '딜량' },
];

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function normalize(value: number, min: number, max: number) {
  if (max <= min) return 50;
  return clamp(((value - min) / (max - min)) * 100);
}

function weightedAverage(rows: Array<{ winrate: number; games: number }>, fallback = 50) {
  const total = rows.reduce((sum, row) => sum + row.games, 0);
  if (total === 0) return fallback;
  return rows.reduce((sum, row) => sum + row.winrate * row.games, 0) / total;
}

function formatPercent(value: number, digits = 0) {
  return `${value.toFixed(digits)}%`;
}

function formatNumber(value: number) {
  return Math.round(value).toLocaleString('ko-KR');
}

function buildSynergySummaryByChampion(data: SynergyCounterData | null): Map<string, ChampionSynergySummary> {
  const totals = new Map<string, { weightedWinrate: number; games: number; bestPartnerId?: string; bestPartnerWinrate: number }>();
  if (!data) return new Map();

  const applyEntry = (championId: string, partnerId: string | undefined, winrate: number, total: number) => {
    const current = totals.get(championId) ?? { weightedWinrate: 0, games: 0, bestPartnerWinrate: 0 };
    current.weightedWinrate += winrate * total;
    current.games += total;
    if (partnerId && total >= 30 && winrate > current.bestPartnerWinrate) {
      current.bestPartnerId = partnerId;
      current.bestPartnerWinrate = winrate;
    }
    totals.set(championId, current);
  };

  for (const [key, entry] of Object.entries(data.synergies)) {
    const ids = key.split('+');
    if (ids.length !== 2) continue;
    applyEntry(ids[0], ids[1], entry.winrate, entry.total);
    applyEntry(ids[1], ids[0], entry.winrate, entry.total);
  }

  const summaries = new Map<string, ChampionSynergySummary>();
  for (const [championId, row] of totals) {
    summaries.set(championId, {
      winrate: row.games > 0 ? row.weightedWinrate / row.games : 50,
      games: row.games,
      bestPartnerId: row.bestPartnerId,
      bestPartnerWinrate: row.bestPartnerWinrate,
    });
  }
  return summaries;
}

function buildReasons(row: Omit<ChampionPowerRow, 'reasons'>) {
  const reasons: string[] = [];
  if (row.champion.aramTier === 'S') reasons.push('S티어');
  if (row.champion.aramWinrate >= 54) reasons.push(`ARAM ${formatPercent(row.champion.aramWinrate, 1)}`);
  if (row.internalPicks >= 2 && row.internalDiff >= 8) reasons.push(`내전 +${Math.round(row.internalDiff)}%p`);
  if (row.presence >= 25) reasons.push(`존재감 ${Math.round(row.presence)}%`);
  if (row.synergyGames >= 200 && row.synergyWinrate >= 53) reasons.push('시너지 우수');
  if (row.strongCount >= 5 && row.counterWinrate >= 53) reasons.push('카운터 폭 넓음');
  if (row.eog && row.eog.games >= 2 && row.eog.avgDamageDealtToChampions >= 25000) reasons.push('딜 로그 높음');
  return reasons.slice(0, 3);
}

function buildChampionRows(stats: FullStats, data: SynergyCounterData | null): ChampionPowerRow[] {
  const eogByChampionId = new Map(stats.championEogSummary.map((entry) => [entry.championId, entry]));
  const maxDamage = Math.max(...stats.championEogSummary.map((entry) => entry.avgDamageDealtToChampions), 1);
  const synergySummaryByChampion = buildSynergySummaryByChampion(data);

  return stats.champions.map((champion) => {
    const internal = stats.wrStats.champOverallStats[champion.id];
    const eog = eogByChampionId.get(champion.id);
    const synergy = synergySummaryByChampion.get(champion.id) ?? {
      winrate: 50,
      games: 0,
      bestPartnerId: undefined,
      bestPartnerWinrate: 0,
    };
    const counter = data?.counters[champion.id];
    const strongRows = counter?.strongAgainst ?? [];
    const weakRows = counter?.weakAgainst ?? [];
    const counterGames = strongRows.reduce((sum, row) => sum + row.games, 0);
    const strongWinrate = weightedAverage(strongRows, 50);
    const weakWinrate = weightedAverage(weakRows, 50);
    const weakPenalty = clamp(50 - weakWinrate, 0, 12);

    const internalPicks = internal?.picks ?? 0;
    const internalBans = internal?.bans ?? 0;
    const internalWinrate = internal?.winrate ?? champion.aramWinrate;
    const presence = (internal?.pickRate ?? 0) + (internal?.banRate ?? 0);
    const smoothedInternalWinrate = internalPicks > 0
      ? ((internalWinrate * internalPicks) + champion.aramWinrate * 4) / (internalPicks + 4)
      : champion.aramWinrate;

    const metaScore = clamp(normalize(champion.aramWinrate, 45, 57) * 0.62 + (TIER_SCORE[champion.aramTier] ?? 60) * 0.38);
    const internalScore = clamp(normalize(smoothedInternalWinrate, 45, 62) * 0.72 + normalize(presence, 0, 35) * 0.28);
    const synergyScore = synergy.games > 0
      ? clamp(normalize(synergy.winrate, 47, 57) * 0.76 + normalize(Math.log10(synergy.games + 1), 1, 4) * 0.24)
      : 50;
    const counterScore = counterGames > 0
      ? clamp(normalize(strongWinrate - weakPenalty * 0.35, 47, 57) * 0.78 + normalize(Math.log10(counterGames + 1), 1, 4) * 0.22)
      : 50;
    const damageBonus = eog ? normalize(eog.avgDamageDealtToChampions, 0, maxDamage) : 50;
    const powerScore = clamp(
      metaScore * 0.34
      + internalScore * 0.24
      + synergyScore * 0.18
      + counterScore * 0.18
      + damageBonus * 0.06,
    );

    const rowBase = {
      champion,
      powerScore,
      metaScore,
      internalScore,
      synergyScore,
      counterScore,
      internalPicks,
      internalBans,
      internalWinrate,
      internalDiff: internalWinrate - champion.aramWinrate,
      presence,
      synergyWinrate: synergy.winrate,
      synergyGames: synergy.games,
      bestPartnerId: synergy.bestPartnerId,
      bestPartnerWinrate: synergy.bestPartnerWinrate,
      counterWinrate: strongWinrate,
      counterGames,
      strongCount: strongRows.length,
      weakCount: weakRows.length,
      eog,
    };

    return { ...rowBase, reasons: buildReasons(rowBase) };
  });
}

function sortRows(rows: ChampionPowerRow[], sortMode: SortMode) {
  return [...rows].sort((a, b) => {
    if (sortMode === 'meta') return b.metaScore - a.metaScore;
    if (sortMode === 'internal') return (b.internalScore + b.internalDiff) - (a.internalScore + a.internalDiff);
    if (sortMode === 'synergy') return b.synergyScore - a.synergyScore;
    if (sortMode === 'counter') return b.counterScore - a.counterScore;
    if (sortMode === 'damage') return (b.eog?.avgDamageDealtToChampions ?? 0) - (a.eog?.avgDamageDealtToChampions ?? 0);
    return b.powerScore - a.powerScore;
  });
}

function TopCard({ title, row, subtitle }: { title: string; row?: ChampionPowerRow; subtitle: string }) {
  if (!row) {
    return (
      <div className="rounded-2xl border border-lol-border/70 bg-lol-dark/35 p-4">
        <div className="text-xs text-lol-gold-light/45">{title}</div>
        <div className="mt-3 text-sm text-lol-gold-light/40">데이터 없음</div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-lol-gold/20 bg-gradient-to-br from-lol-dark/80 to-lol-blue/40 p-4">
      <div className="text-xs text-lol-gold-light/45">{title}</div>
      <div className="mt-3 flex items-center gap-3">
        <ChampionIcon champion={row.champion} size="sm" />
        <div className="min-w-0">
          <div className="truncate text-base font-bold text-lol-gold">{row.champion.nameKo}</div>
          <div className="text-xs text-lol-gold-light/45">{subtitle}</div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-xl font-black text-lol-gold">{Math.round(row.powerScore)}</div>
          <div className="text-[10px] text-lol-gold-light/35">SCORE</div>
        </div>
      </div>
    </div>
  );
}

export function ChampionPowerRanking({ stats }: { stats: FullStats }) {
  const [data, setData] = useState<SynergyCounterData | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('power');
  const [roleFilter, setRoleFilter] = useState<AramRole | 'all'>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadSynergyCounterData().then(setData);
  }, []);

  const championById = useMemo(() => new Map(stats.champions.map((champion) => [champion.id, champion])), [stats.champions]);
  const rows = useMemo(() => buildChampionRows(stats, data), [data, stats]);
  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (roleFilter !== 'all' && row.champion.aramRole !== roleFilter) return false;
      if (!query) return true;
      return row.champion.nameKo.includes(search.trim()) || row.champion.id.toLowerCase().includes(query);
    });
    return sortRows(filtered, sortMode);
  }, [roleFilter, rows, search, sortMode]);

  const highlights = useMemo(() => {
    const byPower = sortRows(rows, 'power')[0];
    const byInternal = [...rows]
      .filter((row) => row.internalPicks >= 2)
      .sort((a, b) => b.internalDiff - a.internalDiff)[0];
    const bySynergy = [...rows]
      .filter((row) => row.synergyGames >= 100)
      .sort((a, b) => b.synergyScore - a.synergyScore)[0];
    const byCounter = [...rows]
      .filter((row) => row.counterGames >= 100)
      .sort((a, b) => b.counterScore - a.counterScore)[0];
    return { byPower, byInternal, bySynergy, byCounter };
  }, [rows]);

  return (
    <Card title="챔피언 파워 랭킹">
      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <TopCard title="종합 사기픽" row={highlights.byPower} subtitle="메타·내전·시너지·카운터 합산" />
        <TopCard title="내전 과성능" row={highlights.byInternal} subtitle="우리 기록에서 메타 대비 높은 픽" />
        <TopCard title="시너지 엔진" row={highlights.bySynergy} subtitle="외부 조합 데이터 기준" />
        <TopCard title="카운터 카드" row={highlights.byCounter} subtitle="강한 상대 폭이 넓은 픽" />
      </div>

      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap gap-2">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.key}
              onClick={() => setSortMode(option.key)}
              className={`cursor-pointer rounded border px-3 py-1 text-sm transition-colors ${
                sortMode === option.key
                  ? 'border-lol-gold bg-lol-gold/20 text-lol-gold'
                  : 'border-lol-border text-lol-gold-light/50 hover:border-lol-gold/50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="챔피언 검색..."
            className="min-w-[180px] rounded border border-lol-border bg-lol-blue px-3 py-1.5 text-sm text-lol-gold-light placeholder:text-lol-gold-light/30 focus:border-lol-gold focus:outline-none"
          />
          <select
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value as AramRole | 'all')}
            className="cursor-pointer rounded border border-lol-border bg-lol-blue px-3 py-1.5 text-sm text-lol-gold-light"
          >
            <option value="all">전체 역할</option>
            {Object.entries(ARAM_ROLE_LABELS).map(([role, label]) => (
              <option key={role} value={role}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-3 text-xs text-lol-gold-light/45">
        사기지수는 ARAM 티어/승률, 내전 픽밴/승률, 외부 시너지/카운터 데이터, 수집된 전투 로그를 100점 기준으로 정규화한 값입니다.
        {data ? ` 외부 데이터 ${data.matchCount.toLocaleString('ko-KR')}경기 기반.` : ' 외부 시너지/카운터 데이터 로딩 중.'}
      </div>

      <div className="max-h-[560px] overflow-auto rounded border border-lol-border/60">
        <table className="w-full min-w-[980px] text-xs">
          <thead className="sticky top-0 bg-lol-gray">
            <tr className="border-b border-lol-border text-lol-gold-light/50">
              <th className="px-3 py-2 text-left">챔피언</th>
              <th className="px-3 py-2 text-right">사기지수</th>
              <th className="px-3 py-2 text-right">ARAM</th>
              <th className="px-3 py-2 text-right">내전</th>
              <th className="px-3 py-2 text-right">존재감</th>
              <th className="px-3 py-2 text-right">시너지</th>
              <th className="px-3 py-2 text-right">카운터</th>
              <th className="px-3 py-2 text-right">전투 로그</th>
              <th className="px-3 py-2 text-left">근거</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const partner = row.bestPartnerId ? championById.get(row.bestPartnerId) : undefined;
              return (
                <tr key={row.champion.id} className="border-b border-lol-border/20 hover:bg-lol-blue/30">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <ChampionIcon champion={row.champion} size="sm" />
                      <div>
                        <div className="font-medium text-lol-gold-light">{row.champion.nameKo}</div>
                        <div className="text-[10px] text-lol-gold-light/35">
                          {row.champion.aramTier} · {ARAM_ROLE_LABELS[row.champion.aramRole]} · {row.champion.damageType}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="text-lg font-black text-lol-gold">{Math.round(row.powerScore)}</div>
                    <div className="text-[10px] text-lol-gold-light/35">/100</div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-lol-gold-light/70">
                    <div>{formatPercent(row.champion.aramWinrate, 1)}</div>
                    <div className="text-[10px] text-lol-gold-light/35">메타 {Math.round(row.metaScore)}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    <div className={row.internalPicks >= 2 && row.internalDiff > 0 ? 'text-prof-high' : 'text-lol-gold-light/60'}>
                      {row.internalPicks > 0 ? formatPercent(row.internalWinrate) : '-'}
                    </div>
                    <div className="text-[10px] text-lol-gold-light/35">
                      {row.internalPicks}픽 {row.internalBans}밴
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-lol-gold-light/60">
                    {formatPercent(row.presence)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-lol-gold-light/60">
                    <div>{row.synergyGames > 0 ? formatPercent(row.synergyWinrate, 1) : '-'}</div>
                    <div className="text-[10px] text-lol-gold-light/35">
                      {partner ? `${partner.nameKo} ${formatPercent(row.bestPartnerWinrate, 1)}` : `${row.synergyGames.toLocaleString('ko-KR')}게임`}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-lol-gold-light/60">
                    <div>{row.counterGames > 0 ? formatPercent(row.counterWinrate, 1) : '-'}</div>
                    <div className="text-[10px] text-lol-gold-light/35">
                      강함 {row.strongCount} · 약함 {row.weakCount}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-lol-gold-light/60">
                    <div>{row.eog ? formatNumber(row.eog.avgDamageDealtToChampions) : '-'}</div>
                    <div className="text-[10px] text-lol-gold-light/35">
                      {row.eog ? `${row.eog.games}게임 · CC ${formatNumber(row.eog.avgTimeCCingOthers)}초` : '수집 없음'}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(row.reasons.length > 0 ? row.reasons : ['관찰 필요']).map((reason) => (
                        <span key={reason} className="rounded border border-lol-gold/25 bg-lol-gold/10 px-2 py-0.5 text-[10px] text-lol-gold">
                          {reason}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
