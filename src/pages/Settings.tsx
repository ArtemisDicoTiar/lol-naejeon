import { useRef, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { exportData, importData, downloadJson } from '@/lib/backup';
import { importRecords, IMPORT_EXAMPLE, type ImportData } from '@/lib/import-records';
import { getGithubToken, setGithubToken, syncToGithub } from '@/lib/auto-sync';
import { useIdentityContext } from '@/App';
import { db } from '@/lib/db';

export function Settings() {
  const { isMaster } = useIdentityContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recordInputRef = useRef<HTMLInputElement>(null);
  const [ghToken, setGhToken] = useState(getGithubToken() ?? '');
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
    if (!confirm('기존 데이터가 모두 삭제되고 백업 데이터로 교체됩니다. 계속하시겠습니까?')) return;
    try {
      const json = await file.text();
      await importData(json);
      setMessage('데이터가 성공적으로 복원되었습니다. 새로고침합니다...');
      setTimeout(() => window.location.reload(), 1000);
    } catch (e) {
      setMessage(`가져오기 실패: ${(e as Error).message}`);
    }
  };

  const handleRecordImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const json = await file.text();
      const data: ImportData = JSON.parse(json);
      if (!data.sessions || !Array.isArray(data.sessions)) {
        throw new Error('올바른 내전 기록 포맷이 아닙니다.');
      }
      const result = await importRecords(data);
      let msg = `임포트 완료: ${result.sessions}개 세션, ${result.games}개 게임 추가`;
      if (result.errors.length > 0) {
        msg += `\n경고: ${result.errors.join(', ')}`;
      }
      setMessage(msg);
    } catch (e) {
      setMessage(`기록 임포트 실패: ${(e as Error).message}`);
    }
    e.target.value = '';
  };

  const handleDownloadExample = () => {
    downloadJson(JSON.stringify(IMPORT_EXAMPLE, null, 2), 'naejeon-record-example.json');
    setMessage('예시 파일이 다운로드되었습니다. 포맷에 맞춰 기록을 작성하세요.');
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

      {/* GitHub Auto-Sync (Master only) */}
      {isMaster && (
        <Card title="자동 동기화 (GitHub)">
          <p className="text-sm text-lol-gold-light/60 mb-3">
            세션 종료 시 자동으로 GitHub에 데이터를 동기화합니다.
            Vercel이 자동 재배포하여 모든 유저에게 반영됩니다.
          </p>
          <div className="flex gap-3 mb-3">
            <input
              type="password"
              value={ghToken}
              onChange={(e) => setGhToken(e.target.value)}
              placeholder="GitHub Personal Access Token"
              className="flex-1 bg-lol-blue border border-lol-border rounded px-3 py-2 text-sm text-lol-gold-light placeholder:text-lol-gold-light/30 focus:outline-none focus:border-lol-gold"
            />
            <Button onClick={() => { setGithubToken(ghToken); setMessage('토큰이 저장되었습니다.'); }}>
              저장
            </Button>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={async () => {
              setMessage('동기화 중...');
              const result = await syncToGithub();
              setMessage(result.message);
            }}>
              수동 동기화
            </Button>
            {getGithubToken() && (
              <span className="text-xs text-prof-high self-center">토큰 등록됨</span>
            )}
          </div>
          <p className="text-xs text-lol-gold-light/30 mt-2">
            토큰 생성: GitHub Settings → Developer settings → Personal access tokens → repo 권한
          </p>
        </Card>
      )}

      <Card title="데이터 백업/복원">
        <p className="text-sm text-lol-gold-light/60 mb-4">
          데이터는 브라우저에 저장됩니다. 정기적으로 백업하세요.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={handleExport}>데이터 내보내기 (JSON)</Button>
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
            데이터 가져오기
          </Button>
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} className="hidden" />
        </div>
      </Card>

      <Card title="내전 기록 가져오기">
        <p className="text-sm text-lol-gold-light/60 mb-2">
          과거 내전 기록을 정해진 포맷의 JSON 파일로 임포트합니다. 기존 데이터에 추가됩니다 (덮어쓰기 아님).
        </p>
        <p className="text-xs text-lol-gold-light/40 mb-4">
          플레이어 이름으로 매칭하며, 없는 플레이어는 자동 생성됩니다. 챔피언은 영문 ID 사용 (예: Lucian, MissFortune).
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => recordInputRef.current?.click()}>
            내전 기록 JSON 가져오기
          </Button>
          <Button variant="ghost" onClick={handleDownloadExample}>
            예시 포맷 다운로드
          </Button>
          <input ref={recordInputRef} type="file" accept=".json" onChange={handleRecordImport} className="hidden" />
        </div>
      </Card>

      <Card title="데이터 초기화">
        <p className="text-sm text-lol-gold-light/60 mb-4">
          모든 선수, 숙련도, 게임 기록을 삭제합니다.
        </p>
        <Button variant="danger" onClick={handleReset}>전체 초기화</Button>
      </Card>

      {message && (
        <div className="p-3 bg-lol-gray rounded border border-lol-border">
          <p className="text-sm text-lol-gold whitespace-pre-line">{message}</p>
        </div>
      )}
    </div>
  );
}
