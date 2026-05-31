import { useEffect, useMemo, useState } from 'react';

interface DDragonChampion {
  key: string;
}

interface DDragonChampionResponse {
  data: Record<string, DDragonChampion>;
}

export function useChampionKeyMap() {
  const [champKeyMap, setChampKeyMap] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const versionsResponse = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
        const versions = (await versionsResponse.json()) as string[];
        const latest = versions[0];
        if (!latest) return;

        const championResponse = await fetch(`https://ddragon.leagueoflegends.com/cdn/${latest}/data/ko_KR/champion.json`);
        const championData = (await championResponse.json()) as DDragonChampionResponse;
        const next = new Map<number, string>();
        for (const [championId, champion] of Object.entries(championData.data)) {
          next.set(Number.parseInt(champion.key, 10), championId);
        }
        if (!cancelled) setChampKeyMap(next);
      } catch {
        if (!cancelled) setChampKeyMap(new Map());
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const champIdToNumeric = useMemo(() => {
    const map = new Map<string, number>();
    for (const [numericId, championId] of champKeyMap) {
      map.set(championId, numericId);
    }
    return map;
  }, [champKeyMap]);

  return { champKeyMap, champIdToNumeric };
}
