import { exportData, type BackupData } from './backup';

interface SaveDataResponse {
  success?: boolean;
  error?: string;
  savedAt?: string;
  counts?: {
    players?: number;
    sessions?: number;
    games?: number;
    gamePicks?: number;
    gameEogCaptures?: number;
    gameParticipantStats?: number;
  };
}

const SHARED_DB_EXPORTED_AT_KEY = 'lol-naejeon-shared-exported-at';

function markSharedExportedAt(exportedAt: string | undefined): void {
  if (typeof window === 'undefined') return;
  if (!exportedAt) return;
  const parsed = Date.parse(exportedAt);
  if (!Number.isFinite(parsed)) return;
  window.localStorage.setItem(SHARED_DB_EXPORTED_AT_KEY, String(parsed));
}

// Sync data to Vercel Blob via API route
export async function syncToVercel(): Promise<{ success: boolean; message: string }> {
  try {
    const jsonStr = await exportData();
    const data = JSON.parse(jsonStr);

    const res = await fetch('/api/save-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(data),
    });

    const payload = await res.json().catch(() => null) as SaveDataResponse | null;

    if (!res.ok) {
      return { success: false, message: `동기화 실패: ${payload?.error ?? res.statusText}` };
    }

    const gamesCount = payload?.counts?.games;
    markSharedExportedAt(data.exportedAt);
    const suffix = typeof gamesCount === 'number' ? ` (${gamesCount}게임)` : '';
    return { success: true, message: `공유 DB 저장 완료${suffix}. 다른 유저가 새로고침하면 반영됩니다.` };
  } catch (e) {
    return { success: false, message: `동기화 실패: ${(e as Error).message}` };
  }
}

// Load shared data from Vercel Blob
export async function loadFromVercel(): Promise<BackupData | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch('/api/get-data', { cache: 'no-store', signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
