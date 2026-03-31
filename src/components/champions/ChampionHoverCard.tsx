import type { Champion, Player, ProficiencyLevel } from '@/lib/db';
import type { WinrateStats } from '@/lib/recommendation/winrate';
import { ProficiencyBadge, TierBadge, RoleBadge } from '@/components/ui/Badge';

interface ChampionHoverCardProps {
  champion: Champion;
  wrStats: WinrateStats | null;
  allPlayers: Player[];
  proficiencies: Record<number, Map<string, ProficiencyLevel>>;
  highlightPlayerIds?: number[]; // players to highlight (e.g. opponent team)
}

export function ChampionHoverCard({
  champion,
  wrStats,
  allPlayers,
  proficiencies,
  highlightPlayerIds,
}: ChampionHoverCardProps) {
  const cs = wrStats?.champOverallStats[champion.id];
  const playerStats = wrStats?.playerChampStats.filter((s) => s.championId === champion.id) ?? [];

  return (
    <div className="w-[260px] p-3 bg-lol-gray border border-lol-border rounded-lg shadow-xl space-y-2.5">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div className="w-12 h-12 rounded overflow-hidden border border-lol-border shrink-0">
          <img src={champion.imageUrl} className="w-full h-full" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-lol-gold-light">{champion.nameKo}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <TierBadge tier={champion.aramTier} />
            <RoleBadge role={champion.aramRole} />
            <span className="text-[10px] text-lol-gold-light/40">{champion.damageType}</span>
          </div>
        </div>
      </div>

      {/* Champion overall stats */}
      {cs && cs.picks > 0 ? (
        <div className="grid grid-cols-3 gap-1.5 text-center">
          <div className="bg-lol-blue rounded p-1.5">
            <div className={`text-sm font-bold font-mono ${cs.winrate >= 55 ? 'text-prof-high' : cs.winrate >= 45 ? 'text-lol-gold' : 'text-prof-low'}`}>
              {Math.round(cs.winrate)}%
            </div>
            <div className="text-[9px] text-lol-gold-light/40">승률</div>
          </div>
          <div className="bg-lol-blue rounded p-1.5">
            <div className="text-sm font-bold font-mono text-lol-gold-light/80">
              {Math.round(cs.pickRate)}%
            </div>
            <div className="text-[9px] text-lol-gold-light/40">픽률</div>
          </div>
          <div className="bg-lol-blue rounded p-1.5">
            <div className="text-sm font-bold font-mono text-red-400/80">
              {Math.round(cs.banRate)}%
            </div>
            <div className="text-[9px] text-lol-gold-light/40">밴률</div>
          </div>
        </div>
      ) : (
        <div className="text-[10px] text-lol-gold-light/30 text-center py-1">
          내전 기록 없음 | ARAM 승률 {champion.aramWinrate}%
        </div>
      )}

      {cs && cs.picks > 0 && (
        <div className="text-[10px] text-lol-gold-light/40 text-center">
          {cs.wins}승 {cs.losses}패 / {cs.picks}픽 / {cs.bans}밴
        </div>
      )}

      {/* Per-player stats */}
      {allPlayers.length > 0 && (
        <div>
          <div className="text-[10px] text-lol-gold-light/40 mb-1">플레이어별 전적</div>
          <div className="space-y-0.5 max-h-[140px] overflow-y-auto">
            {allPlayers.map((p) => {
              const ps = playerStats.find((s) => s.playerId === p.id!);
              const prof = proficiencies[p.id!]?.get(champion.id);
              const isHighlight = highlightPlayerIds?.includes(p.id!);
              if (!ps && (!prof || prof === '없음')) return null;
              const total = ps ? ps.wins + ps.losses : 0;
              return (
                <div key={p.id} className={`flex items-center justify-between px-1.5 py-1 rounded text-[11px] ${
                  isHighlight ? 'bg-red-950/30 border border-red-900/30' : 'bg-lol-blue/50'
                }`}>
                  <div className="flex items-center gap-1.5">
                    <span className={`font-medium ${isHighlight ? 'text-red-300' : 'text-lol-gold-light/80'}`}>
                      {p.name}
                    </span>
                    {prof && prof !== '없음' && <ProficiencyBadge level={prof} size="sm" />}
                  </div>
                  {ps && total > 0 ? (
                    <div className="flex items-center gap-1.5">
                      <span className={`font-mono ${ps.winrate >= 60 ? 'text-prof-high' : ps.winrate >= 40 ? 'text-lol-gold-light/60' : 'text-prof-low'}`}>
                        {Math.round(ps.winrate)}%
                      </span>
                      <span className="text-lol-gold-light/40">{ps.wins}W {ps.losses}L</span>
                    </div>
                  ) : (
                    <span className="text-lol-gold-light/30">기록 없음</span>
                  )}
                </div>
              );
            }).filter(Boolean)}
          </div>
        </div>
      )}
    </div>
  );
}
