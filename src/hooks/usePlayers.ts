import { useState, useEffect, useCallback } from 'react';
import { db, type Player } from '@/lib/db';

export function usePlayers() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const p = await db.players.toArray();
    setPlayers(p);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const addPlayer = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const exists = await db.players.where('name').equals(trimmed).first();
    if (exists) throw new Error('이미 존재하는 이름입니다.');
    await db.players.add({ name: trimmed, createdAt: new Date() });
    await refresh();
  };

  const removePlayer = async (id: number) => {
    await db.proficiencies.where('playerId').equals(id).delete();
    await db.players.delete(id);
    await refresh();
  };

  return { players, loading, refresh, addPlayer, removePlayer };
}
