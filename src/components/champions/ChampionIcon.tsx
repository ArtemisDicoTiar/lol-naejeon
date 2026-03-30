import type { Champion } from '@/lib/db';

interface ChampionIconProps {
  champion: Champion;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  selected?: boolean;
  onClick?: () => void;
  showName?: boolean;
}

const sizes = {
  sm: 'w-8 h-8',
  md: 'w-12 h-12',
  lg: 'w-16 h-16',
};

export function ChampionIcon({
  champion,
  size = 'md',
  disabled = false,
  selected = false,
  onClick,
  showName = false,
}: ChampionIconProps) {
  return (
    <div
      onClick={disabled ? undefined : onClick}
      className={`flex flex-col items-center gap-1 ${onClick && !disabled ? 'cursor-pointer' : ''}`}
      title={champion.nameKo}
    >
      <div
        className={`${sizes[size]} rounded overflow-hidden border-2 transition-all ${
          disabled
            ? 'opacity-30 grayscale border-gray-700'
            : selected
              ? 'border-lol-gold shadow-[0_0_8px_rgba(200,155,60,0.5)]'
              : 'border-lol-border hover:border-lol-gold/60'
        }`}
      >
        <img
          src={champion.imageUrl}
          alt={champion.nameKo}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
      {showName && (
        <span className={`text-xs text-center leading-tight ${disabled ? 'text-gray-600' : 'text-lol-gold-light/80'}`}>
          {champion.nameKo}
        </span>
      )}
    </div>
  );
}
