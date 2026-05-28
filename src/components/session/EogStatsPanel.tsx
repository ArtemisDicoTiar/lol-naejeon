import { ChampionIcon } from '@/components/champions/ChampionIcon';
import type { Champion, GameParticipantStat, Player } from '@/lib/db';

interface EogStatsPanelProps {
  participantStats: GameParticipantStat[];
  players: Player[];
  champions: Champion[];
  winnerTeam?: number | null;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(value));
}

export function EogStatsPanel({ participantStats, players, champions, winnerTeam = null }: EogStatsPanelProps) {
  const getPlayer = (playerId?: number | null, alias?: string | null, summonerName?: string) => {
    if (playerId) {
      const player = players.find((entry) => entry.id === playerId);
      if (player) return player.name;
    }
    return alias || summonerName || '미매핑';
  };

  const getChampion = (championId?: string | null) => {
    if (!championId) return undefined;
    return champions.find((champion) => champion.id === championId);
  };

  const teams = [
    { team: 1 as const, label: 'Team 1' },
    { team: 2 as const, label: 'Team 2' },
  ].map(({ team, label }) => ({
    team,
    label,
    rows: participantStats.filter((row) => row.team === team),
  })).filter((entry) => entry.rows.length > 0);

  const unassigned = participantStats.filter((row) => row.team === 0);

  return (
    <div className="space-y-3">
      {teams.map(({ team, label, rows }) => (
        <div key={team} className={`rounded border ${winnerTeam === team ? 'border-prof-high/40 bg-prof-high/8' : 'border-lol-border/60 bg-lol-dark/40'}`}>
          <div className="flex items-center justify-between px-3 py-2 border-b border-lol-border/40">
            <div className="text-xs font-medium text-lol-gold-light/80">{label}</div>
            {winnerTeam === team && <div className="text-[10px] text-prof-high">승리</div>}
          </div>
          <div className="divide-y divide-lol-border/20">
            {rows.map((row) => {
              const champion = getChampion(row.championId);
              return (
                <div key={row.id ?? `${team}-${row.playerId}-${row.summonerName}`} className="px-3 py-2">
                  <div className="flex items-center gap-2 mb-1.5">
                    {champion && <ChampionIcon champion={champion} size="sm" />}
                    <div className="min-w-0">
                      <div className="text-sm text-lol-gold-light truncate">
                        {getPlayer(row.playerId, row.alias, row.summonerName)}
                      </div>
                      <div className="text-[11px] text-lol-gold-light/45 truncate">
                        {champion?.nameKo ?? row.championId ?? '챔피언 미상'}
                      </div>
                    </div>
                    <div className="ml-auto text-xs text-lol-gold-light/60">
                      {row.kills}/{row.deaths}/{row.assists}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] text-lol-gold-light/65">
                    <div>딜량 {formatNumber(row.totalDamageDealtToChampions)}</div>
                    <div>받은 피해 {formatNumber(row.totalDamageTaken)}</div>
                    <div>힐 {formatNumber(row.totalHeal)}</div>
                    <div>실드 {formatNumber(row.totalDamageShieldedOnTeammates)}</div>
                    <div>골드 {formatNumber(row.goldEarned)}</div>
                    <div>CC {formatNumber(row.timeCCingOthers)}</div>
                    <div>죽은 시간 {formatNumber(row.totalTimeSpentDead)}</div>
                    <div>경감 {formatNumber(row.damageSelfMitigated)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {unassigned.length > 0 && (
        <div className="rounded border border-yellow-700/30 bg-yellow-950/10 px-3 py-2">
          <div className="text-xs text-yellow-300/80 mb-1">팀 미확정 데이터</div>
          <div className="space-y-1">
            {unassigned.map((row) => (
              <div key={row.id ?? row.summonerName} className="text-xs text-yellow-100/80">
                {getPlayer(row.playerId, row.alias, row.summonerName)} · 딜량 {formatNumber(row.totalDamageDealtToChampions)} · 받은 피해 {formatNumber(row.totalDamageTaken)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
