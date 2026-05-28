import { del, list, put } from '@vercel/blob';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { fetchUggAramMeta } from './_lib/ugg.js';

const BLOB_NAME = 'aram-meta-latest.json';

function computeTier(rank: number, total: number): 'S' | 'A' | 'B' | 'C' | 'D' {
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
    const meta = await fetchUggAramMeta();
    const sorted = [...meta.champions].sort((a, b) => b.winrate - a.winrate);

    const champions = Object.fromEntries(sorted.map((champion, index) => ([
      champion.championId,
      {
        aramTier: computeTier(index, sorted.length),
        aramWinrate: Math.round(champion.winrate * 100) / 100,
        aramPickrate: Math.round(champion.pickrate * 100) / 100,
        matches: champion.matches,
      },
    ])));

    const payload = {
      updatedAt: meta.updatedAt,
      patch: meta.patch ?? 'auto',
      source: 'u.gg',
      championCount: sorted.length,
      champions,
    };

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
      source: payload.source,
      patch: payload.patch,
      updated: payload.championCount,
      message: `${payload.championCount}개 챔피언 ARAM 메타 업데이트 완료`,
    });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
}
