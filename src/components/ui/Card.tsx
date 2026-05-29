interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
}

export function Card({ children, className = '', title }: CardProps) {
  return (
    <div className={`relative overflow-hidden rounded-xl border border-lol-border/70 bg-[linear-gradient(180deg,rgba(30,35,40,0.94),rgba(10,20,40,0.76))] shadow-[0_14px_42px_rgba(0,0,0,0.22)] backdrop-blur-sm ${className}`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-lol-gold/45 to-transparent" />
      {title && (
        <div className="border-b border-lol-border/70 bg-lol-dark/20 px-3 py-2.5">
          <h3 className="text-sm font-semibold tracking-[0.01em] text-lol-gold">{title}</h3>
        </div>
      )}
      <div className="p-3">{children}</div>
    </div>
  );
}
