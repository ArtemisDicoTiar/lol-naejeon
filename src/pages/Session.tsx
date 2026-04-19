import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '@/hooks/useSession';
import { useChampions } from '@/hooks/useChampions';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ChampionIcon } from '@/components/champions/ChampionIcon';
import { db, type GamePick, type GameBan, type Player } from '@/lib/db';
import { useIdentityContext, useLcuContext } from '@/App';
import { computeWinrateStats, estimateCompWinrate, type WinrateStats } from '@/lib/recommendation/winrate';
import type { Champion } from '@/lib/db';
import { championTraits, type MechanicTag } from '@/data/champion-tags';
import { getTagLabel, getTagColor } from '@/data/tag-display';

export function Session() {
  const navigate = useNavigate();
  const { isMaster } = useIdentityContext();
  const lcu = useLcuContext();
  const { session, games, fierlessBans, lastGameTeams, loading, setGameResult, endSession, removeGame } = useSession();
  const { champions } = useChampions();
  const [gamePicks, setGamePicks] = useState<Record<number, GamePick[]>>({});
  const [gameBansMap, setGameBansMap] = useState<Record<number, GameBan[]>>({});
  const [players, setPlayers] = useState<Player[]>([]);
  const [wrStats, setWrStats] = useState<WinrateStats | null>(null);

  useEffect(() => { db.players.toArray().then(setPlayers); }, []);
  useEffect(() => { computeWinrateStats().then(setWrStats); }, [games]);

  // Auto-navigate to new game when LCU detects champion select
  useEffect(() => {
    if (lcu.connected && lcu.champSelectActive && session && isMaster) {
      navigate('/session/new-game?fromLcu=true');
    }
  }, [lcu.champSelectActive, lcu.connected, session, isMaster, navigate]);

  useEffect(() => {
    (async () => {
      const picks: Record<number, GamePick[]> = {};
      const bans: Record<number, GameBan[]> = {};
      for (const game of games) {
        picks[game.id!] = await db.gamePicks.where('gameId').equals(game.id!).toArray();
        bans[game.id!] = await db.gameBans.where('gameId').equals(game.id!).toArray();
      }
      setGamePicks(picks);
      setGameBansMap(bans);
    })();
  }, [games]);

  const getChampion = (id: string) => champions.find((c) => c.id === id);
  const getPlayer = (id: number) => players.find((p) => p.id === id);
  const bannedChampions = champions.filter((c) => fierlessBans.includes(c.id));
  const availableCount = champions.length - fierlessBans.length;

  const handleEndSession = async () => {
    if (!confirm('세션을 종료하시겠습니까? 종료 후에는 게임을 추가할 수 없습니다.')) return;
    const syncMsg = await endSession(isMaster);
    if (syncMsg) alert(syncMsg);
    navigate('/');
  };

  if (loading) return <div className="text-center py-8 text-lol-gold">로딩 중...</div>;

  if (!session) {
    return (
      <div className="text-center py-16 space-y-4">
        <p className="text-lol-gold-light/60">활성 세션이 없습니다.</p>
        <Link to="/"><Button>대시보드로 이동</Button></Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-lol-gold">{session.name}</h1>
          <span className="text-sm text-lol-gold-light/50">
            {new Date(session.createdAt).toLocaleString('ko-KR')} 시작
          </span>
        </div>
        <div className="flex gap-2">
          <Link to="/session/new-game">
            <Button>새 게임</Button>
          </Link>
          <Button variant="danger" onClick={handleEndSession}>세션 종료</Button>
        </div>
      </div>

      {/* Team carry-over */}
      {lastGameTeams && (
        <Card title="다음 게임">
          <div className="flex items-center gap-4 mb-3">
            <div className="flex-1 p-2 bg-blue-950/20 rounded border border-blue-900/30">
              <div className="text-xs text-blue-400 mb-1">Team 1</div>
              <div className="text-sm text-lol-gold-light">
                {lastGameTeams.team1.map((id) => getPlayer(id)?.name).join(', ')}
              </div>
            </div>
            <div className="flex-1 p-2 bg-red-950/20 rounded border border-red-900/30">
              <div className="text-xs text-red-400 mb-1">Team 2</div>
              <div className="text-sm text-lol-gold-light">
                {lastGameTeams.team2.map((id) => getPlayer(id)?.name).join(', ')}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Link to="/session/new-game?keepTeams=true">
              <Button size="sm">팀 유지하고 새 게임</Button>
            </Link>
            <Link to="/session/new-game">
              <Button variant="secondary" size="sm">팀 변경하고 새 게임</Button>
            </Link>
          </div>
        </Card>
      )}

      {/* Fierless */}
      <Card title={`피어리스 밴 (${fierlessBans.length}개 사용 / ${availableCount}개 남음)`}>
        {bannedChampions.length === 0 ? (
          <p className="text-lol-gold-light/50 text-center py-4">첫 게임을 시작하세요!</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {bannedChampions.map((c) => <ChampionIcon key={c.id} champion={c} size="sm" disabled showName />)}
          </div>
        )}
      </Card>

      {/* Games */}
      <Card title={`게임 기록 (${games.length}개)`}>
        {games.length === 0 ? (
          <p className="text-lol-gold-light/50 text-center py-4">진행된 게임이 없습니다.</p>
        ) : (
          <div className="space-y-4">
            {games.map((game, idx) => {
              const picks = gamePicks[game.id!] ?? [];
              const bans = gameBansMap[game.id!] ?? [];
              const team1 = picks.filter((p) => p.team === 1);
              const team2 = picks.filter((p) => p.team === 2);
              const isLatest = idx === games.length - 1;
              return (
                <div key={game.id} className="p-4 bg-lol-blue rounded border border-lol-border">
                  {bans.length > 0 && (
                    <div className="flex gap-4 mb-3 pb-2 border-b border-lol-border/50">
                      {([1, 2] as const).map((t) => {
                        const teamBanList = bans.filter((b) => b.team === t);
                        if (teamBanList.length === 0) return null;
                        return (
                          <div key={t} className="flex items-center gap-1.5">
                            <span className="text-[10px] text-red-400/70">T{t} 밴</span>
                            {teamBanList.map((b) => {
                              const champ = getChampion(b.championId);
                              return champ ? <ChampionIcon key={b.id} champion={champ} size="sm" disabled /> : null;
                            })}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lol-gold font-bold">Game #{game.gameNumber}</span>
                      <span className="text-xs bg-lol-gold/20 text-lol-gold px-2 py-0.5 rounded">{game.format}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {game.winningTeam ? (
                        <span className="text-prof-high text-sm font-medium">Team {game.winningTeam} 승리</span>
                      ) : (
                        <div className="flex gap-2">
                          <Button size="sm" variant="secondary" onClick={() => setGameResult(game.id!, 1)}>T1 승</Button>
                          <Button size="sm" variant="secondary" onClick={() => setGameResult(game.id!, 2)}>T2 승</Button>
                        </div>
                      )}
                      <Button size="sm" variant="danger" onClick={() => {
                        if (confirm(`Game #${game.gameNumber}을 삭제하시겠습니까?`)) removeGame(game.id!);
                      }}>삭제</Button>
                    </div>
                  </div>
                  {isLatest && wrStats && picks.length > 0 && (
                    <ActiveGameStats
                      team1={team1}
                      team2={team2}
                      wrStats={wrStats}
                      getChampion={getChampion}
                      getPlayer={getPlayer}
                    />
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    {[{ team: team1, num: 1 }, { team: team2, num: 2 }].map(({ team, num }) => (
                      <div key={num} className={`p-2 rounded ${game.winningTeam === num ? 'bg-prof-high/10 border border-prof-high/30' : 'bg-lol-dark/50'}`}>
                        <div className="text-xs text-lol-gold mb-2 font-medium">Team {num}</div>
                        <div className="space-y-1">
                          {team.map((pick) => {
                            const champ = getChampion(pick.championId);
                            const player = getPlayer(pick.playerId);
                            return (
                              <div key={pick.id} className="flex items-center gap-2">
                                {champ && <ChampionIcon champion={champ} size="sm" />}
                                <div>
                                  <span className="text-sm text-lol-gold-light">{player?.name}</span>
                                  <span className="text-xs text-lol-gold-light/50 ml-1">{champ?.nameKo}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

interface ActiveGameStatsProps {
  team1: GamePick[];
  team2: GamePick[];
  wrStats: WinrateStats;
  getChampion: (id: string) => Champion | undefined;
  getPlayer: (id: number) => Player | undefined;
}

function ActiveGameStats({ team1, team2, wrStats, getChampion, getPlayer }: ActiveGameStatsProps) {
  const stats = useMemo(() => {
    const buildTeamData = (team: GamePick[]) => {
      const assignments = team.map((p) => {
        const champ = getChampion(p.championId);
        const player = getPlayer(p.playerId);
        return {
          playerId: p.playerId,
          playerName: player?.name ?? '?',
          championId: p.championId,
          championName: champ?.nameKo ?? p.championId,
          proficiency: '중' as const,
        };
      });
      const tagCounts: Record<string, number> = {};
      for (const a of assignments) {
        const t = championTraits[a.championId];
        if (!t) continue;
        for (const m of t.mechanics) tagCounts[m] = (tagCounts[m] ?? 0) + 1;
      }
      const champStats = assignments.map((a) => {
        const cs = wrStats.champOverallStats[a.championId];
        const pcs = wrStats.playerChampStats.find(
          (s) => s.playerId === a.playerId && s.championId === a.championId,
        );
        return { ...a, champOverall: cs, playerChamp: pcs };
      });
      return { assignments, tagCounts, champStats };
    };

    const t1 = buildTeamData(team1);
    const t2 = buildTeamData(team2);
    const t1WR = estimateCompWinrate(t1.assignments, wrStats, 0.5);
    const t2WR = estimateCompWinrate(t2.assignments, wrStats, 0.5);
    return { t1, t2, t1WR, t2WR };
  }, [team1, team2, wrStats, getChampion, getPlayer]);

  const renderTeam = (label: string, color: string, data: typeof stats.t1, wr: number) => {
    const tags = Object.entries(data.tagCounts).sort((a, b) => b[1] - a[1]);
    return (
      <div className={`p-3 rounded border ${color}`}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-lol-gold-light">{label}</span>
          <span className="text-sm font-bold text-lol-gold">예상 승률 {wr.toFixed(1)}%</span>
        </div>
        {data.champStats.length > 0 && (
          <div className="space-y-0.5 mb-2">
            {data.champStats.map((c) => (
              <div key={c.playerId} className="flex items-center justify-between text-xs">
                <span className="text-lol-gold-light/80 truncate">{c.playerName} · {c.championName}</span>
                <span className="text-lol-gold-light/60 ml-2 whitespace-nowrap">
                  {c.playerChamp && c.playerChamp.wins + c.playerChamp.losses > 0
                    ? `본인 ${c.playerChamp.winrate.toFixed(0)}% (${c.playerChamp.wins}/${c.playerChamp.losses})`
                    : '본인 -'}
                  {' / '}
                  {c.champOverall && c.champOverall.wins + c.champOverall.losses > 0
                    ? `전체 ${c.champOverall.winrate.toFixed(0)}%`
                    : '전체 -'}
                </span>
              </div>
            ))}
          </div>
        )}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map(([tag, n]) => (
              <span key={tag} className={`text-[10px] px-1.5 py-0.5 rounded ${getTagColor(tag as MechanicTag)}`}>
                {getTagLabel(tag as MechanicTag)}{n > 1 ? `×${n}` : ''}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-2 gap-3 mb-3 pb-3 border-b border-lol-border/50">
      {renderTeam('Team 1', 'bg-blue-950/20 border-blue-900/30', stats.t1, stats.t1WR)}
      {renderTeam('Team 2', 'bg-red-950/20 border-red-900/30', stats.t2, stats.t2WR)}
    </div>
  );
}
