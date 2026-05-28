const UGG_STATS_BASE = 'https://stats2.u.gg/lol/1.5';
const UGG_STATS_VERSION = '1.5.0';
const UGG_PATCH_VERSIONS_URL = 'https://static.bigbrain.gg/assets/lol/riot_patch_update/prod/versions.json';
const DDRAGON_CHAMPIONS_URL = (patchVersion: string) =>
  `https://ddragon.leagueoflegends.com/cdn/${patchVersion}/data/en_US/champion.json`;

export interface UggAramMetaEntry {
  championId: string;
  winrate: number;
  pickrate: number;
  matches: number;
}

export interface UggAramMetaPayload {
  patch: string;
  updatedAt: string;
  champions: UggAramMetaEntry[];
}

interface DDragonChampionRecord {
  id?: string;
  key?: string;
}

type UggChampionRankingRow = [
  championId: string,
  unused: unknown[],
  wins: number,
  matches: number,
  ...rest: unknown[]
];

function toPatchKey(version: string): string {
  const [major, minor] = version.split('.');
  if (!major || !minor) {
    throw new Error(`U.GG patch version format is invalid: ${version}`);
  }

  return `${major}_${minor}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 Codex/1.0',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Fetch failed (${response.status}) for ${url}`);
  }

  return await response.json() as T;
}

async function fetchLatestPatchVersion(): Promise<string> {
  const versions = await fetchJson<string[]>(UGG_PATCH_VERSIONS_URL);
  const latest = versions[0];
  if (!latest) {
    throw new Error('U.GG patch versions are empty.');
  }

  return latest;
}

async function fetchChampionIdMap(patchVersion: string): Promise<Map<string, string>> {
  const payload = await fetchJson<{ data?: Record<string, DDragonChampionRecord> }>(DDRAGON_CHAMPIONS_URL(patchVersion));
  if (!payload.data) {
    throw new Error('Data Dragon champion mapping is empty.');
  }

  const mapping = new Map<string, string>();

  for (const record of Object.values(payload.data)) {
    if (typeof record.key === 'string' && typeof record.id === 'string') {
      mapping.set(record.key, record.id);
    }
  }

  if (mapping.size === 0) {
    throw new Error('U.GG backup champion mapping is empty.');
  }

  return mapping;
}

async function fetchChampionRanking(patch: string): Promise<{
  updatedAt: string;
  queueTotalMatches: number;
  rows: UggChampionRankingRow[];
}> {
  const patchKey = toPatchKey(patch);
  const url = `${UGG_STATS_BASE}/champion_ranking/world/${patchKey}/normal_aram/overall/${UGG_STATS_VERSION}.json`;
  const payload = await fetchJson<unknown[]>(url);

  const [rankingGroups, , updatedAt, queueTotalMatches] = payload;
  if (typeof updatedAt !== 'string' || typeof queueTotalMatches !== 'number') {
    throw new Error('U.GG champion ranking payload is malformed.');
  }

  const noneRows = (
    typeof rankingGroups === 'object'
    && rankingGroups !== null
    && Array.isArray((rankingGroups as { none?: unknown[] }).none)
  ) ? (rankingGroups as { none: unknown[] }).none : null;

  if (!noneRows || noneRows.length === 0) {
    throw new Error('U.GG champion ranking rows are empty.');
  }

  const valid = noneRows.every((row) => (
    Array.isArray(row)
    && typeof row[0] === 'string'
    && typeof row[2] === 'number'
    && typeof row[3] === 'number'
  ));

  if (!valid) {
    throw new Error('U.GG champion ranking row format is invalid.');
  }

  return {
    updatedAt,
    queueTotalMatches,
    rows: noneRows as UggChampionRankingRow[],
  };
}

export async function fetchUggAramMeta(): Promise<UggAramMetaPayload> {
  const patchVersionPromise = fetchLatestPatchVersion();
  const [patchVersion, championIdMap] = await Promise.all([
    patchVersionPromise,
    patchVersionPromise.then(fetchChampionIdMap),
  ]);
  const ranking = await fetchChampionRanking(patchVersion);

  const [major, minor] = patchVersion.split('.');
  if (!major || !minor) {
    throw new Error(`Unexpected U.GG patch version: ${patchVersion}`);
  }

  const champions = ranking.rows.flatMap((row) => {
    const championId = championIdMap.get(row[0]);
    const wins = row[2];
    const matches = row[3];

    if (!championId || matches <= 0 || ranking.queueTotalMatches <= 0) {
      return [];
    }

    return [{
      championId,
      winrate: (wins / matches) * 100,
      pickrate: (matches / ranking.queueTotalMatches) * 100,
      matches,
    }];
  });

  if (champions.length === 0) {
    throw new Error('U.GG ARAM 메타 응답에서 챔피언 목록을 만들지 못했습니다.');
  }

  return {
    patch: `${major}.${minor}`,
    updatedAt: ranking.updatedAt,
    champions,
  };
}
