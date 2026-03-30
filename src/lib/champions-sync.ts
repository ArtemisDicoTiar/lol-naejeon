import { db, type Champion } from './db';
import { aramChampionMeta } from '@/data/aram-champion-meta';

const DDRAGON_BASE = 'https://ddragon.leagueoflegends.com';

interface DataDragonChampion {
  id: string;
  name: string;
  tags: string[];
  image: { full: string };
}

export async function getLatestVersion(): Promise<string> {
  const res = await fetch(`${DDRAGON_BASE}/api/versions.json`);
  const versions: string[] = await res.json();
  return versions[0];
}

export async function syncChampions(): Promise<{ added: number; updated: number }> {
  const version = await getLatestVersion();
  const res = await fetch(
    `${DDRAGON_BASE}/cdn/${version}/data/ko_KR/champion.json`
  );
  const json = await res.json();
  const champions: Record<string, DataDragonChampion> = json.data;

  let added = 0;
  let updated = 0;

  await db.transaction('rw', db.champions, async () => {
    for (const [key, champ] of Object.entries(champions)) {
      const meta = aramChampionMeta[key];
      const championData: Champion = {
        id: key,
        nameKo: champ.name,
        tags: champ.tags,
        damageType: meta?.damageType ?? 'AP',
        aramRole: meta?.aramRole ?? 'dps',
        aramTier: meta?.aramTier ?? 'B',
        aramWinrate: meta?.aramWinrate ?? 50.0,
        imageUrl: `${DDRAGON_BASE}/cdn/${version}/img/champion/${champ.image.full}`,
        patchVersion: version,
      };

      const existing = await db.champions.get(key);
      if (existing) {
        await db.champions.put(championData);
        updated++;
      } else {
        await db.champions.add(championData);
        added++;
      }
    }
  });

  return { added, updated };
}

export function getChampionImageUrl(championId: string, version: string): string {
  return `${DDRAGON_BASE}/cdn/${version}/img/champion/${championId}.png`;
}
