import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/hooks/useSession';
import { usePlayers } from '@/hooks/usePlayers';
import { useChampions } from '@/hooks/useChampions';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export function Dashboard() {
  const { session, games, fierlessBans, loading: sessionLoading, createSession } = useSession();
  const { players } = usePlayers();
  const { champions, syncing } = useChampions();
  const [sessionName, setSessionName] = useState('');
  const [creating, setCreating] = useState(false);

  if (sessionLoading || syncing) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lol-gold">
          {syncing ? '챔피언 데이터 동기화 중...' : '로딩 중...'}
        </div>
      </div>
    );
  }

  const handleCreateSession = async () => {
    setCreating(true);
    try {
      await createSession(sessionName.trim() || undefined);
      setSessionName('');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-lol-gold">눈오는 헤네시스</h1>
        <span className="text-sm text-lol-gold-light/60">
          {new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
        </span>
      </div>

      {/* No active session */}
      {!session && (
        <Card title="새 세션 시작">
          <p className="text-sm text-lol-gold-light/60 mb-4">
            내전을 시작하려면 새 세션을 만드세요. 세션 안에서 여러 게임을 진행하고, 피어리스 밴이 누적됩니다.
          </p>
          <div className="flex gap-3">
            <input
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder={new Date().toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) + ' 내전'}
              className="flex-1 bg-lol-blue border border-lol-border rounded px-3 py-2 text-lol-gold-light placeholder:text-lol-gold-light/30 focus:outline-none focus:border-lol-gold"
            />
            <Button onClick={handleCreateSession} disabled={creating} size="lg">
              {creating ? '생성 중...' : '세션 시작'}
            </Button>
          </div>
        </Card>
      )}

      {/* Active session */}
      {session && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <div className="text-center">
                <div className="text-3xl font-bold text-lol-gold">{players.length}</div>
                <div className="text-sm text-lol-gold-light/60 mt-1">등록 선수</div>
              </div>
            </Card>
            <Card>
              <div className="text-center">
                <div className="text-3xl font-bold text-lol-gold">{games.length}</div>
                <div className="text-sm text-lol-gold-light/60 mt-1">세션 게임</div>
              </div>
            </Card>
            <Card>
              <div className="text-center">
                <div className="text-3xl font-bold text-tier-s">{fierlessBans.length}</div>
                <div className="text-sm text-lol-gold-light/60 mt-1">피어리스 밴</div>
              </div>
            </Card>
            <Card>
              <div className="text-center">
                <div className="text-3xl font-bold text-prof-high">
                  {Math.max(0, champions.length - fierlessBans.length)}
                </div>
                <div className="text-sm text-lol-gold-light/60 mt-1">남은 챔피언</div>
              </div>
            </Card>
          </div>

          <Card title={`세션: ${session.name}`}>
            <div className="flex flex-wrap gap-3">
              <Link to="/session/new-game">
                <Button size="lg">새 게임 시작</Button>
              </Link>
              <Link to="/session">
                <Button variant="secondary" size="lg">세션 현황</Button>
              </Link>
              <Link to="/players">
                <Button variant="secondary" size="lg">선수 관리</Button>
              </Link>
            </div>
          </Card>

          {games.length > 0 && (
            <Card title="최근 게임">
              <div className="space-y-2">
                {games.slice(-5).reverse().map((game) => (
                  <div key={game.id} className="flex items-center justify-between p-3 bg-lol-blue rounded border border-lol-border">
                    <div className="flex items-center gap-3">
                      <span className="text-lol-gold font-mono text-sm">#{game.gameNumber}</span>
                      <span className="text-xs bg-lol-gold/20 text-lol-gold px-2 py-0.5 rounded">{game.format}</span>
                    </div>
                    <div className="text-sm">
                      {game.winningTeam ? (
                        <span className="text-prof-high">Team {game.winningTeam} 승리</span>
                      ) : (
                        <span className="text-lol-gold-light/50">결과 미입력</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {players.length === 0 && (
        <Card>
          <div className="text-center py-8">
            <p className="text-lol-gold-light/60 mb-4">아직 등록된 선수가 없습니다.</p>
            <Link to="/players"><Button>선수 등록하기</Button></Link>
          </div>
        </Card>
      )}
    </div>
  );
}
