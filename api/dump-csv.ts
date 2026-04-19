import { list } from '@vercel/blob';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const BLOB_NAME = 'lol-naejeon-data.json';
const DDRAGON_BASE = 'https://ddragon.leagueoflegends.com';

interface BackupData {
  players: { id: number; name: string }[];
  games: { id: number; gameNumber: number; sessionId: number; format: string; playedAt: string; winningTeam: number | null }[];
  gamePicks: { gameId: number; playerId: number; championId: string; team: number }[];
}

const CSV_COLUMNS = [
  'source_file', 'date', 'duration', 'map', 'mode', 'result',
  'game_id', 'team_id', 'team_total_kills', 'team_total_deaths',
  'team_total_assists', 'team_total_gold', 'team_kda',
  'summoner_name', 'level', 'champion', 'champion_korean',
  'kills', 'deaths', 'assists', 'cs', 'gold', 'kda_ratio',
];

function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

async function loadBackup(): Promise<BackupData | null> {
  const { blobs } = await list({ prefix: BLOB_NAME });
  if (blobs.length === 0) return null;
  const r = await fetch(blobs[0].url);
  return await r.json();
}

async function loadChampionNames(): Promise<Record<string, string>> {
  try {
    const verRes = await fetch(`${DDRAGON_BASE}/api/versions.json`);
    const versions: string[] = await verRes.json();
    const r = await fetch(`${DDRAGON_BASE}/cdn/${versions[0]}/data/ko_KR/champion.json`);
    const json = await r.json();
    const out: Record<string, string> = {};
    for (const [id, c] of Object.entries(json.data as Record<string, { name: string }>)) {
      out[id] = c.name;
    }
    return out;
  } catch {
    return {};
  }
}

function buildCsv(data: BackupData, championNames: Record<string, string>): string {
  const playerById = new Map(data.players.map((p) => [p.id, p]));
  const lines: string[] = [CSV_COLUMNS.join(',')];

  for (const game of data.games) {
    const picks = data.gamePicks.filter((p) => p.gameId === game.id);
    const date = formatDate(game.playedAt);
    for (const pick of picks) {
      const player = playerById.get(pick.playerId);
      const isWin = game.winningTeam !== null && pick.team === game.winningTeam;
      const result = game.winningTeam === null ? '' : (isWin ? 'WIN' : 'LOSE');
      const row = [
        'lol-naejeon-app',
        date,
        '',
        '칼바람 나락',
        '사용자 설정',
        result,
        game.id,
        pick.team,
        '', '', '', '', '',
        player?.name ?? '',
        '',
        pick.championId,
        championNames[pick.championId] ?? '',
        '', '', '', '', '', '',
      ];
      lines.push(row.map(csvEscape).join(','));
    }
  }
  return lines.join('\n');
}

async function pushToGithub(csv: string): Promise<{ committed: boolean; url?: string; error?: string }> {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_REPO_OWNER;
  const repo = process.env.GITHUB_REPO_NAME;
  const filePath = process.env.GITHUB_FILE_PATH ?? 'data/lol_dataset.csv';
  const branch = process.env.GITHUB_BRANCH ?? 'main';

  if (!token || !owner || !repo) {
    return { committed: false, error: 'GITHUB_TOKEN/GITHUB_REPO_OWNER/GITHUB_REPO_NAME 환경변수 미설정' };
  }

  const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'lol-naejeon-app',
    Accept: 'application/vnd.github+json',
  };

  let sha: string | undefined;
  const existing = await fetch(`${apiBase}?ref=${branch}`, { headers });
  if (existing.ok) {
    const body = await existing.json();
    sha = body.sha;
  }

  const contentB64 = Buffer.from(csv, 'utf-8').toString('base64');
  const putRes = await fetch(apiBase, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `chore: weekly dataset dump (${new Date().toISOString().slice(0, 10)})`,
      content: contentB64,
      branch,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!putRes.ok) {
    const err = await putRes.text();
    return { committed: false, error: `GitHub push failed: ${putRes.status} ${err}` };
  }
  const body = await putRes.json();
  return { committed: true, url: body.content?.html_url };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const backup = await loadBackup();
    if (!backup) return res.status(404).json({ error: 'No data found' });

    const championNames = await loadChampionNames();
    const csv = buildCsv(backup, championNames);

    const isDryRun = req.query.dryRun === 'true';
    if (isDryRun) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.status(200).send(csv);
    }

    const result = await pushToGithub(csv);
    if (!result.committed) {
      return res.status(500).json({ error: result.error, csvLength: csv.length });
    }
    return res.status(200).json({
      success: true,
      url: result.url,
      rows: csv.split('\n').length - 1,
    });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
}
