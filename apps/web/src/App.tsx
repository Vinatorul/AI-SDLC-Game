import { Navigate, Route, Routes } from 'react-router-dom';
import { ScenarioEntry } from './components/ScenarioEntry';
import { AdminPage } from './pages/AdminPage';
import { LandingPage } from './pages/LandingPage';
import { PlayerPage } from './pages/PlayerPage';
import { ScreenPage } from './pages/ScreenPage';

export function App() {
  return (
    <Routes>
      <Route element={<ScenarioEntry />}>
        <Route element={<LandingPage />} path="/" />
        <Route element={<AdminPage />} path="/admin" />
        <Route element={<PlayerPage />} path="/play" />
        <Route element={<ScreenPage />} path="/screen" />
      </Route>
      <Route element={<AdminPage />} path="/admin/:code" />
      <Route element={<PlayerPage />} path="/play/:code" />
      <Route element={<ScreenPage />} path="/screen/:code" />
      <Route element={<Navigate replace to="/" />} path="*" />
    </Routes>
  );
}
