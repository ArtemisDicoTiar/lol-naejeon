import { useState, useCallback } from 'react';
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

  const updatePosition = useCallback((e: React.MouseEvent) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const mx = e.clientX;
    const my = e.clientY;

    // Default: to the right and above the cursor
    let x = mx + 16;
    let y = my - CARD_H - 8;

    // If card overflows right, show to the left of cursor
    if (x + CARD_W > vw - PAD) x = mx - CARD_W - 16;
    // If card overflows left, clamp
    if (x < PAD) x = PAD;
    // If not enough room above, show below cursor
    if (y < PAD) y = my + 20;
    // If overflows bottom, clamp
    if (y + CARD_H > vh - PAD) y = vh - CARD_H - PAD;

    setPos({ x, y });
  }, []);

  if (disabled) return <>{children}</>;

  return (
    <div
      className="relative"
      onMouseEnter={(e) => { updatePosition(e); setHovered(true); }}
      onMouseMove={updatePosition}
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
