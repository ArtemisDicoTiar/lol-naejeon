interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

const variants = {
  primary: 'bg-lol-gold text-lol-dark hover:bg-lol-gold-light',
  secondary: 'bg-lol-gray text-lol-gold-light border border-lol-border hover:bg-lol-blue',
  danger: 'bg-red-900/50 text-red-300 border border-red-800 hover:bg-red-900',
  ghost: 'text-lol-gold hover:bg-lol-gray',
};

const sizes = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      className={`rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}
