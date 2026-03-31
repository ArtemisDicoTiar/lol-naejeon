import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Nav } from '@/components/layout/Nav';
import { Dashboard } from '@/pages/Dashboard';
import { Players } from '@/pages/Players';
import { PlayerDetail } from '@/pages/PlayerDetail';
import { Champions } from '@/pages/Champions';
import { Session } from '@/pages/Session';
import { NewGame } from '@/pages/NewGame';
import { History } from '@/pages/History';
import { Settings } from '@/pages/Settings';
import { Stats } from '@/pages/Stats';

function AppContent() {
  const location = useLocation();
  const isNewGame = location.pathname === '/session/new-game';

  return (
    <div className="min-h-screen bg-lol-dark">
      <Nav />
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
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
