import { put, list, del } from '@vercel/blob';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const BLOB_NAME = 'opgg-counter-data.json';

// OP.GG MCP Server endpoint
const OPGG_MCP_URL = 'https://mcp-api.op.gg/mcp';

// Top ARAM champions to fetch counter data for
const TOP_CHAMPIONS = [
  'Ashe', 'Brand', 'Lux', 'Veigar', 'Xerath', 'Ziggs', 'Velkoz', 'Sona',
  'Seraphine', 'Maokai', 'Malphite', 'Blitzcrank', 'Teemo', 'Karthus',
  'Varus', 'Sion', 'DrMundo', 'Kayle', 'Senna', 'MissFortune',
  'Morgana', 'Jinx', 'Caitlyn', 'Ezreal', 'Jhin', 'Karma', 'Lulu',
  'Thresh', 'Nautilus', 'Leona', 'Amumu', 'Diana', 'Galio', 'Yasuo',
  'Yone', 'Zac', 'Orianna', 'Zyra', 'Heimerdinger', 'Viktor',
];

interface McpToolCall {
  jsonrpc: '2.0';
  id: number;
  method: 'tools/call';
  params: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

async function fetchChampionCounters(championName: string): Promise<{
  strongAgainst: { id: string; winrate: number }[];
  weakAgainst: { id: string; winrate: number }[];
} | null> {
  try {
    const payload: McpToolCall = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'lol-champion-analysis',
        arguments: {
          champion: championName.toUpperCase(),
          game_mode: 'ARAM',
          lang: 'ko_KR',
          position: 'NONE',
        },
      },
    };

    const res = await fetch(OPGG_MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;

    const data = await res.json();

    // Extract counter data from MCP response
    // The exact structure depends on OP.GG's MCP implementation
    const result = data?.result;
    if (!result) return null;

    // Parse text content if returned as text
    const content = result?.content;
    if (Array.isArray(content)) {
      const textContent = content.find((c: any) => c.type === 'text')?.text;
      if (textContent) {
        // Try to extract counter info from the text response
        try {
          const parsed = JSON.parse(textContent);
          return {
            strongAgainst: (parsed.counters?.strong ?? []).slice(0, 5),
            weakAgainst: (parsed.counters?.weak ?? []).slice(0, 5),
          };
        } catch {
          // Text response, not JSON - skip
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const counters: Record<string, {
    strongAgainst: { id: string; winrate: number }[];
    weakAgainst: { id: string; winrate: number }[];
  }> = {};

  let fetched = 0;
  let failed = 0;

  // Fetch counter data for top champions (with rate limiting)
  for (const champ of TOP_CHAMPIONS) {
    const data = await fetchChampionCounters(champ);
    if (data) {
      counters[champ] = data;
      fetched++;
    } else {
      failed++;
    }
    // Rate limit: small delay between requests
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  if (fetched === 0) {
    return res.status(502).json({
      error: 'OP.GG MCP에서 데이터를 가져오지 못했습니다. MCP 서버가 응답하지 않을 수 있습니다.',
      attempted: TOP_CHAMPIONS.length,
    });
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    source: 'opgg-mcp',
    championCount: fetched,
    counters,
  };

  // Store in Vercel Blob
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
