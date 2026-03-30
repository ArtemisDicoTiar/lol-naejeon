import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePlayers } from '@/hooks/usePlayers';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { db } from '@/lib/db';
import { useEffect } from 'react';

export function Players() {
  const { players, addPlayer, removePlayer } = usePlayers();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [profCounts, setProfCounts] = useState<Record<number, number>>({});

  useEffect(() => {
    (async () => {
      const counts: Record<number, number> = {};
      for (const p of players) {
        if (p.id) {
          const count = await db.proficiencies
            .where('playerId')
            .equals(p.id)
            .and((prof) => prof.level !== '없음')
            .count();
          counts[p.id] = count;
        }
      }
      setProfCounts(counts);
    })();
  }, [players]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await addPlayer(name);
      setName('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleRemove = async (id: number, playerName: string) => {
    if (confirm(`${playerName} 선수를 삭제하시겠습니까? 숙련도 데이터도 함께 삭제됩니다.`)) {
      await removePlayer(id);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-lol-gold">선수 관리</h1>

      <Card title="선수 등록">
        <form onSubmit={handleAdd} className="flex gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="닉네임 입력"
            className="flex-1 bg-lol-blue border border-lol-border rounded px-3 py-2 text-lol-gold-light placeholder:text-lol-gold-light/30 focus:outline-none focus:border-lol-gold"
          />
          <Button type="submit" disabled={!name.trim()}>
            등록
          </Button>
        </form>
        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
      </Card>

      <Card title={`등록된 선수 (${players.length}명)`}>
        {players.length === 0 ? (
          <p className="text-lol-gold-light/50 text-center py-4">
            등록된 선수가 없습니다.
          </p>
        ) : (
          <div className="space-y-2">
            {players.map((player) => (
              <div
                key={player.id}
                className="flex items-center justify-between p-3 bg-lol-blue rounded border border-lol-border"
              >
                <div className="flex items-center gap-3">
                  <span className="text-lol-gold font-medium">{player.name}</span>
                  <span className="text-xs text-lol-gold-light/50">
                    {profCounts[player.id!] ?? 0}개 챔피언 등록
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Link to={`/players/${player.id}`}>
                    <Button variant="secondary" size="sm">
                      숙련도 편집
                    </Button>
                  </Link>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleRemove(player.id!, player.name)}
                  >
                    삭제
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
