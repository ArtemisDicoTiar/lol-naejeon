import { NavLink } from 'react-router-dom';

const links = [
  { to: '/', label: '대시보드' },
  { to: '/session', label: '내전 세션' },
  { to: '/players', label: '선수 관리' },
  { to: '/champions', label: '챔피언' },
  { to: '/history', label: '기록' },
  { to: '/settings', label: '설정' },
];

export function Nav() {
  return (
    <nav className="bg-lol-blue border-b border-lol-border">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center h-14 gap-1">
          <NavLink to="/" className="text-lol-gold font-bold text-lg mr-6 shrink-0">
            LoL 내전
          </NavLink>
          <div className="flex gap-1 overflow-x-auto">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `px-3 py-2 rounded text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-lol-gold/20 text-lol-gold'
                      : 'text-lol-gold-light/70 hover:text-lol-gold-light hover:bg-lol-gray'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}
