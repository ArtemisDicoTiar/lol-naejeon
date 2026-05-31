import { createContext, useCallback, useEffect, useRef, useContext } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Nav } from '@/components/layout/Nav';
import { Footer } from '@/components/layout/Footer';
import { IdentitySelector } from '@/components/layout/IdentitySelector';
import { useIdentity } from '@/hooks/useIdentity';
import { useLcuBridge, type LcuChampSelectState, type LcuEogState, type LcuLobbyState, type LcuLivePlayer, type LcuRetroGame } from '@/hooks/useLcuBridge';
import { Dashboard } from '@/pages/Dashboard';
import { Players } from '@/pages/Players';
import { PlayerDetail } from '@/pages/PlayerDetail';
import { Champions } from '@/pages/Champions';
import { Session } from '@/pages/Session';
import { NewGame } from '@/pages/NewGame';
import { Stats } from '@/pages/Stats';
import { PlayerStats } from '@/pages/PlayerStats';
import { Analysis } from '@/pages/Analysis';
import { History } from '@/pages/History';
import { Settings } from '@/pages/Settings';
import { refreshFromVercelIfNewer } from '@/lib/db';
import { syncToVercel } from '@/lib/auto-sync';

interface IdentityContextType {
  userId: number | null;
  isMaster: boolean;
  playerName: string;
}

export const IdentityContext = createContext<IdentityContextType>({
  userId: null, isMaster: false, playerName: '관전자',
});

export function useIdentityContext() {
  return useContext(IdentityContext);
}

interface LcuContextType {
  connected: boolean;
  connect: () => void;
  disconnect: () => void;
  lastState: LcuChampSelectState | null;
  lobbyState: LcuLobbyState | null;
  champSelectActive: boolean;
  gameStartedAt: number | null;
  gameEndedAt: number | null;
  liveGamePlayers: { team1: LcuLivePlayer[]; team2: LcuLivePlayer[] } | null;
  eog: LcuEogState;
  fetchRecentCustomGames: (limit?: number) => Promise<LcuRetroGame[]>;
  hoverChampion: (championNumericId: number) => void;
  lockInChampion: (championNumericId: number) => void;
  hoverBan: (championNumericId: number) => void;
  lockInBan: (championNumericId: number) => void;
}

export const LcuContext = createContext<LcuContextType>({
  connected: false, connect: () => {}, disconnect: () => {},
  lastState: null, lobbyState: null, champSelectActive: false,
  gameStartedAt: null, gameEndedAt: null, liveGamePlayers: null, eog: { status: 'idle', capture: null, participantStats: [], linkedGameId: null, error: null },
  fetchRecentCustomGames: async () => [],
  hoverChampion: () => {}, lockInChampion: () => {},
  hoverBan: () => {}, lockInBan: () => {},
});

export function useLcuContext() {
  return useContext(LcuContext);
}

function AppContent() {
  const location = useLocation();
  const isNewGame = location.pathname === '/session/new-game';
  const identity = useIdentity();
  const lcu = useLcuBridge();
  const lastSharedRefreshRef = useRef(0);

  const refreshSharedData = useCallback((immediate = false) => {
    const now = Date.now();
    if (!immediate && now - lastSharedRefreshRef.current < 45_000) return;
    lastSharedRefreshRef.current = now;
    void refreshFromVercelIfNewer().then((result) => {
      if (identity.isMaster && result.reason === 'local-newer') {
        void syncToVercel();
      }
    });
  }, [identity.isMaster]);

  useEffect(() => {
    const timer = window.setTimeout(() => refreshSharedData(true), 0);
    const handleVisible = () => {
      if (document.visibilityState === 'visible') refreshSharedData();
    };
    const handleFocus = () => refreshSharedData();
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisible);
    };
  }, [refreshSharedData]);

  if (identity.needsSelection && identity.players.length > 0) {
    return (
      <IdentitySelector
        players={identity.players}
        onSelect={(id) => identity.setUserId(id)}
        currentId={identity.userId}
        forceSelection
      />
    );
  }

  return (
    <IdentityContext.Provider value={{ userId: identity.userId, isMaster: identity.isMaster, playerName: identity.playerName }}>
      <LcuContext.Provider value={lcu}>
        <div className="relative min-h-screen flex flex-col overflow-x-hidden">
          <div className="pointer-events-none fixed inset-0 -z-10 bg-[linear-gradient(rgba(240,230,210,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(240,230,210,0.02)_1px,transparent_1px)] bg-[size:44px_44px]" />
          <Nav identity={identity} lcu={lcu} />
          <main className={`flex-1 mx-auto w-full px-3 py-4 md:px-4 ${isNewGame ? 'max-w-[1920px]' : 'max-w-6xl'}`}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/players" element={<Players />} />
              <Route path="/players/:id" element={<PlayerDetail />} />
              <Route path="/champions" element={<Champions />} />
              <Route path="/session" element={<Session />} />
              <Route path="/session/new-game" element={<NewGame />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/player-stats" element={<PlayerStats />} />
              <Route path="/analysis" element={<Analysis />} />
              <Route path="/history" element={<History />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </main>
          <Footer />
        </div>
      </LcuContext.Provider>
    </IdentityContext.Provider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
