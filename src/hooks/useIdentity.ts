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
  const [masterPlayerId, setMasterPlayerId] = useState<number | null>(null);

  useEffect(() => {
    db.players.toArray().then((p) => {
      setPlayers(p);
      const master = p.find((pl) => pl.name === MASTER_PLAYER_NAME);
      if (master) setMasterPlayerId(master.id!);
    });
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
  const needsSelection = userId === null;

  return { userId, setUserId, isMaster, playerName, needsSelection, players };
}
