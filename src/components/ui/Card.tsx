interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
}

export function Card({ children, className = '', title }: CardProps) {
  return (
    <div className={`bg-lol-gray border border-lol-border rounded-lg ${className}`}>
      {title && (
        <div className="px-3 py-2.5 border-b border-lol-border">
          <h3 className="text-sm text-lol-gold font-medium">{title}</h3>
        </div>
      )}
      <div className="p-3">{children}</div>
    </div>
  );
}
