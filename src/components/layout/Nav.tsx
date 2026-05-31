import { NavLink } from 'react-router-dom';
import { IdentitySelector } from './IdentitySelector';
import type { useIdentity } from '@/hooks/useIdentity';
import type { useLcuBridge } from '@/hooks/useLcuBridge';

export const links = [
  { to: '/', label: '대시보드' },
  { to: '/session', label: '내전 세션' },
  { to: '/players', label: '선수 관리' },
  { to: '/player-stats', label: '유저 통계' },
  { to: '/champions', label: '챔피언' },
  { to: '/stats', label: '통계' },
  { to: '/analysis', label: '분석' },
  { to: '/banpick-lab', label: '밴픽 실험실' },
  { to: '/history', label: '기록' },
  { to: '/settings', label: '설정' },
];

export function Nav({ identity, lcu }: { identity: ReturnType<typeof useIdentity>; lcu: ReturnType<typeof useLcuBridge> }) {
  return (
    <nav className="sticky top-0 z-50 border-b border-lol-border/70 bg-lol-blue/90 shadow-[0_10px_34px_rgba(0,0,0,0.28)] backdrop-blur-xl">
      <div className="max-w-[1920px] mx-auto px-3 md:px-4">
        <div className="flex h-11 items-center gap-1">
          <NavLink to="/" className="group mr-2 flex shrink-0 items-center gap-1.5 text-sm font-black tracking-tight text-lol-gold">
            <span className="grid h-7 w-7 place-items-center rounded-lg border border-lol-gold/30 bg-lol-dark/55 shadow-[inset_0_1px_0_rgba(240,230,210,0.08)] transition-colors group-hover:border-lol-gold/60">
              <img src="/favicon.svg" alt="" className="h-[18px] w-[18px]" />
            </span>
            <span className="bg-gradient-to-r from-lol-gold-light to-lol-gold bg-clip-text text-transparent">눈오는 헤네시스</span>
          </NavLink>
          <div className="flex gap-1 overflow-x-auto flex-1">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `rounded-lg border px-2 py-1 text-[11px] font-semibold transition-all whitespace-nowrap ${
                    isActive
                      ? 'border-lol-gold/35 bg-lol-gold/15 text-lol-gold shadow-[0_0_18px_rgba(200,155,60,0.10)]'
                      : 'border-transparent text-lol-gold-light/62 hover:border-lol-border/70 hover:bg-lol-gray/70 hover:text-lol-gold-light'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </div>
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
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
                className="cursor-pointer rounded-md border border-lol-border/80 bg-lol-gray/80 px-1.5 py-0.5 text-[9px] text-lol-gold-light/45 transition-colors hover:border-lol-gold/45 hover:text-lol-gold-light"
                title="클릭하면 브릿지 자동 실행"
              >
                🔌 클라
              </a>
            )}
            {lcu.connected && (
              <button
                onClick={() => lcu.disconnect()}
                className={`cursor-pointer rounded-md border px-1.5 py-0.5 text-[9px] transition-colors ${
                  lcu.champSelectActive
                    ? 'bg-prof-high/20 text-prof-high border-prof-high/40'
                    : 'bg-blue-900/30 text-blue-300 border-blue-700/50'
                }`}
                title="클라이언트 연결됨 (클릭하여 해제)"
              >
                {lcu.champSelectActive ? '🟢 챔셀' : '🔵 연결됨'}
              </button>
            )}
            <span className={`text-[10px] ${identity.isMaster ? 'text-lol-gold' : 'text-lol-gold-light/60'}`}>
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
