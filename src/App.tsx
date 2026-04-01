import { createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Nav } from '@/components/layout/Nav';
import { IdentitySelector } from '@/components/layout/IdentitySelector';
import { useIdentity } from '@/hooks/useIdentity';
import { Dashboard } from '@/pages/Dashboard';
import { Players } from '@/pages/Players';
import { PlayerDetail } from '@/pages/PlayerDetail';
import { Champions } from '@/pages/Champions';
import { Session } from '@/pages/Session';
import { NewGame } from '@/pages/NewGame';
import { Stats } from '@/pages/Stats';
import { History } from '@/pages/History';
import { Settings } from '@/pages/Settings';

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

function AppContent() {
  const location = useLocation();
  const isNewGame = location.pathname === '/session/new-game';
  const identity = useIdentity();

  if (identity.needsSelection && identity.players.length > 0) {
    return (
      <IdentitySelector
        players={identity.players}
        onSelect={(id) => identity.setUserId(id)}
        currentId={identity.userId}
      />
    );
  }

  return (
    <IdentityContext.Provider value={{ userId: identity.userId, isMaster: identity.isMaster, playerName: identity.playerName }}>
      <div className="min-h-screen bg-lol-dark">
        <Nav identity={identity} />
        <main className={`mx-auto px-4 py-6 ${isNewGame ? 'max-w-[1920px]' : 'max-w-6xl'}`}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/players" element={<Players />} />
            <Route path="/players/:id" element={<PlayerDetail />} />
            <Route path="/champions" element={<Champions />} />
            <Route path="/session" element={<Session />} />
            <Route path="/session/new-game" element={<NewGame />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/history" element={<History />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
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
