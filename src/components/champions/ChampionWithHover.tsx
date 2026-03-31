import { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { Champion, Player, ProficiencyLevel } from '@/lib/db';
import type { WinrateStats } from '@/lib/recommendation/winrate';
import { ChampionHoverCard } from './ChampionHoverCard';

interface ChampionWithHoverProps {
  champion: Champion;
  wrStats: WinrateStats | null;
  allPlayers: Player[];
  proficiencies: Record<number, Map<string, ProficiencyLevel>>;
  highlightPlayerIds?: number[];
  children: React.ReactNode;
  disabled?: boolean;
}

const CARD_W = 270;
const CARD_H = 320;
const PAD = 8;

export function ChampionWithHover({
  champion, wrStats, allPlayers, proficiencies, highlightPlayerIds, children, disabled,
}: ChampionWithHoverProps) {
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Default: center above the element
    let x = rect.left + rect.width / 2 - CARD_W / 2;
    let y = rect.top - CARD_H - PAD;

    // If not enough room above, show below
    if (y < PAD) {
      y = rect.bottom + PAD;
    }
    // If still overflows bottom, clamp to bottom
    if (y + CARD_H > vh - PAD) {
      y = vh - CARD_H - PAD;
    }
    // Clamp horizontal: don't overflow left or right
    if (x < PAD) x = PAD;
    if (x + CARD_W > vw - PAD) x = vw - CARD_W - PAD;

    setPos({ x, y });
  }, []);

  if (disabled) return <>{children}</>;

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => { updatePosition(); setHovered(true); }}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {hovered && createPortal(
        <div
          className="fixed pointer-events-none"
          style={{ left: pos.x, top: pos.y, zIndex: 9999 }}
        >
          <ChampionHoverCard
            champion={champion}
            wrStats={wrStats}
            allPlayers={allPlayers}
            proficiencies={proficiencies}
            highlightPlayerIds={highlightPlayerIds}
          />
        </div>,
        document.body
      )}
    </div>
  );
}
