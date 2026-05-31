import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { EmptyState, PageHeader, StatusPill } from '@/components/ui/Page';
import { usePlayers } from '@/hooks/usePlayers';
import {
  computeBanPickLabAnalysis,
  type BanPickLabAnalysis,
  type BanPickLabModeFilter,
  type LabBan,
  type LabPick,
  type LabPickGroup,
  type LabScenario,
} from '@/lib/banpick-lab';
import { GAME_MODE_LABELS, type GameMode, type Player } from '@/lib/db';

type TeamSide = 'A' | 'B' | 'OUT';

const modeOptions: Array<{ key: BanPickLabModeFilter; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'aram', label: GAME_MODE_LABELS.aram },
  { key: 'augmented', label: GAME_MODE_LABELS.augmented },
];

function pct(value: number) {
  return `${Math.round(value * 100)}`;
}

function deltaText(value: number) {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(1)}`;
}

function scoreTone(score: number) {
  if (score >= 0.72) return 'text-prof-high';
  if (score >= 0.58) return 'text-lol-gold';
  if (score >= 0.48) return 'text-blue-300';
  return 'text-red-300';
}

function ChampionChip({ pick, compact = false }: { pick: LabPick; compact?: boolean }) {
  return (
    <div className={`flex min-w-0 items-center gap-2 rounded-lg border border-lol-border/60 bg-lol-dark/30 ${compact ? 'px-2 py-1' : 'px-2.5 py-2'}`}>
      <img src={pick.imageUrl} alt={pick.championName} className={`${compact ? 'h-7 w-7' : 'h-9 w-9'} shrink-0 rounded-md object-cover`} loading="lazy" />
      <div className="min-w-0">
        <div className="truncate text-xs font-black text-lol-gold-light">{pick.championName}</div>
        <div className="truncate text-[10px] text-lol-gold-light/42">
          {pick.playerName} · {pick.tier} · {pick.proficiency}
        </div>
      </div>
      <div className={`ml-auto shrink-0 text-xs font-black ${scoreTone(pick.score)}`}>{pct(pick.score)}</div>
    </div>
  );
}

function BanChip({ ban }: { ban: LabBan }) {
  return (
    <div className="rounded-lg border border-lol-border/55 bg-lol-dark/24 p-2">
      <div className="flex items-center gap-2">
        <img src={ban.imageUrl} alt={ban.championName} className="h-8 w-8 rounded-md object-cover" loading="lazy" />
        <div className="min-w-0">
          <div className="truncate text-xs font-black text-lol-gold-light">{ban.championName}</div>
          <div className="truncate text-[10px] text-lol-gold-light/42">{ban.reason}</div>
        </div>
        <div className={`ml-auto text-xs font-black ${scoreTone(ban.score)}`}>{pct(ban.score)}</div>
      </div>
      {ban.targetPlayers.length > 0 && (
        <div className="mt-1 truncate text-[10px] text-lol-gold-light/35">
          대상: {ban.targetPlayers.join(', ')}
        </div>
      )}
    </div>
  );
}

function PickGroup({ title, group, compact = false }: { title: string; group: LabPickGroup; compact?: boolean }) {
  return (
    <div className="rounded-xl border border-lol-border/55 bg-lol-dark/18 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-black uppercase tracking-[0.16em] text-lol-gold-light/36">{title}</div>
        <div className={`text-sm font-black ${scoreTone(group.score)}`}>{pct(group.score)}</div>
      </div>
      <div className="grid gap-2">
        {group.picks.map((pick) => <ChampionChip key={`${pick.playerId}-${pick.championId}`} pick={pick} compact={compact} />)}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {group.tags.slice(0, 4).map((tag) => (
          <span key={tag} className="rounded-full border border-lol-border/55 bg-lol-blue/35 px-2 py-0.5 text-[10px] text-lol-gold-light/50">
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: BanPickLabModeFilter; onChange: (mode: BanPickLabModeFilter) => void }) {
  return (
    <div className="flex gap-1.5">
      {modeOptions.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
            mode === option.key
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

function TeamSelector({
  players,
  teamAIds,
  teamBIds,
  onSetTeam,
  onAutoAssign,
}: {
  players: Player[];
  teamAIds: number[];
  teamBIds: number[];
  onSetTeam: (playerId: number, side: TeamSide) => void;
  onAutoAssign: () => void;
}) {
  const sideOf = (playerId: number): TeamSide => {
    if (teamAIds.includes(playerId)) return 'A';
    if (teamBIds.includes(playerId)) return 'B';
    return 'OUT';
  };

  return (
    <Card title="실험 팀 설정">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-lol-gold-light/45">A팀 3명, B팀 3명을 지정하면 바로 시뮬레이션합니다.</div>
        <button
          type="button"
          onClick={onAutoAssign}
          className="cursor-pointer rounded-lg border border-lol-gold/35 bg-lol-gold/10 px-2.5 py-1 text-xs font-bold text-lol-gold hover:bg-lol-gold/16"
        >
          앞 6명 자동 배정
        </button>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {players.map((player) => {
          const playerId = player.id!;
          const side = sideOf(playerId);
          return (
            <div key={playerId} className="rounded-lg border border-lol-border/55 bg-lol-dark/20 p-2">
              <div className="mb-2 truncate text-xs font-bold text-lol-gold-light">{player.name}</div>
              <div className="grid grid-cols-3 gap-1">
                {(['A', 'B', 'OUT'] as TeamSide[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => onSetTeam(playerId, option)}
                    className={`cursor-pointer rounded-md border px-1.5 py-1 text-[10px] font-bold transition-colors ${
                      side === option
                        ? option === 'A'
                          ? 'border-blue-400/50 bg-blue-950/40 text-blue-200'
                          : option === 'B'
                            ? 'border-red-400/50 bg-red-950/35 text-red-200'
                            : 'border-lol-gold/35 bg-lol-gold/12 text-lol-gold'
                        : 'border-lol-border/45 text-lol-gold-light/35 hover:border-lol-gold/25 hover:text-lol-gold-light/70'
                    }`}
                  >
                    {option === 'OUT' ? '제외' : `${option}팀`}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <StatusPill tone={teamAIds.length === 3 ? 'blue' : 'yellow'}>A팀 {teamAIds.length}/3</StatusPill>
        <StatusPill tone={teamBIds.length === 3 ? 'red' : 'yellow'}>B팀 {teamBIds.length}/3</StatusPill>
      </div>
    </Card>
  );
}

function RuleStrip() {
  const steps = [
    { label: '동시 밴', body: 'A/B 모두 3밴', tone: 'border-lol-gold/35 text-lol-gold' },
    { label: 'A 1픽', body: 'S급을 풀고 선점', tone: 'border-blue-400/35 text-blue-300' },
    { label: 'B 2픽', body: 'A급 2개로 조합 응수', tone: 'border-red-400/35 text-red-300' },
    { label: 'A 2픽', body: '상대 2픽 보고 완성', tone: 'border-blue-400/35 text-blue-300' },
    { label: 'B 막픽', body: '완성 조합 카운터', tone: 'border-red-400/35 text-red-300' },
  ];
  return (
    <div className="grid gap-2 md:grid-cols-5">
      {steps.map((step, index) => (
        <div key={step.label} className={`rounded-xl border bg-lol-dark/18 p-3 ${step.tone}`}>
          <div className="text-[10px] font-black uppercase tracking-[0.18em] opacity-60">Step {index + 1}</div>
          <div className="mt-1 text-sm font-black">{step.label}</div>
          <div className="mt-1 text-xs text-lol-gold-light/45">{step.body}</div>
        </div>
      ))}
    </div>
  );
}

function BanPlan({ analysis }: { analysis: BanPickLabAnalysis }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="A팀 동시 밴 추천">
        <div className="space-y-2">
          {analysis.banPlanA.map((ban) => <BanChip key={ban.championId} ban={ban} />)}
        </div>
      </Card>
      <Card title="B팀 동시 밴 추천">
        <div className="space-y-2">
          {analysis.banPlanB.map((ban) => <BanChip key={ban.championId} ban={ban} />)}
        </div>
      </Card>
    </div>
  );
}

function FirstPickPanel({ picks }: { picks: LabPick[] }) {
  return (
    <Card title="A 1픽으로 풀고 먹을 후보">
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        {picks.slice(0, 5).map((pick) => (
          <div key={`${pick.playerId}-${pick.championId}`} className="rounded-xl border border-lol-border/55 bg-lol-dark/20 p-2.5">
            <ChampionChip pick={pick} />
            <div className="mt-2 flex flex-wrap gap-1">
              {pick.reasons.slice(0, 3).map((reason) => (
                <span key={reason} className="rounded-full border border-lol-border/55 px-2 py-0.5 text-[10px] text-lol-gold-light/46">{reason}</span>
              ))}
            </div>
            <div className="mt-2 text-[10px] text-lol-gold-light/36">
              B 경쟁도 {pct(pick.contestedScore)}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function VerdictBadge({ scenario }: { scenario: LabScenario }) {
  const cls = scenario.verdict === 'A 우세'
    ? 'border-blue-400/45 bg-blue-950/35 text-blue-200'
    : scenario.verdict === 'B 카운터'
      ? 'border-red-400/45 bg-red-950/35 text-red-200'
      : 'border-lol-gold/35 bg-lol-gold/10 text-lol-gold';
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${cls}`}>
      {scenario.verdict} {deltaText(scenario.scoreDelta)}
    </span>
  );
}

function ScenarioCard({ scenario, index }: { scenario: LabScenario; index: number }) {
  const riskCls = scenario.risk === '높음' ? 'text-red-300' : scenario.risk === '중간' ? 'text-yellow-300' : 'text-prof-high';
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-lol-gold/50">Scenario #{index + 1}</div>
          <div className="mt-1 text-base font-black text-lol-gold-light">{scenario.title}</div>
          <div className={`mt-1 text-xs font-bold ${riskCls}`}>밴 리스크 {scenario.risk}</div>
        </div>
        <VerdictBadge scenario={scenario} />
      </div>

      <div className="grid gap-3 xl:grid-cols-[0.8fr_1fr_1fr_0.8fr]">
        <div className="rounded-xl border border-blue-400/25 bg-blue-950/14 p-2.5">
          <div className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-blue-300/60">A 1픽</div>
          <ChampionChip pick={scenario.aFirst} />
        </div>
        <PickGroup title="B 2픽 응수" group={scenario.bResponse} compact />
        <PickGroup title="A 2픽 완성" group={scenario.aCompletion} compact />
        <PickGroup title="B 막픽 카운터" group={scenario.bFinal} compact />
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_1.2fr]">
        <div className="rounded-lg border border-lol-border/55 bg-lol-dark/18 p-2">
          <div className="text-[10px] text-lol-gold-light/36">최종 조합 점수</div>
          <div className="mt-1 flex items-center justify-between text-sm font-black">
            <span className="text-blue-300">A {pct(scenario.aFinalScore)}</span>
            <span className="text-red-300">B {pct(scenario.bFinalScore)}</span>
          </div>
        </div>
        <div className="rounded-lg border border-lol-border/55 bg-lol-dark/18 p-2">
          <div className="text-[10px] text-lol-gold-light/36">시나리오 밴 가정</div>
          <div className="mt-1 truncate text-xs text-lol-gold-light/55">
            A {scenario.assumedBans.teamA.map((ban) => ban.championName).join(', ')}
          </div>
          <div className="truncate text-xs text-lol-gold-light/42">
            B {scenario.assumedBans.teamB.map((ban) => ban.championName).join(', ')}
          </div>
        </div>
        <div className="rounded-lg border border-lol-border/55 bg-lol-dark/18 p-2">
          <div className="text-[10px] text-lol-gold-light/36">해석</div>
          <div className="mt-1 space-y-0.5">
            {scenario.notes.slice(0, 3).map((note) => (
              <div key={note} className="truncate text-xs text-lol-gold-light/50">{note}</div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

export function BanPickLab() {
  const { players, loading: playersLoading } = usePlayers();
  const [modeFilter, setModeFilter] = useState<BanPickLabModeFilter>('all');
  const [teamAIds, setTeamAIds] = useState<number[]>([]);
  const [teamBIds, setTeamBIds] = useState<number[]>([]);
  const [analysis, setAnalysis] = useState<BanPickLabAnalysis | null>(null);
  const [loading, setLoading] = useState(false);

  const autoAssign = useCallback(() => {
    const ids = players.map((player) => player.id!).filter(Boolean);
    setTeamAIds(ids.slice(0, 3));
    setTeamBIds(ids.slice(3, 6));
  }, [players]);

  useEffect(() => {
    if (players.length >= 6 && teamAIds.length === 0 && teamBIds.length === 0) {
      const timer = window.setTimeout(autoAssign, 0);
      return () => window.clearTimeout(timer);
    }
  }, [autoAssign, players.length, teamAIds.length, teamBIds.length]);

  const setPlayerTeam = (playerId: number, side: TeamSide) => {
    setTeamAIds((prev) => prev.filter((id) => id !== playerId));
    setTeamBIds((prev) => prev.filter((id) => id !== playerId));
    if (side === 'A') setTeamAIds((prev) => [...prev, playerId]);
    if (side === 'B') setTeamBIds((prev) => [...prev, playerId]);
  };

  const canAnalyze = teamAIds.length === 3 && teamBIds.length === 3;
  const selectedKey = useMemo(() => `${modeFilter}:${teamAIds.join(',')}:${teamBIds.join(',')}`, [modeFilter, teamAIds, teamBIds]);

  useEffect(() => {
    if (!canAnalyze) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      computeBanPickLabAnalysis(teamAIds, teamBIds, modeFilter)
        .then((result) => {
          if (!cancelled) setAnalysis(result);
        })
        .catch((error) => {
          console.error('Failed to compute banpick lab:', error);
          if (!cancelled) setAnalysis(null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [canAnalyze, modeFilter, selectedKey, teamAIds, teamBIds]);

  useEffect(() => {
    const handleDataChanged = () => {
      if (!canAnalyze) return;
      void computeBanPickLabAnalysis(teamAIds, teamBIds, modeFilter).then(setAnalysis);
    };
    window.addEventListener('lol-data-changed', handleDataChanged);
    return () => window.removeEventListener('lol-data-changed', handleDataChanged);
  }, [canAnalyze, modeFilter, teamAIds, teamBIds]);

  const meta = (
    <>
      <StatusPill tone="blue">A팀 {teamAIds.length}/3</StatusPill>
      <StatusPill tone="red">B팀 {teamBIds.length}/3</StatusPill>
      <StatusPill tone="muted">{modeFilter === 'all' ? '전체 모드' : GAME_MODE_LABELS[modeFilter as GameMode]}</StatusPill>
    </>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Draft Laboratory"
        title="밴픽 실험실"
        description="동시 3밴 이후 A 1픽, B 2픽, A 2픽, B 막픽 순서를 실제 숙련도/메타/시너지/카운터 데이터로 시뮬레이션합니다."
        actions={<ModeToggle mode={modeFilter} onChange={setModeFilter} />}
        meta={meta}
      />

      <RuleStrip />

      <TeamSelector
        players={players}
        teamAIds={teamAIds}
        teamBIds={teamBIds}
        onSetTeam={setPlayerTeam}
        onAutoAssign={autoAssign}
      />

      {playersLoading && (
        <Card title="선수 로딩 중">
          <div className="py-6 text-center text-sm text-lol-gold-light/50">선수 목록을 불러오는 중입니다.</div>
        </Card>
      )}

      {!playersLoading && players.length < 6 && (
        <EmptyState title="밴픽 실험실에는 최소 6명이 필요합니다." description="3v3 기준 A팀 3명, B팀 3명을 지정해야 시뮬레이션할 수 있습니다." />
      )}

      {!playersLoading && players.length >= 6 && !canAnalyze && (
        <EmptyState title="A/B 팀을 각각 3명씩 지정해주세요." description="현재 밴픽 룰이 3픽 구조라서 정확히 3명씩 선택해야 합니다." />
      )}

      {canAnalyze && loading && (
        <Card title="실험 계산 중">
          <div className="py-6 text-center text-sm text-lol-gold-light/50">밴/픽 후보와 대응 시나리오를 계산하는 중입니다.</div>
        </Card>
      )}

      {canAnalyze && analysis && !loading && (
        <>
          <BanPlan analysis={analysis} />
          <FirstPickPanel picks={analysis.firstPickPlans} />
          <div className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-lol-gold-light">밴픽 시나리오</h2>
                <p className="mt-1 text-sm text-lol-gold-light/45">A가 특정 1픽을 먹었을 때 B가 2픽과 막픽으로 얼마나 따라잡는지 봅니다.</p>
              </div>
              <StatusPill tone="gold">{analysis.scenarios.length}개 플랜</StatusPill>
            </div>
            {analysis.scenarios.length === 0 ? (
              <EmptyState title="생성 가능한 시나리오가 없습니다." description="선수별 숙련도 등록이 부족하거나 선택 가능한 챔피언 풀이 너무 좁습니다." />
            ) : (
              <div className="space-y-4">
                {analysis.scenarios.map((scenario, index) => (
                  <ScenarioCard key={scenario.id} scenario={scenario} index={index} />
                ))}
              </div>
            )}
          </div>

          <Card title="계산 기준">
            <div className="grid gap-2 text-xs text-lol-gold-light/48 md:grid-cols-3">
              {analysis.dataNotes.map((note) => (
                <div key={note} className="rounded-lg border border-lol-border/55 bg-lol-dark/18 p-2">{note}</div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
