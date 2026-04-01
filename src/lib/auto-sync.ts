import { exportData } from './backup';

const GITHUB_REPO = 'ArtemisDicoTiar/lol-naejeon';
const SEED_FILE_PATH = 'src/data/seed-data.ts';
const TOKEN_KEY = 'lol-naejeon-github-token';

export function getGithubToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setGithubToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export async function syncToGithub(): Promise<{ success: boolean; message: string }> {
  const token = getGithubToken();
  if (!token) {
    return { success: false, message: 'GitHub 토큰이 설정되지 않았습니다. 설정에서 등록하세요.' };
  }

  try {
    // 1. Export current DB as JSON
    const jsonData = await exportData();
    const parsed = JSON.parse(jsonData);

    // 2. Convert to seed-data.ts format
    const seedContent = `// Auto-generated seed data\n// Last synced: ${new Date().toISOString()}\n\nexport const seedData = ${JSON.stringify(parsed, null, 2)} as const;\n`;
    const encoded = btoa(unescape(encodeURIComponent(seedContent)));

    // 3. Get current file SHA (required for update)
    const getRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${SEED_FILE_PATH}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
    });

    let sha: string | undefined;
    if (getRes.ok) {
      const fileData = await getRes.json();
      sha = fileData.sha;
    }

    // 4. Update file via GitHub API
    const updateRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${SEED_FILE_PATH}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `데이터 자동 동기화 (${new Date().toLocaleDateString('ko-KR')})`,
        content: encoded,
        sha,
      }),
    });

    if (!updateRes.ok) {
      const err = await updateRes.json();
      return { success: false, message: `GitHub 업데이트 실패: ${err.message}` };
    }

    return { success: true, message: '데이터가 GitHub에 동기화되었습니다. Vercel이 자동 배포합니다.' };
  } catch (e) {
    return { success: false, message: `동기화 실패: ${(e as Error).message}` };
  }
}
