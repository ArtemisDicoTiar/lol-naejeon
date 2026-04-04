import { NavLink } from 'react-router-dom';
import { IdentitySelector } from './IdentitySelector';
import type { useIdentity } from '@/hooks/useIdentity';
import type { useLcuBridge } from '@/hooks/useLcuBridge';

const links = [
  { to: '/', label: '대시보드' },
  { to: '/session', label: '내전 세션' },
  { to: '/players', label: '선수 관리' },
  { to: '/champions', label: '챔피언' },
  { to: '/stats', label: '통계' },
  { to: '/history', label: '기록' },
  { to: '/settings', label: '설정' },
];

export function Nav({ identity, lcu }: { identity: ReturnType<typeof useIdentity>; lcu: ReturnType<typeof useLcuBridge> }) {
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
            {/* LCU Bridge status */}
            {!lcu.connected && (
              <a
                href="lol-bridge://start"
                onClick={() => {
                  // Try WebSocket first; if already connected, prevent default
                  lcu.connect();
                  // Allow the link to open the custom URL scheme
                  // Browser will show "Open this app?" dialog
                  setTimeout(() => lcu.connect(), 2500);
                }}
                className="cursor-pointer px-2 py-1 rounded text-[10px] border transition-colors bg-lol-gray text-lol-gold-light/40 border-lol-border hover:text-lol-gold-light"
                title="클릭하면 브릿지 자동 실행"
              >
                🔌 클라
              </a>
            )}
            {lcu.connected && (
              <button
                onClick={() => lcu.disconnect()}
                className={`cursor-pointer px-2 py-1 rounded text-[10px] border transition-colors ${
                  lcu.champSelectActive
                    ? 'bg-prof-high/20 text-prof-high border-prof-high/40'
                    : 'bg-blue-900/30 text-blue-300 border-blue-700/50'
                }`}
                title="클라이언트 연결됨 (클릭하여 해제)"
              >
                {lcu.champSelectActive ? '🟢 챔셀' : '🔵 연결됨'}
              </button>
            )}
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
