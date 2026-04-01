import type { Player } from '@/lib/db';
import { Button } from '@/components/ui/Button';

interface IdentitySelectorProps {
  players: Player[];
  onSelect: (id: number | null) => void;
  currentId: number | null;
  inline?: boolean;
}

export function IdentitySelector({ players, onSelect, currentId, inline }: IdentitySelectorProps) {
  if (inline) {
    return (
      <select
        value={currentId ?? ''}
        onChange={(e) => onSelect(e.target.value ? parseInt(e.target.value) : null)}
        className="bg-lol-blue border border-lol-border rounded px-2 py-1 text-xs text-lol-gold cursor-pointer"
      >
        <option value="">관전자</option>
        {players.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center">
      <div className="bg-lol-gray border border-lol-border rounded-lg p-6 max-w-sm w-full mx-4">
        <h2 className="text-xl font-bold text-lol-gold text-center mb-2">눈오는 헤네시스</h2>
        <p className="text-sm text-lol-gold-light/60 text-center mb-6">누구인지 선택하세요</p>
        <div className="grid grid-cols-2 gap-3 mb-4">
          {players.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelect(p.id!)}
              className={`cursor-pointer p-3 rounded border text-center font-medium transition-colors ${
                currentId === p.id
                  ? 'border-lol-gold bg-lol-gold/20 text-lol-gold'
                  : 'border-lol-border bg-lol-blue text-lol-gold-light/70 hover:border-lol-gold/50'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
        <Button variant="ghost" className="w-full" onClick={() => onSelect(null)}>
          관전자로 입장
        </Button>
      </div>
    </div>
  );
}
