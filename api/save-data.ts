import { put } from '@vercel/blob';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const BLOB_NAME = 'lol-naejeon-data.json';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const data = req.body;
    if (!data || !data.players) {
      return res.status(400).json({ error: 'Invalid data format' });
    }

    const serialized = JSON.stringify(data);
    const savedAt = new Date().toISOString();
    const blob = await put(BLOB_NAME, serialized, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      contentType: 'application/json',
    });

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json({
      success: true,
      url: blob.url,
      pathname: blob.pathname,
      savedAt,
      bytes: Buffer.byteLength(serialized, 'utf8'),
      counts: {
        players: data.players?.length ?? 0,
        sessions: data.sessions?.length ?? 0,
        games: data.games?.length ?? 0,
        gamePicks: data.gamePicks?.length ?? 0,
        gameEogCaptures: data.gameEogCaptures?.length ?? 0,
        gameParticipantStats: data.gameParticipantStats?.length ?? 0,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
}
