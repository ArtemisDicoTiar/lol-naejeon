import { get } from '@vercel/blob';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const BLOB_NAME = 'lol-naejeon-data.json';

async function streamToText(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const blob = await get(BLOB_NAME, {
      access: 'public',
      useCache: false,
      headers: { 'Cache-Control': 'no-cache' },
    });

    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return res.status(404).json({ error: 'No data found' });
    }

    const data = JSON.parse(await streamToText(blob.stream));

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Blob-Uploaded-At', blob.blob.uploadedAt.toISOString());
    res.setHeader('X-Blob-Etag', blob.blob.etag);
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
}
