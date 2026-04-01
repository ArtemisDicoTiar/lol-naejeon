import { put, list, del } from '@vercel/blob';
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

    // Delete old blob if exists
    const { blobs } = await list({ prefix: BLOB_NAME });
    for (const blob of blobs) {
      await del(blob.url);
    }

    // Upload new blob
    const blob = await put(BLOB_NAME, JSON.stringify(data), {
      access: 'public',
      contentType: 'application/json',
    });

    return res.status(200).json({ success: true, url: blob.url });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
}
