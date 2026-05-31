import { list } from '@vercel/blob';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const BLOB_NAME = 'lol-naejeon-data.json';

type SharedGameRow = {
  format?: '3v3' | '3v4';
  mode?: 'aram' | 'augmented';
  [key: string]: unknown;
};

type SharedDataBody = {
  games?: SharedGameRow[];
  [key: string]: unknown;
};

function normalizeGameModes(data: SharedDataBody): SharedDataBody {
  return {
    ...data,
    games: data.games?.map((game) => ({
      ...game,
      mode: game.format === '3v4' ? 'augmented' : game.format === '3v3' ? 'aram' : game.mode ?? 'aram',
    })),
  };
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const { blobs } = await list({ prefix: BLOB_NAME });
    const blob = blobs
      .filter((item) => item.pathname === BLOB_NAME)
      .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())[0]
      ?? blobs.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())[0];

    if (!blob) {
      return res.status(404).json({ error: 'No data found' });
    }

    const url = new URL(blob.url);
    url.searchParams.set('v', blob.uploadedAt.getTime().toString());

    const response = await fetch(url.toString(), {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!response.ok) {
      return res.status(502).json({ error: `Blob fetch failed: ${response.status} ${response.statusText}` });
    }

    const data = normalizeGameModes(await response.json() as SharedDataBody);

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Blob-Uploaded-At', blob.uploadedAt.toISOString());
    res.setHeader('X-Blob-Etag', blob.etag);
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
}
