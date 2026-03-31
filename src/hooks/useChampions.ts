import { useState, useEffect, useCallback } from 'react';
import { db, type Champion, seedIfEmpty } from '@/lib/db';
import { syncChampions } from '@/lib/champions-sync';

export function useChampions() {
  const [champions, setChampions] = useState<Champion[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const c = await db.champions.toArray();
    c.sort((a, b) => a.nameKo.localeCompare(b.nameKo, 'ko'));
    setChampions(c);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      await seedIfEmpty();
      const count = await db.champions.count();
      if (count === 0) {
        setSyncing(true);
        try {
          await syncChampions();
        } catch (e) {
          console.error('Failed to sync champions:', e);
        }
        setSyncing(false);
      }
      await refresh();
    })();
  }, [refresh]);

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await syncChampions();
      await refresh();
      return result;
    } finally {
      setSyncing(false);
    }
  };

  return { champions, loading, syncing, refresh, sync };
}
