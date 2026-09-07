import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { usePresentation } from '../presentation';

type LayoutProps = {
  bare?: boolean;
  children: ReactNode;
  compact?: boolean;
  neutral?: boolean;
};

export function Layout({ bare = false, children, compact = false, neutral = false }: LayoutProps) {
  const presentation = usePresentation();
  return (
    <div className={compact ? 'app-shell app-shell-compact' : 'app-shell'}>
      {!bare && (
        <header className="topbar">
          <Link className="brand" to="/">
            {neutral ? 'Игра' : presentation.branding.title}
          </Link>
          <nav>
            <Link to="/admin">Ведущий</Link>
            <Link to="/play">Игрок</Link>
            <Link to="/screen">Экран</Link>
          </nav>
        </header>
      )}
      {children}
    </div>
  );
}
