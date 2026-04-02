import { list } from '@vercel/blob';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const BLOB_NAME = 'aram-meta-latest.json';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const { blobs } = await list({ prefix: BLOB_NAME });
    if (blobs.length === 0) {
      return res.status(404).json({ error: 'No ARAM meta data found' });
    }

    const response = await fetch(blobs[0].url);
    const data = await response.json();
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
}
