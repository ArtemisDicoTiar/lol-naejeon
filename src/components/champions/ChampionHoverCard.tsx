import type { Champion, Player, ProficiencyLevel } from '@/lib/db';
import type { WinrateStats } from '@/lib/recommendation/winrate';
import { ProficiencyBadge, TierBadge, RoleBadge } from '@/components/ui/Badge';
import { championTraits, type MechanicTag } from '@/data/champion-tags';

const TAG_LABELS: Partial<Record<MechanicTag, string>> = {
  knockup: '넉업',
  pull: '끌어오기',
  aoe_cc: 'AoE CC',
  single_target_cc: '단일 CC',
  shield: '쉴드',
  heal: '힐',
  speed_buff: '이속 버프',
  attack_steroid: '공격 버프',
  zone_control: '구역 장악',
  poke_long: '롱 포크',
  poke_mid: '미드 포크',
  burst: '버스트',
  dps_sustained: '지속 딜',
  execute: '처형',
  revive: '부활',
  invulnerable: '무적',
  terrain_create: '지형 생성',
  anti_heal: '치유 감소',
  tank_shred: '탱커 파쇄',
  diving: '다이브',
  dash_reset: '리셋 대쉬',
  stealth: '은신',
};

const TAG_COLORS: Partial<Record<MechanicTag, string>> = {
  heal: 'bg-green-800/60 text-green-300',
  shield: 'bg-cyan-800/60 text-cyan-300',
  anti_heal: 'bg-red-800/60 text-red-300',
  knockup: 'bg-yellow-800/60 text-yellow-300',
  aoe_cc: 'bg-yellow-800/60 text-yellow-300',
  pull: 'bg-yellow-800/60 text-yellow-300',
  single_target_cc: 'bg-yellow-800/60 text-yellow-300',
  burst: 'bg-orange-800/60 text-orange-300',
  dps_sustained: 'bg-orange-800/60 text-orange-300',
  tank_shred: 'bg-red-800/60 text-red-300',
  revive: 'bg-emerald-800/60 text-emerald-300',
  invulnerable: 'bg-emerald-800/60 text-emerald-300',
};

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

      {/* Mechanic Tags */}
      {(() => {
        const traits = championTraits[champion.id];
        if (!traits) return null;
        return (
          <div className="flex flex-wrap gap-1">
            {traits.mechanics.map((tag) => (
              <span key={tag} className={`text-[9px] px-1.5 py-0.5 rounded ${TAG_COLORS[tag] ?? 'bg-lol-blue text-lol-gold-light/60'}`}>
                {TAG_LABELS[tag] ?? tag}
              </span>
            ))}
          </div>
        );
      })()}

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
