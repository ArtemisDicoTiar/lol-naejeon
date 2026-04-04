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

  // Safety: close card on click anywhere, scroll, or if element unmounts
  useEffect(() => {
    if (!hovered) return;
    const close = () => setHovered(false);
    window.addEventListener('click', close, true);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close, true);
      window.removeEventListener('scroll', close, true);
    };
  }, [hovered]);

  // Safety: if the element is no longer under the mouse, close
  useEffect(() => {
    if (!hovered || !ref.current) return;
    const check = () => {
      if (!ref.current) { setHovered(false); return; }
      const rect = ref.current.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) setHovered(false);
    };
    const id = setInterval(check, 500);
    return () => clearInterval(id);
  }, [hovered]);

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
