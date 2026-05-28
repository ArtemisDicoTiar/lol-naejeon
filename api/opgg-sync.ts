import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { del, list, put } from '@vercel/blob';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const BLOB_NAME = 'opgg-counter-data.json';
const COUNTER_SNAPSHOT_PATH = resolve(process.cwd(), 'src/data/synergy-counter-data.json');

interface CounterSnapshot {
  version?: string;
  matchCount?: number;
  counterChampionCount?: number;
  counters?: Record<string, {
    strongAgainst: { id: string; winrate: number; games: number }[];
    weakAgainst: { id: string; winrate: number; games: number }[];
  }>;
}

function loadBundledCounterSnapshot(): CounterSnapshot {
  const raw = readFileSync(COUNTER_SNAPSHOT_PATH, 'utf8');
  return JSON.parse(raw) as CounterSnapshot;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const snapshot = loadBundledCounterSnapshot();
    if (!snapshot.counters || Object.keys(snapshot.counters).length === 0) {
      return res.status(500).json({ error: '번들 카운터 스냅샷이 비어 있습니다.' });
    }

    const payload = {
      updatedAt: new Date().toISOString(),
      source: 'bundled-snapshot',
      snapshotVersion: snapshot.version ?? null,
      matchCount: snapshot.matchCount ?? null,
      championCount: snapshot.counterChampionCount ?? Object.keys(snapshot.counters).length,
      counters: snapshot.counters,
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
      snapshotVersion: payload.snapshotVersion,
      fetched: payload.championCount,
      failed: 0,
      message: `${payload.championCount}개 챔피언 카운터 스냅샷 재게시 완료`,
    });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
}
