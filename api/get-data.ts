import { head, list } from '@vercel/blob';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const BLOB_NAME = 'lol-naejeon-data.json';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    // Find the blob by listing with prefix
    const { blobs } = await list({ prefix: BLOB_NAME });
    if (blobs.length === 0) {
      return res.status(404).json({ error: 'No data found' });
    }

    const blobUrl = blobs[0].url;
    const response = await fetch(blobUrl);
    const data = await response.json();

    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
}
