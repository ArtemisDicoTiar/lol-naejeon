import { useState, useRef, useEffect } from 'react';
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

export function ChampionWithHover({
  champion, wrStats, allPlayers, proficiencies, highlightPlayerIds, children, disabled,
}: ChampionWithHoverProps) {
  const [hovered, setHovered] = useState(false);
  const [position, setPosition] = useState<'top' | 'bottom'>('top');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (hovered && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      // If not enough room above (card is ~280px tall), show below
      setPosition(rect.top < 300 ? 'bottom' : 'top');
    }
  }, [hovered]);

  if (disabled) return <>{children}</>;

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {hovered && (
        <div className={`absolute z-50 pointer-events-none ${
          position === 'top'
            ? 'bottom-full left-1/2 -translate-x-1/2 mb-2'
            : 'top-full left-1/2 -translate-x-1/2 mt-2'
        }`}>
          <ChampionHoverCard
            champion={champion}
            wrStats={wrStats}
            allPlayers={allPlayers}
            proficiencies={proficiencies}
            highlightPlayerIds={highlightPlayerIds}
          />
        </div>
      )}
    </div>
  );
}
