import { put, list, del } from '@vercel/blob';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Endpoint kept at /api/opgg-sync for backward compat with the Settings UI,
// but the data source is LoLalytics (the OPGG MCP endpoint never existed).
const BLOB_NAME = 'opgg-counter-data.json';

// LoLalytics per-champion ARAM endpoint. `cid` is the Riot champion numeric id.
// The response carries `enemy`/`enemy_top`/`weak` matchup arrays per champion.
const LOLALYTICS_CHAMP_URL = (cid: number) =>
  `https://ax.lolalytics.com/mega/?ep=champion2&p=d&v=1&patch=current&cid=${cid}&lane=aram&tier=gold_plus&queue=450&region=all`;

// Subset of frequently engaged-with ARAM champions to keep update time bounded.
// (cid → internal champion id used elsewhere.) Mirrors CHAMPION_ID_MAP in
// aram-meta-update.ts for the top tier list.
const TOP_CHAMPIONS: Array<{ cid: number; id: string }> = [
  { cid: 103, id: 'Ahri' }, { cid: 22, id: 'Ashe' }, { cid: 63, id: 'Brand' },
  { cid: 99, id: 'Lux' }, { cid: 45, id: 'Veigar' }, { cid: 101, id: 'Xerath' },
  { cid: 115, id: 'Ziggs' }, { cid: 161, id: 'Velkoz' }, { cid: 37, id: 'Sona' },
  { cid: 147, id: 'Seraphine' }, { cid: 57, id: 'Maokai' }, { cid: 54, id: 'Malphite' },
  { cid: 53, id: 'Blitzcrank' }, { cid: 17, id: 'Teemo' }, { cid: 30, id: 'Karthus' },
  { cid: 110, id: 'Varus' }, { cid: 14, id: 'Sion' }, { cid: 36, id: 'DrMundo' },
  { cid: 235, id: 'Senna' }, { cid: 21, id: 'MissFortune' }, { cid: 25, id: 'Morgana' },
  { cid: 222, id: 'Jinx' }, { cid: 51, id: 'Caitlyn' }, { cid: 81, id: 'Ezreal' },
  { cid: 202, id: 'Jhin' }, { cid: 43, id: 'Karma' }, { cid: 117, id: 'Lulu' },
  { cid: 412, id: 'Thresh' }, { cid: 111, id: 'Nautilus' }, { cid: 89, id: 'Leona' },
  { cid: 32, id: 'Amumu' }, { cid: 131, id: 'Diana' }, { cid: 3, id: 'Galio' },
  { cid: 157, id: 'Yasuo' }, { cid: 777, id: 'Yone' }, { cid: 154, id: 'Zac' },
  { cid: 61, id: 'Orianna' }, { cid: 143, id: 'Zyra' }, { cid: 74, id: 'Heimerdinger' },
  { cid: 112, id: 'Viktor' },
];

// Reverse map for translating cids in matchup lists back to internal ids.
const FULL_CID_MAP: Record<number, string> = {};
for (const c of TOP_CHAMPIONS) FULL_CID_MAP[c.cid] = c.id;

interface MatchupEntry { cid?: number; winrate?: number; wr?: number; games?: number; n?: number }

function pickMatchups(raw: unknown): MatchupEntry[] {
  // LoLalytics packs matchup arrays under varying keys — be permissive.
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  for (const key of ['enemy_aram', 'enemy', 'enemy_top', 'matchups', 'counters']) {
    const v = obj[key];
    if (Array.isArray(v)) return v as MatchupEntry[];
  }
  // Some shapes nest under analytics.<key>
  const analytics = obj.analytics as Record<string, unknown> | undefined;
  if (analytics && typeof analytics === 'object') {
    for (const key of ['enemy_aram', 'enemy', 'enemy_top', 'matchups', 'counters']) {
      const v = analytics[key];
      if (Array.isArray(v)) return v as MatchupEntry[];
    }
  }
  return [];
}

function normalizeMatchups(entries: MatchupEntry[]): { id: string; winrate: number; games: number }[] {
  const out: { id: string; winrate: number; games: number }[] = [];
  for (const e of entries) {
    const cid = e.cid;
    if (cid == null) continue;
    const oppId = FULL_CID_MAP[cid];
    if (!oppId) continue; // not in our top set — skip
    const winrate = typeof e.winrate === 'number' ? e.winrate
      : typeof e.wr === 'number' ? e.wr : NaN;
    const games = typeof e.games === 'number' ? e.games
      : typeof e.n === 'number' ? e.n : 0;
    if (!Number.isFinite(winrate)) continue;
    out.push({ id: oppId, winrate, games });
  }
  return out;
}

async function fetchChampionCounters(cid: number): Promise<{
  strongAgainst: { id: string; winrate: number; games: number }[];
  weakAgainst: { id: string; winrate: number; games: number }[];
} | null> {
  try {
    const res = await fetch(LOLALYTICS_CHAMP_URL(cid), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const matchups = normalizeMatchups(pickMatchups(data));
    if (matchups.length === 0) return null;
    const sorted = [...matchups].sort((a, b) => b.winrate - a.winrate);
    return {
      strongAgainst: sorted.filter((m) => m.winrate >= 52).slice(0, 5),
      weakAgainst: sorted.filter((m) => m.winrate <= 48).slice(-5).reverse(),
    };
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const counters: Record<string, {
    strongAgainst: { id: string; winrate: number; games: number }[];
    weakAgainst: { id: string; winrate: number; games: number }[];
  }> = {};

  let fetched = 0;
  let failed = 0;

  for (const c of TOP_CHAMPIONS) {
    const data = await fetchChampionCounters(c.cid);
    if (data) {
      counters[c.id] = data;
      fetched++;
    } else {
      failed++;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  if (fetched === 0) {
    return res.status(502).json({
      error: 'LoLalytics에서 카운터 데이터를 가져오지 못했습니다.',
      attempted: TOP_CHAMPIONS.length,
    });
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    source: 'lolalytics',
    championCount: fetched,
    counters,
  };

  try {
    const { blobs } = await list({ prefix: BLOB_NAME });
    for (const blob of blobs) {
      await del(blob.url);
    }
    await put(BLOB_NAME, JSON.stringify(payload), {
      access: 'public',
      contentType: 'application/json',
    });
  } catch (e) {
    return res.status(500).json({ error: `Blob 저장 실패: ${(e as Error).message}` });
  }

  return res.status(200).json({
    success: true,
    fetched,
    failed,
    message: `${fetched}개 챔피언 카운터 데이터 업데이트 완료 (${failed}개 실패)`,
  });
}
