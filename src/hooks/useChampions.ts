import { useState, useEffect, useCallback } from 'react';
import { db, type Champion, seedIfEmpty } from '@/lib/db';
import { syncChampions } from '@/lib/champions-sync';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]);
}

export function useChampions() {
  const [champions, setChampions] = useState<Champion[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const c = await db.champions.toArray();
      c.sort((a, b) => a.nameKo.localeCompare(b.nameKo, 'ko'));
      setChampions(c);
    } catch (error) {
      console.error('Failed to load champions:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await withTimeout(seedIfEmpty(), 5000);
        const count = await db.champions.count();
        if (count === 0) {
          setSyncing(true);
          try {
            await withTimeout(syncChampions(), 6000);
          } catch (e) {
            console.error('Failed to sync champions:', e);
          } finally {
            setSyncing(false);
          }
        }
      } catch (error) {
        console.error('Failed to initialize champions:', error);
        setSyncing(false);
      } finally {
        await refresh();
      }
    })();
  }, [refresh]);

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await withTimeout(syncChampions(), 10_000);
      await refresh();
      return result;
    } finally {
      setSyncing(false);
    }
  };

  return { champions, loading, syncing, refresh, sync };
}
