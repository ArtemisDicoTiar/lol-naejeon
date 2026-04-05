import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Champion, Player, ProficiencyLevel } from '@/lib/db';
import type { WinrateStats } from '@/lib/recommendation/winrate';
import type { EstimatedProficiency } from '@/lib/recommendation/proficiency-estimator';
import { ChampionHoverCard } from './ChampionHoverCard';

interface ChampionWithHoverProps {
  champion: Champion;
  wrStats: WinrateStats | null;
  allPlayers: Player[];
  proficiencies: Record<number, Map<string, ProficiencyLevel>>;
  highlightPlayerIds?: number[];
  children: React.ReactNode;
  disabled?: boolean;
  estimatedMap?: Map<string, Map<string, EstimatedProficiency>>;
}

const CARD_W = 270;
const CARD_H = 320;
const PAD = 8;

export function ChampionWithHover({
  champion, wrStats, allPlayers, proficiencies, highlightPlayerIds, children, disabled, estimatedMap,
}: ChampionWithHoverProps) {
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback((e: React.MouseEvent) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const mx = e.clientX;
    const my = e.clientY;

    let x = mx + 12;
    let y = my - CARD_H / 2;

    if (x + CARD_W > vw - PAD) x = mx - CARD_W - 12;
    if (x < PAD) x = PAD;
    if (y < PAD) y = PAD;
    if (y + CARD_H > vh - PAD) y = vh - CARD_H - PAD;

    setPos({ x, y });
  }, []);

  // Core fix: track global mouse position and close if mouse leaves element
  // This catches all cases where onMouseLeave doesn't fire (DOM reorder, unmount, etc.)
  useEffect(() => {
    if (!hovered) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current) { setHovered(false); return; }
      const rect = ref.current.getBoundingClientRect();
      // Check if mouse is still over the trigger element (with small tolerance)
      const isOver = e.clientX >= rect.left - 2 && e.clientX <= rect.right + 2 &&
                     e.clientY >= rect.top - 2 && e.clientY <= rect.bottom + 2;
      if (!isOver) setHovered(false);
    };
    // Also close on mousedown (more reliable than click for fast interactions)
    const closeOnDown = () => setHovered(false);
    document.addEventListener('mousemove', handler);
    document.addEventListener('mousedown', closeOnDown, true);
    document.addEventListener('scroll', closeOnDown, true);
    window.addEventListener('blur', closeOnDown);
    return () => {
      document.removeEventListener('mousemove', handler);
      document.removeEventListener('mousedown', closeOnDown, true);
      document.removeEventListener('scroll', closeOnDown, true);
      window.removeEventListener('blur', closeOnDown);
    };
  }, [hovered]);

  // Close on unmount
  useEffect(() => {
    return () => setHovered(false);
  }, []);

  if (disabled) return <>{children}</>;

  return (
    <div
      ref={ref}
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
            estimatedMap={estimatedMap}
          />
        </div>,
        document.body
      )}
    </div>
  );
}
