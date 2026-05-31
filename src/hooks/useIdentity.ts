import { useState, useEffect } from 'react';
import { db, type Player } from '@/lib/db';

const STORAGE_KEY = 'lol-naejeon-userId';
const MASTER_PLAYER_NAME = '12시';

export function useIdentity() {
  const [userId, setUserIdState] = useState<number | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? parseInt(stored) : null;
  });
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [masterPlayerId, setMasterPlayerId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadPlayers = async () => {
      const p = await db.players.toArray();
      if (cancelled) return;
      setPlayers(p);
      const master = p.find((pl) => pl.name === MASTER_PLAYER_NAME);
      setMasterPlayerId(master?.id ?? null);
      setLoading(false);
    };
    const handleDataChanged = () => { void loadPlayers(); };
    void loadPlayers();
    window.addEventListener('lol-data-changed', handleDataChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('lol-data-changed', handleDataChanged);
    };
  }, []);

  const setUserId = (id: number | null) => {
    setUserIdState(id);
    if (id !== null) {
      localStorage.setItem(STORAGE_KEY, String(id));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const isMaster = userId !== null && userId === masterPlayerId;
  const playerName = players.find((p) => p.id === userId)?.name ?? '관전자';
  const hasValidUser = userId !== null && players.some((player) => player.id === userId);
  const needsSelection = !loading && players.length > 0 && !hasValidUser;

  return { userId: hasValidUser ? userId : null, setUserId, isMaster, playerName, needsSelection, players, loading };
}
