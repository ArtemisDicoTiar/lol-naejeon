interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

const variants = {
  primary: 'border border-lol-gold/70 bg-gradient-to-b from-lol-gold-light to-lol-gold text-lol-dark shadow-[0_6px_18px_rgba(200,155,60,0.18)] hover:brightness-110',
  secondary: 'border border-lol-border/80 bg-[linear-gradient(180deg,rgba(30,35,40,0.95),rgba(10,20,40,0.85))] text-lol-gold-light shadow-[inset_0_1px_0_rgba(240,230,210,0.04)] hover:border-lol-gold/55 hover:text-lol-gold',
  danger: 'border border-red-800/80 bg-gradient-to-b from-red-900/65 to-red-950/80 text-red-200 hover:border-red-500/70 hover:text-red-100',
  ghost: 'border border-transparent text-lol-gold hover:border-lol-border/70 hover:bg-lol-gray/70',
};

const sizes = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
  lg: 'px-4 py-2 text-sm',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      className={`rounded-lg font-semibold transition-all duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lol-gold/55 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}
