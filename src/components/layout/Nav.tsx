import { NavLink } from 'react-router-dom';
import { IdentitySelector } from './IdentitySelector';
import type { useIdentity } from '@/hooks/useIdentity';

const links = [
  { to: '/', label: '대시보드' },
  { to: '/session', label: '내전 세션' },
  { to: '/players', label: '선수 관리' },
  { to: '/champions', label: '챔피언' },
  { to: '/stats', label: '통계' },
  { to: '/history', label: '기록' },
  { to: '/settings', label: '설정' },
];

export function Nav({ identity }: { identity: ReturnType<typeof useIdentity> }) {
  return (
    <nav className="bg-lol-blue border-b border-lol-border">
      <div className="max-w-[1920px] mx-auto px-4">
        <div className="flex items-center h-14 gap-1">
          <NavLink to="/" className="text-lol-gold font-bold text-lg mr-4 shrink-0 flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="w-7 h-7" />
            눈오는 헤네시스
          </NavLink>
          <div className="flex gap-1 overflow-x-auto flex-1">
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
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <span className={`text-xs ${identity.isMaster ? 'text-lol-gold' : 'text-lol-gold-light/60'}`}>
              {identity.isMaster && '[M] '}{identity.playerName}
            </span>
            <IdentitySelector
              players={identity.players}
              onSelect={identity.setUserId}
              currentId={identity.userId}
              inline
            />
          </div>
        </div>
      </div>
    </nav>
  );
}
