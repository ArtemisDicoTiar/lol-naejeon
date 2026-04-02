import { put, list, del } from '@vercel/blob';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const BLOB_NAME = 'aram-meta-latest.json';

// LoLalytics ARAM tier list endpoint (unofficial, may change)
const LOLALYTICS_URL = 'https://ax.lolalytics.com/mega/?ep=champion&p=d&v=1&patch=current&cid=all&lane=aram&tier=gold_plus&queue=450&region=all';

interface LoLalyticsChampData {
  cid: number;
  name?: string;
  win?: number;
  pick?: number;
  ban?: number;
  games?: number;
}

// Map LoLalytics champion IDs to Riot Data Dragon IDs
// This is a subset; unmapped champions use their name directly
const CHAMPION_ID_MAP: Record<number, string> = {
  1: 'Annie', 2: 'Olaf', 3: 'Galio', 4: 'TwistedFate', 5: 'XinZhao',
  6: 'Urgot', 7: 'LeBlanc', 8: 'Vladimir', 9: 'Fiddlesticks', 10: 'Kayn',
  11: 'MasterYi', 12: 'Alistar', 13: 'Ryze', 14: 'Sion', 15: 'Sivir',
  16: 'Soraka', 17: 'Teemo', 18: 'Tristana', 19: 'Warwick', 20: 'Nunu',
  21: 'MissFortune', 22: 'Ashe', 23: 'Tryndamere', 24: 'Jax', 25: 'Morgana',
  26: 'Zilean', 27: 'Singed', 28: 'Evelynn', 29: 'Twitch', 30: 'Karthus',
  31: 'Chogath', 32: 'Amumu', 33: 'Rammus', 34: 'Anivia', 35: 'Shaco',
  36: 'DrMundo', 37: 'Sona', 38: 'Kassadin', 39: 'Irelia', 40: 'Janna',
  41: 'Gangplank', 42: 'Corki', 43: 'Karma', 44: 'Taric', 45: 'Veigar',
  48: 'Trundle', 50: 'Swain', 51: 'Caitlyn', 53: 'Blitzcrank', 54: 'Malphite',
  55: 'Katarina', 56: 'Nocturne', 57: 'Maokai', 58: 'Renekton', 59: 'JarvanIV',
  60: 'Elise', 61: 'Orianna', 62: 'Wukong', 63: 'Brand', 64: 'LeeSin',
  67: 'Vayne', 68: 'Rumble', 69: 'Cassiopeia', 72: 'Skarner', 74: 'Heimerdinger',
  75: 'Nasus', 76: 'Nidalee', 77: 'Udyr', 78: 'Poppy', 79: 'Gragas',
  80: 'Pantheon', 81: 'Ezreal', 82: 'Mordekaiser', 83: 'Yorick', 84: 'Akali',
  85: 'Kennen', 86: 'Garen', 89: 'Leona', 90: 'Malzahar', 91: 'Talon',
  92: 'Riven', 96: 'KogMaw', 98: 'Shen', 99: 'Lux', 101: 'Xerath',
  102: 'Shyvana', 103: 'Ahri', 104: 'Graves', 105: 'Fizz', 106: 'Volibear',
  107: 'Rengar', 110: 'Varus', 111: 'Nautilus', 112: 'Viktor', 113: 'Sejuani',
  114: 'Fiora', 115: 'Ziggs', 117: 'Lulu', 119: 'Draven', 120: 'Hecarim',
  121: 'Khazix', 122: 'Darius', 126: 'Jayce', 127: 'Lissandra', 131: 'Diana',
  133: 'Quinn', 134: 'Syndra', 136: 'AurelionSol', 141: 'Kayn', 142: 'Zoe',
  143: 'Zyra', 145: 'Kaisa', 147: 'Seraphine', 150: 'Gnar', 154: 'Zac',
  157: 'Yasuo', 161: 'Velkoz', 163: 'Taliyah', 164: 'Camille', 166: 'Akshan',
  200: 'BelVeth', 201: 'Braum', 202: 'Jhin', 203: 'Kindred', 221: 'Zeri',
  222: 'Jinx', 223: 'TahmKench', 233: 'Briar', 234: 'Viego', 235: 'Senna',
  236: 'Lucian', 238: 'Zed', 240: 'Kled', 245: 'Ekko', 246: 'Qiyana',
  254: 'Vi', 266: 'Aatrox', 267: 'Nami', 268: 'Azir', 350: 'Yuumi',
  360: 'Samira', 412: 'Thresh', 420: 'Illaoi', 421: 'RekSai', 427: 'Ivern',
  429: 'Kalista', 432: 'Bard', 497: 'Rakan', 498: 'Xayah', 516: 'Ornn',
  517: 'Sylas', 518: 'Neeko', 523: 'Aphelios', 526: 'Rell', 555: 'Pyke',
  711: 'Vex', 777: 'Yone', 799: 'Ambessa', 875: 'Sett', 876: 'Lillia',
  887: 'Gwen', 888: 'Renata', 895: 'Nilah', 897: 'KSante', 901: 'Smolder',
  902: 'Milio', 910: 'Hwei', 950: 'Naafiri', 893: 'Aurora', 951: 'Mel',
};

function computeTier(winrate: number, rank: number, total: number): string {
  const percentile = rank / total;
  if (percentile <= 0.10) return 'S';
  if (percentile <= 0.30) return 'A';
  if (percentile <= 0.70) return 'B';
  if (percentile <= 0.90) return 'C';
  return 'D';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Fetch data from LoLalytics
    const response = await fetch(LOLALYTICS_URL, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      return res.status(502).json({ error: `LoLalytics responded with ${response.status}` });
    }

    const raw = await response.json();

    // Parse champion data - LoLalytics format varies, handle flexibly
    const champions: { id: string; winrate: number; pickrate: number }[] = [];

    if (raw && typeof raw === 'object') {
      // Try array format
      const champArray: LoLalyticsChampData[] = Array.isArray(raw) ? raw : (raw.data ?? raw.champions ?? []);

      for (const entry of champArray) {
        const champId = CHAMPION_ID_MAP[entry.cid];
        if (!champId) continue;

        const games = entry.games ?? (entry.win ?? 0) + ((entry.pick ?? 0) - (entry.win ?? 0));
        if (games < 100) continue; // Skip champions with too few games

        const winrate = entry.win && entry.pick ? (entry.win / entry.pick) * 100 : 50;
        const pickrate = entry.pick ?? 0;

        champions.push({ id: champId, winrate, pickrate });
      }
    }

    if (champions.length === 0) {
      return res.status(502).json({ error: 'No champion data parsed from LoLalytics response' });
    }

    // Sort by winrate for tier calculation
    champions.sort((a, b) => b.winrate - a.winrate);

    const metaData: Record<string, { aramTier: string; aramWinrate: number }> = {};
    champions.forEach((c, idx) => {
      metaData[c.id] = {
        aramTier: computeTier(c.winrate, idx, champions.length),
        aramWinrate: Math.round(c.winrate * 10) / 10,
      };
    });

    const payload = {
      updatedAt: new Date().toISOString(),
      patch: 'auto',
      championCount: Object.keys(metaData).length,
      champions: metaData,
    };

    // Store in Vercel Blob
    const { blobs } = await list({ prefix: BLOB_NAME });
    for (const blob of blobs) {
      await del(blob.url);
    }
    await put(BLOB_NAME, JSON.stringify(payload), {
      access: 'public',
      contentType: 'application/json',
    });

    return res.status(200).json({
      success: true,
      updated: Object.keys(metaData).length,
      message: `${Object.keys(metaData).length}개 챔피언 메타 데이터 업데이트 완료`,
    });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
}
