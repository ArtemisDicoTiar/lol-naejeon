import { useRef, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { exportData, importData, downloadJson } from '@/lib/backup';
import { db } from '@/lib/db';

export function Settings() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');

  const handleExport = async () => {
    try {
      const json = await exportData();
      const date = new Date().toISOString().slice(0, 10);
      downloadJson(json, `lol-naejeon-backup-${date}.json`);
      setMessage('백업 파일이 다운로드되었습니다.');
    } catch (e) {
      setMessage(`내보내기 실패: ${(e as Error).message}`);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!confirm('기존 데이터가 모두 삭제되고 백업 데이터로 교체됩니다. 계속하시겠습니까?')) {
      return;
    }

    try {
      const json = await file.text();
      await importData(json);
      setMessage('데이터가 성공적으로 복원되었습니다. 페이지를 새로고침합니다...');
      setTimeout(() => window.location.reload(), 1000);
    } catch (e) {
      setMessage(`가져오기 실패: ${(e as Error).message}`);
    }
  };

  const handleReset = async () => {
    if (!confirm('모든 데이터가 삭제됩니다. 정말 초기화하시겠습니까?')) return;
    if (!confirm('정말로요? 되돌릴 수 없습니다.')) return;

    await db.delete();
    window.location.reload();
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-lol-gold">설정</h1>

      <Card title="데이터 백업/복원">
        <p className="text-sm text-lol-gold-light/60 mb-4">
          데이터는 브라우저에 저장됩니다. 브라우저를 변경하거나 데이터 손실에 대비하여 정기적으로 백업하세요.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={handleExport}>데이터 내보내기 (JSON)</Button>
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
            데이터 가져오기
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            className="hidden"
          />
        </div>
        {message && (
          <p className="mt-3 text-sm text-lol-gold">{message}</p>
        )}
      </Card>

      <Card title="데이터 초기화">
        <p className="text-sm text-lol-gold-light/60 mb-4">
          모든 선수, 숙련도, 게임 기록을 삭제합니다. 이 작업은 되돌릴 수 없습니다.
        </p>
        <Button variant="danger" onClick={handleReset}>
          전체 초기화
        </Button>
      </Card>
    </div>
  );
}
