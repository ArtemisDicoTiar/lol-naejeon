import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '@/hooks/useSession';
import { useChampions } from '@/hooks/useChampions';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ChampionIcon } from '@/components/champions/ChampionIcon';
import { db, type GamePick, type GameBan, type Player } from '@/lib/db';

export function Session() {
  const navigate = useNavigate();
  const { session, games, fierlessBans, lastGameTeams, loading, setGameResult, endSession, removeGame } = useSession();
  const { champions } = useChampions();
  const [gamePicks, setGamePicks] = useState<Record<number, GamePick[]>>({});
  const [gameBansMap, setGameBansMap] = useState<Record<number, GameBan[]>>({});
  const [players, setPlayers] = useState<Player[]>([]);

  useEffect(() => { db.players.toArray().then(setPlayers); }, []);

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
    await endSession();
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
            {games.map((game) => {
              const picks = gamePicks[game.id!] ?? [];
              const bans = gameBansMap[game.id!] ?? [];
              const team1 = picks.filter((p) => p.team === 1);
              const team2 = picks.filter((p) => p.team === 2);
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
