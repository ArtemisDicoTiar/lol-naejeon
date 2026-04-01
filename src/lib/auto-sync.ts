import { exportData } from './backup';

// Sync data to Vercel Blob via API route
export async function syncToVercel(): Promise<{ success: boolean; message: string }> {
  try {
    const jsonStr = await exportData();
    const data = JSON.parse(jsonStr);

    const res = await fetch('/api/save-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const err = await res.json();
      return { success: false, message: `동기화 실패: ${err.error}` };
    }

    return { success: true, message: '데이터가 저장되었습니다. 다른 유저가 새로고침하면 반영됩니다.' };
  } catch (e) {
    return { success: false, message: `동기화 실패: ${(e as Error).message}` };
  }
}

// Load shared data from Vercel Blob
export async function loadFromVercel(): Promise<any | null> {
  try {
    const res = await fetch('/api/get-data');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
