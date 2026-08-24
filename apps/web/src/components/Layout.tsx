import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

type LayoutProps = {
  children: ReactNode;
  compact?: boolean;
};

export function Layout({ children, compact = false }: LayoutProps) {
  return (
    <div className={compact ? 'app-shell app-shell-compact' : 'app-shell'}>
      <header className="topbar">
        <Link className="brand" to="/">
          AI SDLC <span>RPG</span>
        </Link>
        <nav>
          <Link to="/admin">Ведущий</Link>
          <Link to="/play">Игрок</Link>
          <Link to="/screen">Экран</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
