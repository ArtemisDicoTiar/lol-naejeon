import type { RecommendedComp } from '@/lib/recommendation/types';
import type { Champion } from '@/lib/db';
import { ChampionIcon } from '@/components/champions/ChampionIcon';
import { ProficiencyBadge } from '@/components/ui/Badge';

interface CompRecommendationProps {
  recommendations: RecommendedComp[];
  champions: Champion[];
  onSelect: (comp: RecommendedComp) => void;
}

export function CompRecommendationList({
  recommendations,
  champions,
  onSelect,
}: CompRecommendationProps) {
  const champMap = new Map(champions.map((c) => [c.id, c]));

  if (recommendations.length === 0) {
    return (
      <div className="text-center py-6 text-lol-gold-light/50">
        추천 가능한 조합이 없습니다. 선수들의 숙련도를 먼저 등록해주세요.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {recommendations.map((rec, idx) => (
        <div
          key={idx}
          onClick={() => onSelect(rec)}
          className="cursor-pointer p-4 bg-lol-blue rounded border border-lol-border hover:border-lol-gold transition-colors"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold bg-lol-gold/20 text-lol-gold px-2 py-0.5 rounded">
                #{idx + 1}
              </span>
              <span className="text-sm font-medium text-lol-gold">
                {rec.archetypeName}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-lol-gold-light/60">점수</span>
              <div className="w-20 h-2 bg-lol-dark rounded-full overflow-hidden">
                <div
                  className="h-full bg-lol-gold rounded-full"
                  style={{ width: `${Math.round(rec.score * 100)}%` }}
                />
              </div>
              <span className="text-sm font-mono text-lol-gold">
                {Math.round(rec.score * 100)}
              </span>
            </div>
          </div>

          {/* Assignments */}
          <div className="flex flex-wrap gap-3 mb-3">
            {rec.assignments.map((a) => {
              const champ = champMap.get(a.championId);
              return (
                <div key={a.playerId} className="flex items-center gap-2 bg-lol-dark/50 rounded px-2 py-1">
                  {champ && <ChampionIcon champion={champ} size="sm" />}
                  <div className="text-xs">
                    <div className="text-lol-gold-light">{a.playerName}</div>
                    <div className="text-lol-gold-light/60">{a.championName}</div>
                  </div>
                  <ProficiencyBadge level={a.proficiency} size="sm" />
                </div>
              );
            })}
          </div>

          {/* Damage Profile + Tags */}
          <div className="flex items-center gap-3 text-xs">
            <div className="flex gap-1">
              {rec.damageProfile.ap > 0 && (
                <span className="bg-blue-900/50 text-blue-300 px-1.5 py-0.5 rounded">
                  AP {rec.damageProfile.ap}
                </span>
              )}
              {rec.damageProfile.ad > 0 && (
                <span className="bg-red-900/50 text-red-300 px-1.5 py-0.5 rounded">
                  AD {rec.damageProfile.ad}
                </span>
              )}
              {rec.damageProfile.hybrid > 0 && (
                <span className="bg-purple-900/50 text-purple-300 px-1.5 py-0.5 rounded">
                  하이브리드 {rec.damageProfile.hybrid}
                </span>
              )}
            </div>
            <div className="text-lol-gold-light/40">|</div>
            <div className="flex gap-1 flex-wrap">
              {rec.strengths.map((s, i) => (
                <span key={i} className="text-prof-high/80">{s}</span>
              ))}
            </div>
          </div>

          {/* Score Breakdown (collapsible feel) */}
          <div className="mt-2 grid grid-cols-6 gap-1 text-[10px] text-lol-gold-light/50">
            {[
              { label: '숙련도', value: rec.scoreBreakdown.proficiency, weight: 30 },
              { label: '티어', value: rec.scoreBreakdown.aramTier, weight: 20 },
              { label: 'AD/AP', value: rec.scoreBreakdown.damageBalance, weight: 15 },
              { label: '역할', value: rec.scoreBreakdown.roleCoverage, weight: 15 },
              { label: '시너지', value: rec.scoreBreakdown.synergy, weight: 10 },
              { label: '카운터', value: rec.scoreBreakdown.counter, weight: 10 },
            ].map((item) => (
              <div key={item.label} className="text-center">
                <div>{item.label}</div>
                <div className="font-mono text-lol-gold-light/70">
                  {Math.round(item.value * 100)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
