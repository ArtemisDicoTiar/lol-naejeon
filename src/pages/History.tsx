import { useEffect, useState } from 'react';
import { db, deleteSession, updateSessionName, type Session, type Game, type GamePick, type Player, type Champion } from '@/lib/db';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ChampionIcon } from '@/components/champions/ChampionIcon';

interface SessionWithGames extends Session {
  games: (Game & { picks: GamePick[] })[];
}

export function History() {
  const [sessions, setSessions] = useState<SessionWithGames[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [champions, setChampions] = useState<Champion[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSessions = async () => {
      const [allSessions, allPlayers, allChampions] = await Promise.all([
        db.sessions.toArray(),
        db.players.toArray(),
        db.champions.toArray(),
      ]);
      setPlayers(allPlayers);
      setChampions(allChampions);

      const sessionsWithGames: SessionWithGames[] = [];
      for (const session of allSessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())) {
        const games = await db.games.where('sessionId').equals(session.id!).toArray();
        games.sort((a, b) => a.gameNumber - b.gameNumber);
        const gamesWithPicks = await Promise.all(
          games.map(async (game) => ({
            ...game,
            picks: await db.gamePicks.where('gameId').equals(game.id!).toArray(),
          }))
        );
        if (gamesWithPicks.length > 0) {
          sessionsWithGames.push({ ...session, games: gamesWithPicks });
        }
      }
    setSessions(sessionsWithGames);
    setLoading(false);
  };

  useEffect(() => { loadSessions(); }, []);

  const handleDeleteSession = async (sid: number, name: string) => {
    if (!confirm(`"${name}" 세션을 삭제하시겠습니까? 모든 게임 기록도 함께 삭제됩니다.`)) return;
    await deleteSession(sid);
    await loadSessions();
  };

  const handleRenameSession = async (sid: number, currentName: string) => {
    const newName = prompt('새 세션 이름:', currentName);
    if (!newName || newName === currentName) return;
    await updateSessionName(sid, newName);
    await loadSessions();
  };

  const getPlayer = (id: number) => players.find((p) => p.id === id);
  const getChampion = (id: string) => champions.find((c) => c.id === id);

  if (loading) return <div className="text-center py-8 text-lol-gold">로딩 중...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-lol-gold">게임 기록</h1>

      {sessions.length === 0 ? (
        <Card>
          <p className="text-center py-8 text-lol-gold-light/50">
            아직 기록된 게임이 없습니다.
          </p>
        </Card>
      ) : (
        sessions.map((session) => (
          <Card key={session.id} title={`${session.name} (${session.games.length}게임)`}>
            <div className="flex gap-2 mb-3">
              <Button size="sm" variant="ghost" onClick={() => handleRenameSession(session.id!, session.name)}>이름 수정</Button>
              <Button size="sm" variant="danger" onClick={() => handleDeleteSession(session.id!, session.name)}>세션 삭제</Button>
            </div>
            <div className="space-y-4">
              {session.games.map((game) => {
                const team1 = game.picks.filter((p) => p.team === 1);
                const team2 = game.picks.filter((p) => p.team === 2);
                return (
                  <div key={game.id} className="p-3 bg-lol-blue rounded border border-lol-border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-lol-gold font-medium text-sm">
                        #{game.gameNumber} {game.format}
                      </span>
                      {game.winningTeam && (
                        <span className="text-prof-high text-xs">Team {game.winningTeam} 승</span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {[team1, team2].map((team, idx) => (
                        <div key={idx} className="space-y-1">
                          <div className="text-xs text-lol-gold/70">Team {idx + 1}</div>
                          {team.map((pick) => {
                            const champ = getChampion(pick.championId);
                            return (
                              <div key={pick.id} className="flex items-center gap-1.5">
                                {champ && <ChampionIcon champion={champ} size="sm" />}
                                <span className="text-xs text-lol-gold-light/80">
                                  {getPlayer(pick.playerId)?.name} - {champ?.nameKo}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
