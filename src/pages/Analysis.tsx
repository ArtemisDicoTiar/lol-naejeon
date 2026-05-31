import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { EmptyState, PageHeader, StatusPill } from '@/components/ui/Page';
import {
  computeCompositionAnalysis,
  type ChampionComboAggregate,
  type CompositionAggregate,
  type CompositionAnalysis,
  type CompositionInsight,
  type CompositionModeFilter,
  type TeamCompositionSample,
} from '@/lib/comp-analysis';
import { GAME_MODE_LABELS, type GameMode } from '@/lib/db';

type ChampionMeta = CompositionAnalysis['championMeta'][number];

const modeOptions: Array<{ key: CompositionModeFilter; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'aram', label: GAME_MODE_LABELS.aram },
  { key: 'augmented', label: GAME_MODE_LABELS.augmented },
];

const insightToneClass: Record<CompositionInsight['tone'], string> = {
  gold: 'border-lol-gold/35 bg-lol-gold/10 text-lol-gold',
  green: 'border-prof-high/30 bg-prof-high/10 text-prof-high',
  blue: 'border-blue-500/30 bg-blue-950/30 text-blue-300',
  red: 'border-red-700/35 bg-red-950/25 text-red-300',
  purple: 'border-purple-500/30 bg-purple-950/30 text-purple-300',
};

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function shortDate(date: Date) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' }).format(date);
}

function ChampionMini({ champion, showName = false }: { champion?: ChampionMeta; showName?: boolean }) {
  if (!champion) {
    return <span className="h-8 w-8 rounded-md border border-lol-border/70 bg-lol-dark/70" />;
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="h-8 w-8 shrink-0 overflow-hidden rounded-md border border-lol-border/80 bg-lol-dark">
        <img src={champion.imageUrl} alt={champion.nameKo} className="h-full w-full object-cover" loading="lazy" />
      </span>
      {showName && <span className="truncate text-[11px] text-lol-gold-light/62">{champion.nameKo}</span>}
    </span>
  );
}

function WinrateBar({ value, className = '' }: { value: number; className?: string }) {
  const width = Math.max(4, Math.min(100, value));
  const tone = value >= 58 ? 'bg-prof-high' : value >= 50 ? 'bg-lol-gold' : value >= 42 ? 'bg-blue-400' : 'bg-red-400';
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-lol-dark/80 ${className}`}>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${width}%` }} />
    </div>
  );
}

function ModeToggle({
  modeFilter,
  onChange,
}: {
  modeFilter: CompositionModeFilter;
  onChange: (mode: CompositionModeFilter) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {modeOptions.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
            modeFilter === option.key
              ? 'border-lol-gold/45 bg-lol-gold/16 text-lol-gold'
              : 'border-lol-border/70 bg-lol-dark/25 text-lol-gold-light/50 hover:border-lol-gold/35 hover:text-lol-gold-light'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function InsightGrid({ insights }: { insights: CompositionInsight[] }) {
  if (insights.length === 0) return null;
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {insights.slice(0, 6).map((insight) => (
        <div key={`${insight.title}-${insight.body}`} className={`rounded-xl border p-3 ${insightToneClass[insight.tone]}`}>
          <div className="text-sm font-black">{insight.title}</div>
          <p className="mt-1.5 text-xs leading-5 text-lol-gold-light/64">{insight.body}</p>
        </div>
      ))}
    </div>
  );
}

function AggregateList({
  title,
  rows,
  emptyText,
  limit = 6,
}: {
  title: string;
  rows: CompositionAggregate[];
  emptyText: string;
  limit?: number;
}) {
  return (
    <Card title={title} className="min-h-full">
      {rows.length === 0 ? (
        <div className="py-6 text-center text-sm text-lol-gold-light/45">{emptyText}</div>
      ) : (
        <div className="space-y-2.5">
          {rows.slice(0, limit).map((row, index) => (
            <div key={row.id} className="rounded-lg border border-lol-border/55 bg-lol-dark/22 p-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-lol-gold-light">
                    <span className="mr-1.5 text-lol-gold/55">#{index + 1}</span>
                    {row.label || '분류 없음'}
                  </div>
                  <div className="mt-1 text-[11px] text-lol-gold-light/38">
                    {row.games}표본 · 점유 {formatPercent(row.share)}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-black text-lol-gold">{formatPercent(row.winrate)}</div>
                  <div className="text-[10px] text-lol-gold-light/35">보정 {formatPercent(row.smoothedWinrate)}</div>
                </div>
              </div>
              <WinrateBar value={row.winrate} className="mt-2" />
              {row.examples.length > 0 && (
                <div className="mt-2 truncate text-[11px] text-lol-gold-light/45">
                  예시: {row.examples[0].join(' · ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ComboList({
  title,
  rows,
  championMap,
  emptyText,
}: {
  title: string;
  rows: ChampionComboAggregate[];
  championMap: Map<string, ChampionMeta>;
  emptyText: string;
}) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <div className="py-6 text-center text-sm text-lol-gold-light/45">{emptyText}</div>
      ) : (
        <div className="space-y-2">
          {rows.slice(0, 7).map((row) => (
            <div key={row.id} className="rounded-lg border border-lol-border/55 bg-lol-dark/22 p-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-1.5">
                  {row.championIds.map((id) => (
                    <ChampionMini key={id} champion={championMap.get(id)} />
                  ))}
                  <div className="ml-1 min-w-0">
                    <div className="truncate text-xs font-bold text-lol-gold-light">{row.label}</div>
                    <div className="text-[10px] text-lol-gold-light/38">{row.games}표본</div>
                  </div>
                </div>
                <div className="w-20 shrink-0 text-right">
                  <div className="text-sm font-black text-lol-gold">{formatPercent(row.winrate)}</div>
                  <WinrateBar value={row.winrate} className="mt-1" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function TeamStrip({
  sample,
  championMap,
  won,
}: {
  sample: TeamCompositionSample;
  championMap: Map<string, ChampionMeta>;
  won: boolean;
}) {
  return (
    <div className={`rounded-xl border p-2.5 ${won ? 'border-prof-high/35 bg-prof-high/8' : 'border-lol-border/60 bg-lol-dark/22'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-black text-lol-gold-light">Team {sample.team}</div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${won ? 'border-prof-high/35 text-prof-high' : 'border-lol-border/70 text-lol-gold-light/42'}`}>
          {won ? '승리' : '패배'}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {sample.champions.map((champion) => (
          <ChampionMini key={champion.id} champion={championMap.get(champion.id)} />
        ))}
      </div>
      <div className="mt-2 grid gap-1 text-[11px] text-lol-gold-light/45">
        <span className="truncate">조합: {sample.archetypeLabel}</span>
        <span className="truncate">역할: {sample.roleSignature || '분류 없음'}</span>
        <span className="truncate">특성: {sample.traitSignature || '분류 없음'}</span>
      </div>
    </div>
  );
}

function RecentGames({ analysis, championMap }: { analysis: CompositionAnalysis; championMap: Map<string, ChampionMeta> }) {
  return (
    <Card title="최근 경기 조합 로그">
      {analysis.recentGames.length === 0 ? (
        <div className="py-6 text-center text-sm text-lol-gold-light/45">분석 가능한 최근 경기가 없습니다.</div>
      ) : (
        <div className="space-y-3">
          {analysis.recentGames.map((game) => (
            <div key={game.gameId} className="rounded-xl border border-lol-border/60 bg-lol-dark/16 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-bold text-lol-gold">
                  {shortDate(game.playedAt)} · {game.sessionName} #{game.gameNumber}
                </div>
                <div className="flex gap-1.5 text-[10px]">
                  <span className="rounded-full border border-lol-border/70 px-2 py-0.5 text-lol-gold-light/45">{GAME_MODE_LABELS[game.mode]}</span>
                  <span className="rounded-full border border-lol-border/70 px-2 py-0.5 text-lol-gold-light/45">{game.format}</span>
                </div>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <TeamStrip sample={game.team1} championMap={championMap} won={game.winnerTeam === 1} />
                <TeamStrip sample={game.team2} championMap={championMap} won={game.winnerTeam === 2} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function MatchupList({ analysis }: { analysis: CompositionAnalysis }) {
  return (
    <Card title="조합 상성">
      {analysis.matchups.length === 0 ? (
        <div className="py-6 text-center text-sm text-lol-gold-light/45">같은 상성 표본이 2회 이상 쌓이면 표시됩니다.</div>
      ) : (
        <div className="space-y-2">
          {analysis.matchups.slice(0, 8).map((row) => (
            <div key={row.id} className="rounded-lg border border-lol-border/55 bg-lol-dark/22 p-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-lol-gold-light">{row.ourArchetype}</div>
                  <div className="mt-0.5 truncate text-[11px] text-lol-gold-light/38">vs {row.enemyArchetype} · {row.games}표본</div>
                </div>
                <div className="w-24 shrink-0 text-right">
                  <div className="text-sm font-black text-lol-gold">{formatPercent(row.winrate)}</div>
                  <WinrateBar value={row.winrate} className="mt-1" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function Analysis() {
  const [modeFilter, setModeFilter] = useState<CompositionModeFilter>('all');
  const [analysis, setAnalysis] = useState<CompositionAnalysis | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAnalysis = useCallback((background = false) => {
    if (!background) setLoading(true);
    computeCompositionAnalysis(modeFilter)
      .then(setAnalysis)
      .catch((error) => {
        console.error('Failed to load composition analysis:', error);
        setAnalysis(null);
      })
      .finally(() => {
        if (!background) setLoading(false);
      });
  }, [modeFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => loadAnalysis(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAnalysis]);

  useEffect(() => {
    const handleDataChanged = () => loadAnalysis(true);
    window.addEventListener('lol-data-changed', handleDataChanged);
    return () => window.removeEventListener('lol-data-changed', handleDataChanged);
  }, [loadAnalysis]);

  const championMap = useMemo(() => {
    return new Map((analysis?.championMeta ?? []).map((champion) => [champion.id, champion]));
  }, [analysis]);

  const meta = analysis && (
    <>
      <StatusPill tone="gold">완료 경기 {analysis.completedGames}</StatusPill>
      <StatusPill tone="blue">팀 표본 {analysis.teamSamples}</StatusPill>
      <StatusPill tone="muted">{modeFilter === 'all' ? '전체 모드' : GAME_MODE_LABELS[modeFilter as GameMode]}</StatusPill>
    </>
  );

  if (loading) {
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="Composition Lab"
          title="조합 연구"
          description="내전 기록을 팀 조합 단위로 묶어서 승리 패턴, 챔피언 페어, 상성 후보를 분석합니다."
          actions={<ModeToggle modeFilter={modeFilter} onChange={setModeFilter} />}
        />
        <Card title="분석 계산 중">
          <div className="py-8 text-center text-sm text-lol-gold-light/55">경기 기록과 픽 데이터를 읽는 중입니다.</div>
        </Card>
      </div>
    );
  }

  if (!analysis || analysis.teamSamples === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="Composition Lab"
          title="조합 연구"
          description="내전 기록을 팀 조합 단위로 묶어서 승리 패턴, 챔피언 페어, 상성 후보를 분석합니다."
          actions={<ModeToggle modeFilter={modeFilter} onChange={setModeFilter} />}
        />
        <EmptyState
          title="분석할 조합 표본이 없습니다."
          description="승패와 양 팀 픽이 저장된 경기가 쌓이면 조합 연구가 자동으로 표시됩니다."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Composition Lab"
        title="조합 연구"
        description="실제 내전 데이터를 조합 단위로 재분류해 다음 밴픽에서 참고할 패턴을 뽑습니다. 표본 수가 적은 항목은 보정 승률을 함께 봐야 합니다."
        actions={<ModeToggle modeFilter={modeFilter} onChange={setModeFilter} />}
        meta={meta}
      />

      <InsightGrid insights={analysis.insights} />

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <AggregateList title="승률 좋은 조합 아키타입" rows={analysis.archetypes} emptyText="아키타입 표본이 없습니다." />
        <MatchupList analysis={analysis} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <AggregateList title="데미지 밸런스" rows={analysis.damageProfiles} emptyText="데미지 분포 표본이 없습니다." limit={5} />
        <AggregateList title="핵심 특성 조합" rows={analysis.traitProfiles} emptyText="특성 표본이 없습니다." limit={5} />
        <AggregateList title="역할 구성" rows={analysis.roleProfiles} emptyText="역할 구성 표본이 없습니다." limit={5} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ComboList title="챔피언 페어 후보" rows={analysis.championPairs} championMap={championMap} emptyText="반복된 챔피언 페어가 아직 없습니다." />
        <ComboList title="챔피언 트리오 후보" rows={analysis.championTrios} championMap={championMap} emptyText="반복된 챔피언 트리오가 아직 없습니다." />
      </div>

      <RecentGames analysis={analysis} championMap={championMap} />
    </div>
  );
}
