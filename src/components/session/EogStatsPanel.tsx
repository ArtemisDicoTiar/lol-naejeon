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

function formatCompact(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}만`;
  return formatNumber(value);
}

function BarMetric({
  icon,
  value,
  max,
  tone,
  title,
}: {
  icon: string;
  value: number;
  max: number;
  tone: string;
  title: string;
}) {
  const width = max > 0 ? Math.max(8, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div title={`${title} ${formatNumber(value)}`} className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-lol-gold-light/60">
        <span className="text-lol-gold-light/45">{icon}</span>
        <span className="font-mono">{formatCompact(value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-lol-blue">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
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
  const maxDamage = Math.max(...participantStats.map((row) => row.totalDamageDealtToChampions), 1);
  const maxTaken = Math.max(...participantStats.map((row) => row.totalDamageTaken), 1);
  const maxGold = Math.max(...participantStats.map((row) => row.goldEarned), 1);

  return (
    <div className="space-y-3">
      {teams.map(({ team, label, rows }) => (
        <div key={team} className={`rounded-xl border ${winnerTeam === team ? 'border-prof-high/40 bg-prof-high/8' : 'border-lol-border/60 bg-lol-dark/40'}`}>
          <div className="flex items-center justify-between px-3 py-2 border-b border-lol-border/40">
            <div className="text-xs font-medium text-lol-gold-light/80">{label}</div>
            <div className="flex items-center gap-2 text-[10px] text-lol-gold-light/45">
              <span>{formatCompact(rows.reduce((sum, row) => sum + row.totalDamageDealtToChampions, 0))} 딜</span>
              {winnerTeam === team && <span className="text-prof-high">승리</span>}
            </div>
          </div>
          <div className="divide-y divide-lol-border/20">
            {rows.map((row) => {
              const champion = getChampion(row.championId);
              return (
                <div key={row.id ?? `${team}-${row.playerId}-${row.summonerName}`} className="grid gap-3 px-3 py-2.5 lg:grid-cols-[1.15fr_0.5fr_1.6fr] lg:items-center">
                  <div className="flex min-w-0 items-center gap-2">
                    {champion && <ChampionIcon champion={champion} size="sm" />}
                    <div className="min-w-0">
                      <div className="text-sm text-lol-gold-light truncate">
                        {getPlayer(row.playerId, row.alias, row.summonerName)}
                      </div>
                      <div className="text-[11px] text-lol-gold-light/45 truncate">
                        {champion?.nameKo ?? row.championId ?? '챔피언 미상'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span title="KDA" className="rounded border border-lol-border/50 bg-lol-dark/45 px-2 py-1 font-mono text-lol-gold-light/75">
                      {row.kills}/{row.deaths}/{row.assists}
                    </span>
                    <span title={`CC ${formatNumber(row.timeCCingOthers)}`} className="rounded border border-yellow-700/25 bg-yellow-950/15 px-2 py-1 font-mono text-yellow-200/80">
                      ⏱ {formatCompact(row.timeCCingOthers)}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <BarMetric icon="⚔" title="챔피언 피해" value={row.totalDamageDealtToChampions} max={maxDamage} tone="bg-lol-gold/85" />
                    <BarMetric icon="◆" title="받은 피해" value={row.totalDamageTaken} max={maxTaken} tone="bg-red-500/75" />
                    <BarMetric icon="◈" title="골드" value={row.goldEarned} max={maxGold} tone="bg-blue-400/75" />
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
                {getPlayer(row.playerId, row.alias, row.summonerName)} · ⚔ {formatCompact(row.totalDamageDealtToChampions)} · ◆ {formatCompact(row.totalDamageTaken)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
